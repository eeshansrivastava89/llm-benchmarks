import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { constants as osConstants } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { prepareInteractiveBenchmarkRun } from "./benchmark-suites.mjs";
import { BenchError, errorMessage } from "./errors.mjs";
import { backendIdentity, isBackendKey } from "./lib/backend-labels.ts";
import { prepareLocalModelLifecycle } from "./local-lifecycle.mjs";
import { updateRunMetadata, markRunFailed } from "./lib/runs.ts";
import { formatCommand } from "./run-plan.mjs";
import {
  assertWriteConfinementAvailable,
  createWriteConfinementLaunch,
  writeConfinementMetadata,
} from "./write-confinement.mjs";

const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM"];
const DIAGNOSTIC_STAGING_DIRECTORY = ".bench-session";
const WRITE_BOUNDARY_PROMPT = "Write durable benchmark outputs only in the current run directory. The operating-system policy blocks persistent writes elsewhere; host reads, installed tools, IPC, and network access remain available.";

export function buildPiInvocation(model, benchmark, options = {}) {
  if (!model?.provider || !model?.id) {
    throw new BenchError("A Pi provider and model are required for an interactive run");
  }
  if (!benchmark?.title) {
    throw new BenchError("A benchmark title is required for an interactive run");
  }
  if (!options.sessionDirectory) {
    throw new BenchError("A private session directory is required for an interactive run");
  }
  return [
    "--no-extensions",
    ...(model.localDiscovery ? ["--extension", fileURLToPath(new URL("./pi-extensions/local-models.mjs", import.meta.url))] : []),
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--no-approve",
    "--tools",
    "read,bash,edit,write",
    "--session-dir",
    options.sessionDirectory,
    "--append-system-prompt",
    WRITE_BOUNDARY_PROMPT,
    "--provider",
    model.provider,
    "--model",
    model.id,
    "--name",
    `Bench: ${benchmark.title}`,
    "--",
    "@prompt.md",
  ];
}

export function interactiveModelMetadata(model) {
  if (model.backend?.location !== "local") {
    return { modelSource: "cloud", backendLabel: model.provider };
  }

  const provider = model.provider.toLowerCase();
  if (isBackendKey(provider)) {
    const identity = backendIdentity(provider);
    return { modelSource: identity.modelSource, backendLabel: identity.label };
  }
  if (provider.includes("mtp")) {
    return { modelSource: "llama-cpp-mtp", backendLabel: backendIdentity("llama-cpp-mtp").label };
  }
  return { modelSource: "llama-cpp", backendLabel: model.provider };
}

// Providers registered by user Pi extensions exist only in processes that load
// those extensions. The confined interactive run starts Pi with --no-extensions
// and a minimal config copy, so their definitions and resolved auth must travel
// through the private per-run configuration instead.
export function isExtensionProvider(modelRuntime, model) {
  return modelRuntime?.extensionProviders?.has(model.provider) === true;
}

// API implementations registered by pi-ai itself. A static provider entry in the
// private per-run config can stream only these; any other api name exists solely
// inside the extension that registered it, and the confined run starts Pi
// without extensions (mirrors pi-ai's BUILTIN_APIS registry).
const STATIC_REPLICABLE_APIS = new Set([
  "anthropic-messages",
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
  "azure-openai-responses",
  "google-generative-ai",
  "google-vertex",
  "mistral-conversations",
  "bedrock-converse-stream",
  "pi-messages",
]);

