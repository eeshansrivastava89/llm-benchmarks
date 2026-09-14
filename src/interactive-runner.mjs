import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { constants as osConstants } from "node:os";

import { prepareInteractiveBenchmarkRun } from "./benchmark-suites.mjs";
import { BenchError } from "./errors.mjs";
import { prepareLocalModelLifecycle } from "./local-lifecycle.mjs";
import { updateRunMetadata, markRunFailed } from "./lib/runs.ts";
import { formatCommand } from "./run-plan.mjs";

const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM"];

export function buildPiInvocation(model, benchmark) {
  if (!model?.provider || !model?.id) {
    throw new BenchError("A Pi provider and model are required for an interactive run");
  }
  if (!benchmark?.title) {
    throw new BenchError("A benchmark title is required for an interactive run");
  }
  return [
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
  const args = buildPiInvocation(input.model, input.benchmark);
  const modelMetadata = interactiveModelMetadata(input.model);
  const connection = await resolveLocalModelConnection(input.modelRuntime, input.model);
  const lifecycle = await (input.lifecycleFactory ?? prepareLocalModelLifecycle)(
    input.model,
    connection,
    { ...(input.lifecycleOptions ?? {}), policy: "always" },
  );
  const prepared = await (input.prepareRunImpl ?? prepareInteractiveBenchmarkRun)({
    repositoryRoot: input.repositoryRoot,
    runsRoot: input.runsRoot,
    benchmark: input.benchmark,
    modelId: input.model.id,
    baseUrl: input.model.baseUrl,
    dataScienceAccess: input.dataScienceAccess,
    ...modelMetadata,
  });
  const launchCommand = formatCommand(command, args);
  let childResult = null;
  let cleanupResult = null;
  let launchError = null;

  try {
    await (input.updateMetadataImpl ?? updateRunMetadata)(prepared.paths, {
      runner: {
        ...prepared.run.runner,
        actualRunner: "Pi",
        launchCommand,
      },
    });
    await input.onPrepared?.({ prepared, args, launchCommand });

    try {
      childResult = await (input.runForegroundImpl ?? runForeground)(command, args, {
        cwd: prepared.paths.runDirectory,
        env: input.env ?? process.env,
        signalTarget: input.signalTarget,
        spawnImpl: input.spawnImpl,
      });
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
  } finally {
    cleanupResult = await lifecycle?.cleanup();
    if (input.benchmark.kind === "data-science") {
      await (input.rmImpl ?? rm)(prepared.paths.supabaseConfigPath, { force: true });
    }
  }

  if (launchError) throw launchError;
  return { prepared, args, launchCommand, childResult, cleanupResult };
}

function safeLaunchFailureMessage(error) {
  return /Required command not found/u.test(errorMessage(error))
    ? "Could not launch Pi because the pi command was not found."
    : "Could not launch Pi.";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
