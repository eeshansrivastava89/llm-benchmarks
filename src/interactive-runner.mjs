import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { constants as osConstants } from "node:os";
import { join } from "node:path";

import { prepareInteractiveBenchmarkRun } from "./benchmark-suites.mjs";
import { BenchError } from "./errors.mjs";
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
  if (provider === "ollama") return { modelSource: "ollama", backendLabel: "Ollama" };
  if (provider === "omlx") return { modelSource: "omlx", backendLabel: "oMLX" };
  if (provider.includes("mtp")) {
    return { modelSource: "llama-cpp-mtp", backendLabel: "llama.cpp MTP" };
  }
  return { modelSource: "llama-cpp", backendLabel: model.provider };
}

export async function resolveLocalModelConnection(modelRuntime, model) {
  if (model.backend?.location !== "local") return null;
  const connection = { baseUrl: model.baseUrl };
  if (model.provider !== "omlx") return connection;

  let resolution;
  try {
    resolution = await modelRuntime.getAuth(model, {
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new BenchError(`Could not resolve local cleanup access for ${model.provider}/${model.id}`);
  }
  return {
    baseUrl: resolution?.auth?.baseUrl ?? model.baseUrl,
    apiKey: resolution?.auth?.apiKey,
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
  const connection = await resolveLocalModelConnection(input.modelRuntime, input.model);
  const lifecycle = await (input.lifecycleFactory ?? prepareLocalModelLifecycle)(
    input.model,
    connection,
    { ...(input.lifecycleOptions ?? {}), policy: "always" },
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
      env: input.env ?? process.env,
      platform: confinementRuntime?.platform,
      runtime: confinementRuntime?.runtime,
      executable: confinementRuntime?.executable,
    });

    await (input.updateMetadataImpl ?? updateRunMetadata)(prepared.paths, {
      runner: {
        ...prepared.run.runner,
        actualRunner: "Pi",
        launchCommand,
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

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