// Returns the reason an extension-registered provider cannot be faithfully
// replicated as a static definition in the private per-run config, or null when
// the shape is safe. Surfaced at model selection instead of failing mid-run.
export async function extensionProviderStaticGap(modelRuntime, model) {
  if (!isExtensionProvider(modelRuntime, model)) return null;
  if (!STATIC_REPLICABLE_APIS.has(model.api)) {
    return `API "${model.api}" exists only inside its Pi extension; the private run configuration can stream built-in APIs only.`;
  }
  let resolution;
  try {
    resolution = await modelRuntime.getAuth(model, {
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return `Pi could not resolve credentials for ${model.provider}/${model.id}; the private run configuration cannot pre-stage them.`;
  }
  const hasApiKey = typeof resolution?.auth?.apiKey === "string" && resolution.auth.apiKey.length > 0;
  const hasEnv = Boolean(resolution?.env && Object.keys(resolution.env).length > 0);
  if (!hasApiKey && !hasEnv) {
    return `Pi resolved no API key or environment credentials for ${model.provider}/${model.id}; the private run would rely on the copied Pi credentials alone.`;
  }
  return null;
}

export async function resolveModelConnection(modelRuntime, model) {
  const extensionRegistered = isExtensionProvider(modelRuntime, model);
  if (model.backend?.location !== "local" && !extensionRegistered) return null;
  const connection = { baseUrl: model.baseUrl };
  const requiresAuth = model.provider === "omlx" || model.localDiscovery || extensionRegistered;
  if (!requiresAuth) return connection;

  let resolution;
  try {
    resolution = await modelRuntime.getAuth(model, {
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new BenchError(`Could not resolve connection details for ${model.provider}/${model.id}`);
  }
  if ((model.localDiscovery || extensionRegistered) && !resolution) {
    throw new BenchError(`Could not resolve access for ${model.provider}/${model.id}`);
  }
  return {
    baseUrl: resolution?.auth?.baseUrl ?? model.baseUrl,
    apiKey: resolution?.auth?.apiKey,
    ...((model.localDiscovery || extensionRegistered)
      ? { auth: resolution?.auth, env: resolution?.env }
      : {}),
  };
}

export function runForeground(command, args, options) {
  const spawnImpl = options.spawnImpl ?? spawn;
  const signalTarget = options.signalTarget ?? process;

  return new Promise((resolvePromise, reject) => {
    let child;
    let settled = false;
    let interruptedBy = null;
    const handlers = new Map();

    const removeHandlers = () => {
      for (const [signal, handler] of handlers) signalTarget.off(signal, handler);
    };
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      removeHandlers();
      reject(error);
    };

    try {
      child = spawnImpl(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: "inherit",
      });
    } catch (error) {
      rejectOnce(new BenchError(`Could not start ${command}: ${errorMessage(error)}`));
      return;
    }

    for (const signal of FORWARDED_SIGNALS) {
      const handler = () => {
        interruptedBy ??= signal;
        if (child.exitCode === null && child.signalCode === null) child.kill(signal);
      };
      handlers.set(signal, handler);
      signalTarget.on(signal, handler);
    }

    child.once("error", (error) => {
      const message = error.code === "ENOENT"
        ? `Required command not found: ${command}`
        : `Could not start ${command}: ${errorMessage(error)}`;
      rejectOnce(new BenchError(message));
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      removeHandlers();
      resolvePromise({
        code,
        signal,
        interruptedBy,
        status: signal ? 128 + (osConstants.signals[signal] ?? 0) : code ?? 1,
      });
    });
  });
}

export async function executeInteractiveBenchmark(input) {
  const command = input.piCommand ?? "pi";
  const confinementRuntime = await (
    input.confinementCheckImpl ?? assertWriteConfinementAvailable
  )({
    repositoryRoot: input.repositoryRoot,
    env: input.env ?? process.env,
  });
  const modelMetadata = interactiveModelMetadata(input.model);
  const connection = await resolveModelConnection(input.modelRuntime, input.model);
  const lifecycle = await (input.lifecycleFactory ?? prepareLocalModelLifecycle)(
    input.model,
    connection,
    input.lifecycleOptions ?? {},
  );
  let prepared = null;
  let args = null;
  let launchCommand = null;
  let confinementLaunch = null;
  let diagnosticPaths = null;
  let childResult = null;
  let cleanupResult = null;
  let launchError = null;
  let executionError = null;
  const finalizationErrors = [];

  try {
    prepared = await (input.prepareRunImpl ?? prepareInteractiveBenchmarkRun)({
      repositoryRoot: input.repositoryRoot,
      runsRoot: input.runsRoot,
      benchmark: input.benchmark,
      modelId: input.model.id,
      baseUrl: input.model.baseUrl,
      dataScienceAccess: input.dataScienceAccess,
      ...modelMetadata,
    });
    diagnosticPaths = interactiveDiagnosticPaths(
      input.repositoryRoot,
      prepared,
      input.diagnosticsRoot,
    );
    await (input.mkdirImpl ?? mkdir)(diagnosticPaths.stagingDirectory, {
      recursive: true,
      mode: 0o700,
    });
    args = buildPiInvocation(input.model, input.benchmark, {
      sessionDirectory: diagnosticPaths.stagingDirectory,
    });
    launchCommand = formatCommand(command, args);
    confinementLaunch = await (
      input.confinementLaunchImpl ?? createWriteConfinementLaunch
    )(command, args, {
      runDirectory: prepared.paths.runDirectory,
      env: { ...(input.env ?? process.env), ...connection?.env },
      localModel: input.model.localDiscovery || isExtensionProvider(input.modelRuntime, input.model)
        ? { model: input.model, auth: connection?.auth }
        : undefined,
      platform: confinementRuntime?.platform,
      runtime: confinementRuntime?.runtime,
      executable: confinementRuntime?.executable,
    });

    await (input.updateMetadataImpl ?? updateRunMetadata)(prepared.paths, {
      runner: {
        ...prepared.run.runner,
        actualRunner: "Pi",
        launchCommand,
        ...(input.model.localModelPolicy ? { settingsControl: input.model.localModelPolicy } : {}),
        isolation: writeConfinementMetadata(
          confinementLaunch.runtime,
          input.benchmark.kind === "data-science"
            ? "discarded-after-run"
            : "private-bench-runtime",
        ),
      },
    });
    await input.onPrepared?.({ prepared, args, launchCommand });

    try {
      childResult = await (input.runForegroundImpl ?? runForeground)(
        confinementLaunch.command,
        confinementLaunch.args,
        {
          cwd: confinementLaunch.runDirectory,
          env: confinementLaunch.env,
          signalTarget: input.signalTarget,
          spawnImpl: input.spawnImpl,
        },
      );
    } catch (error) {
      const failureMessage = safeLaunchFailureMessage(error);
      launchError = new BenchError(failureMessage);
      await (input.markFailedImpl ?? markRunFailed)(
        prepared.paths,
        new Error(failureMessage),
      );
    }

    if (childResult?.signal || childResult?.interruptedBy) {
      const timestamp = new Date().toISOString();
      await (input.updateMetadataImpl ?? updateRunMetadata)(prepared.paths, {
        status: "cancelled",
        updatedAt: timestamp,
        cancelledAt: timestamp,
      });
    } else if (childResult && childResult.status !== 0) {
      await (input.markFailedImpl ?? markRunFailed)(
        prepared.paths,
        new Error(`Pi exited with status ${childResult.status}`),
      );
    }
  } catch (error) {
    executionError = error;
  }

  await captureFinalizationError(finalizationErrors, () => confinementLaunch?.cleanup());
  await captureFinalizationError(finalizationErrors, async () => {
    cleanupResult = await lifecycle?.cleanup();
  });
  if (prepared && diagnosticPaths) {
    await captureFinalizationError(finalizationErrors, () => (
      input.finalizeDiagnosticsImpl ?? finalizeInteractiveDiagnostics
    )({
      kind: input.benchmark.kind,
      ...diagnosticPaths,
      fs: {
        chmod: input.chmodImpl ?? chmod,
        copyFile: input.copyFileImpl ?? copyFile,
        mkdir: input.mkdirImpl ?? mkdir,
        readdir: input.readdirImpl ?? readdir,
        rm: input.rmImpl ?? rm,
      },
    }));
  }
  if (prepared && input.benchmark.kind === "data-science") {
    await captureFinalizationError(finalizationErrors, () => (
      input.rmImpl ?? rm
    )(prepared.paths.supabaseConfigPath, { force: true }));
  }

  if (finalizationErrors.length > 0) {
    throw new BenchError(
      `Interactive run cleanup failed: ${errorMessage(finalizationErrors[0])}`,
      executionError ? { cause: executionError } : undefined,
    );
  }
  if (executionError) throw executionError;
  if (launchError) throw launchError;
  return { prepared, args, launchCommand, childResult, cleanupResult };
}

export function interactiveDiagnosticPaths(repositoryRoot, prepared, diagnosticsRoot) {
  const root = diagnosticsRoot ?? join(repositoryRoot, ".bench-runtime", "interactive-sessions");
  return {
    stagingDirectory: join(prepared.paths.runDirectory, DIAGNOSTIC_STAGING_DIRECTORY),
    destinationDirectory: join(
      root,
      prepared.run.benchmark.id,
      prepared.run.model.slug,
      prepared.run.runId,
    ),
  };
}

export async function finalizeInteractiveDiagnostics(input) {
  const fs = input.fs ?? { chmod, copyFile, mkdir, readdir, rm };
  if (input.kind === "data-science") {
    await fs.rm(input.stagingDirectory, { recursive: true, force: true });
    return { status: "discarded", files: 0 };
  }

  let entries;
  try {
    entries = await fs.readdir(input.stagingDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "missing", files: 0 };
    throw error;
  }
  const sessionFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"));
  if (sessionFiles.length > 0) {
    await fs.mkdir(input.destinationDirectory, { recursive: true, mode: 0o700 });
    for (const entry of sessionFiles) {
      const destination = join(input.destinationDirectory, entry.name);
      await fs.copyFile(join(input.stagingDirectory, entry.name), destination);
      await fs.chmod(destination, 0o600);
    }
  }
  await fs.rm(input.stagingDirectory, { recursive: true, force: true });
  return {
    status: sessionFiles.length > 0 ? "retained" : "missing",
    files: sessionFiles.length,
  };
}

async function captureFinalizationError(errors, operation) {
  try {
    await operation();
  } catch (error) {
    errors.push(error);
  }
}

function safeLaunchFailureMessage(error) {
  return /Required command not found/u.test(errorMessage(error))
    ? "Could not launch Pi because the pi command was not found."
    : "Could not launch Pi.";
}
