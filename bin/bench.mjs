#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadProjectDataScienceAccess, loadInteractiveBenchmarkSuites } from "../src/benchmark-suites.mjs";
import { BENCHMARK_SUITE_IDS, buildSuiteChoices, suitePassthroughError, updateSuitePreferences } from "../src/suite-workflow.mjs";
import { BenchError, SelectionCancelled, errorMessage } from "../src/errors.mjs";
import { confirmInteractiveReview, confirmRun, confirmSweepWarning, modelDetails, providerDetails, selectConcurrency, selectInteractiveBenchmark, selectSamples } from "../src/cli-selection.mjs";
import { offerViewersAfterRun, parseViewCommand, runViewCommand } from "../src/cli-view.mjs";
import { discoverBenchmarks, stopActiveCapturedChildren } from "../src/inspect-discovery.mjs";
import { modelCompatibility, modelPiReady, resolveInspectModel } from "../src/inspect-translate.mjs";
import { executeInteractiveBenchmark, extensionProviderStaticGap, runForeground } from "../src/interactive-runner.mjs";
import { prepareLocalModelLifecycle } from "../src/local-lifecycle.mjs";
import { loadBenchPreferences, saveBenchPreferences } from "../src/preferences.mjs";
import { annotateProviderBackends, discoverModels } from "../src/providers.mjs";
import { buildInspectInvocation, formatCommand } from "../src/run-plan.mjs";
import { selectTaskConfiguration } from "../src/task-config.mjs";
import { BACK, BenchUI, benchUiStyle, selectedOrCancel } from "../src/ui/bench-ui.mjs";
import { formatCount } from "../src/ui/presentation.mjs";
import { VIEWER_IDS } from "../src/viewers.mjs";

// Shared error-recovery screen: compact red selector with optional Back.
function recoverFromError(ui, choices, options) {
  return ui.select(choices, { compact: true, tone: "error", ...options }).then(selectedOrCancel);
}

function setupAdvice(error) {
  const message = errorMessage(error);
  if (/Required command not found: uv|uv unavailable/i.test(message)) {
    return "Install uv, then return here and choose Retry.";
  }
  if (/no authenticated models|No authentication|\/login/i.test(message)) {
    return "Open Pi, run /login, then return here and choose Retry.";
  }
  if (/Interactive write confinement is (?:unavailable|not supported)/i.test(message)) {
    return process.platform === "linux"
      ? "Install Bubblewrap and enable unprivileged user namespaces, then choose Retry."
      : "Interactive runs require the macOS Seatbelt launcher or Linux Bubblewrap.";
  }
  if (/custom task root.*not found/i.test(message)) {
    return "Fix [tool.bench].custom-task-roots in pyproject.toml, then choose Retry.";
  }
  if (/configuration errors/i.test(message)) {
    return "Fix the reported Pi configuration issue, then choose Retry.";
  }
  return "Correct the reported setup issue, then choose Retry.";
}

export function passthroughArgs(argv) {
  if (argv.length === 0) return [];
  if (argv[0] !== "--") {
    throw new BenchError("Inspect options must follow `--`, for example: bench -- --limit 20");
  }
  return argv.slice(1);
}

async function loadConfig(cwd) {
  const configPath = resolve(cwd, "pyproject.toml");
  let source;

  try {
    source = await readFile(configPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new BenchError(`Missing configuration: ${configPath}`);
    }
    throw new BenchError(`Could not read ${configPath}: ${errorMessage(error)}`);
  }

  let parse;
  try {
    ({ parse } = await import("smol-toml"));
  } catch (error) {
    throw new BenchError(`TOML parser unavailable. Run \`npm install\`. (${errorMessage(error)})`);
  }

  let document;
  try {
    document = parse(source);
  } catch (error) {
    throw new BenchError(`Invalid ${configPath}: ${errorMessage(error)}`);
  }

  const config = document.tool?.bench;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new BenchError(`Missing [tool.bench] in ${configPath}`);
  }

  const customTaskRoots = config["custom-task-roots"];
  if (
    !Array.isArray(customTaskRoots) ||
    customTaskRoots.some((root) => typeof root !== "string" || root.length === 0)
  ) {
    throw new BenchError("[tool.bench].custom-task-roots must be an array of paths");
  }
  if (customTaskRoots.some(isAbsolute)) {
    throw new BenchError("[tool.bench].custom-task-roots must be relative to the project directory");
  }

  const logDir = config["log-dir"];
  if (typeof logDir !== "string" || logDir.length === 0) {
    throw new BenchError("[tool.bench].log-dir must be a non-empty path");
  }

  const taskConfigDir = config["task-config-dir"] ?? "bench-configs";
  if (typeof taskConfigDir !== "string" || taskConfigDir.length === 0 || isAbsolute(taskConfigDir)) {
    throw new BenchError("[tool.bench].task-config-dir must be a non-empty relative path");
  }

  const missingRoots = [];
  await Promise.all(
    customTaskRoots.map(async (root) => {
      try {
        await access(resolve(cwd, root));
      } catch {
        missingRoots.push(root);
      }
    }),
  );
  if (missingRoots.length > 0) {
    throw new BenchError(`Configured custom task root${missingRoots.length === 1 ? "" : "s"} not found: ${missingRoots.sort().join(", ")}`);
  }

  return { customTaskRoots, logDir, taskConfigDir };
}

const HELP_TEXT = `Bench — one workflow for Inspect evals, Visual Bench, and Data Science benchmarks.

Usage:
  bench                 Pick a provider, model, suite, and benchmark, then run it
  bench view            Choose a results viewer interactively
  bench view inspect    Start or reuse the Inspect results viewer and open it
  bench view visual     Start or reuse the Visual/Data Science viewer and open it
  bench view both       Start both viewers and open Visual as the hub
  bench view status     Show viewer URLs, health, and Bench ownership
  bench view stop [inspect|visual|both]
                        Stop validated Bench-owned viewers (default: both)
  bench -- [options]    Inspect eval options for the Inspect suite,
                        for example: bench -- --limit 20 --epochs 3
  bench --help          Show this help
  bench --version       Show the Bench version

Environment:
  BENCH_INSPECT_VIEWER_PORT, BENCH_VISUAL_VIEWER_PORT
                        Override the default viewer ports (7575, 4321)
  BENCH_VERBOSE=1       Print the redacted launch command before running
  NO_COLOR              Disable terminal styling

Project guide: README.md in the Bench repository.
`;

async function printVersion() {
  const manifest = JSON.parse(await readFile(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
  console.log(`bench ${manifest.version}`);
}

// `main` is exported with injectable collaborators so the interactive stage
// machine can be driven end to end without a terminal, a local model server, or
// a real Inspect installation. Production callers pass no options.
export async function main(argv = process.argv.slice(2), options = {}) {
  const {
    cwd: cwdOption,
    createUi = (uiOptions) => new BenchUI(uiOptions),
    loadConfig: loadInspectConfig = loadConfig,
    discoverProviderModels = discoverModels,
    discoverInteractiveSuites = loadInteractiveBenchmarkSuites,
    resolveInspect = resolveInspectModel,
    discoverInspectBenchmarks = discoverBenchmarks,
    skipTtyCheck = false,
  } = options;
  const cwd = cwdOption ?? process.cwd();
  if (argv.length === 1 && ["--help", "-h", "help"].includes(argv[0])) {
    console.log(HELP_TEXT);
    return;
  }
  if (argv.length === 1 && ["--version", "-v", "version"].includes(argv[0])) {
    await printVersion();
    return;
  }
  const viewCommand = parseViewCommand(argv);
  if (viewCommand) {
    await runViewCommand(cwd, viewCommand);
    return;
  }
  const inspectPassthrough = passthroughArgs(argv);
  if (!skipTtyCheck && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new BenchError("Bench requires an interactive terminal");
  }
  let ui;
  ui = createUi({
    cancelLoading: () => {
      stopActiveCapturedChildren();
      ui.stop();
      process.exit(130);
    },
  });
  let lifecycle = null;

  ui.start();
  try {
    let config = null;
    let modelRuntime;
    let providers;
    let diagnostics;
    let benchmarkSources = null;
    let interactiveSuites;
    while (!interactiveSuites) {
      ui.showLoading("Finding Pi models and benchmark suites…");
      try {
        const [modelDiscovery, discoveredSuites] = await Promise.all([
          discoverProviderModels(cwd),
          discoverInteractiveSuites({ repositoryRoot: cwd }),
        ]);
        ({ modelRuntime, providers, diagnostics } = modelDiscovery);
        interactiveSuites = discoveredSuites;
      } catch (error) {
        const recovery = await recoverFromError(ui, [
          { action: "retry", label: "Retry", detail: "Run the setup checks again" },
          { action: "quit", label: "Quit", detail: "Exit Bench" },
        ], {
          step: "Setup",
          title: "Bench could not finish setup",
          message: "Fix the issue below, then retry without losing the terminal session.",
          details: () => [
            benchUiStyle.muted("WHAT TO DO"),
            setupAdvice(error),
            "",
            benchUiStyle.muted("TECHNICAL DETAILS"),
            errorMessage(error),
          ],
        });
        if (recovery.action === "quit") throw new SelectionCancelled();
      }
    }
    if (diagnostics.length > 0) {
      ui.flash(`Pi reported ${diagnostics.length} non-fatal configuration notice${diagnostics.length === 1 ? "" : "s"}.`);
    }

    const preferences = await loadBenchPreferences(cwd);
    let selectedProvider = null;
    let selectedModel = null;
    let selectedSuite = null;
    let selectedTask = null;
    let selectedInteractiveBenchmark = null;
    let preferredModelId = preferences.model ?? null;
    let preferredTaskSpec = preferences.task ?? null;
    let selectedSourceId = preferences.source ?? "inspect_evals_recommended";
    let preferredSuiteId = preferences.suite ?? BENCHMARK_SUITE_IDS.inspect;
    let translated = null;
    let taskConfiguration = null;
    let samples = null;
    let concurrency = null;
    let inspectArgs = null;
    let dataScienceAccess = null;
    let configureWasInteractive = false;
    let samplesWereInteractive = false;
    let concurrencyWasInteractive = false;
    let stage = "provider";

    while (stage !== "launch") {
      if (stage === "provider") {
        let result = selectedOrCancel(await ui.select(providers, {
          step: "1 Provider",
          title: "Choose where your model comes from",
          message: "Local providers run on this machine. Cloud providers send requests to a remote API.",
          listTitle: "Providers",
          detailTitle: "About this provider",
          label: (provider) => provider.backend.status === "offline"
            ? benchUiStyle.warning(`⚠ ${provider.provider}`)
            : provider.provider,
          summary: ({ models, backend }) => `${backend.location}  ·  ${models.length} model${models.length === 1 ? "" : "s"}${backend.status ? `  ·  ${backend.status}` : ""}`,
          details: (provider) => [
            ...providerDetails(provider),
            ...(diagnostics.length > 0 ? ["", "PI CONFIGURATION NOTICES", ...diagnostics] : []),
          ],
          searchText: ({ provider, backend }) => `${provider} ${backend.location} ${backend.status ?? ""}`,
          searchPlaceholder: "provider name or local/cloud",
          searchable: true,
          isInitial: ({ provider }) => provider === selectedProvider?.provider || provider === preferences.provider,
        }));
        if (result.refreshModels) {
          ui.showLoading("Refreshing installed models…", result.provider);
          result = await result.refreshModels();
          providers[providers.findIndex(({ provider }) => provider === result.provider)] = result;
        }
        if (result.backend.location === "local" && result.backend.status === "offline") {
          const recovery = await recoverFromError(ui, [
            { action: "another", label: "Choose another provider", detail: "Return to the provider browser" },
            { action: "retry", label: "Retry server check", detail: "Check whether the local server is now running" },
          ], {
            step: "1 Provider",
            context: result.provider,
            title: "Local server is unavailable",
            message: "Start the server and check its Pi connection settings, then retry.",
            details: () => providerDetails(result),
            allowBack: true,
          });
          if (recovery === BACK || recovery.action === "another") continue;
          ui.showLoading("Checking the local server…", result.provider);
          const refreshed = result.refreshModels
            ? await result.refreshModels()
            : (await annotateProviderBackends([result]))[0];
          const providerIndex = providers.findIndex(({ provider }) => provider === refreshed.provider);
          if (providerIndex >= 0) providers[providerIndex] = refreshed;
          result = refreshed;
          if (result.backend.status === "offline") {
            ui.flash(`${result.provider} is still offline.`);
            continue;
          }
        }
        if (result.models.length === 0) {
          ui.flash(`${result.provider} has no installed generation models. Download a model, then select the provider again.`);
          continue;
        }
        if (selectedProvider?.provider !== result.provider) {
          selectedModel = null;
          preferredModelId = result.provider === preferences.provider ? preferences.model ?? null : null;
        }
        selectedProvider = result;
        selectedTask = null;
        stage = "model";
        continue;
      }

      if (stage === "model") {
        const modelChoices = selectedProvider.models.map((model) => ({
          model,
          piReady: modelPiReady(model),
          compatibility: modelCompatibility(modelRuntime, model),
        }));
        const result = selectedOrCancel(await ui.select(modelChoices, {
          step: "2 Model",
          context: selectedProvider.provider,
          title: "Choose a model",
          message: "Pi can use every available model. Inspect compatibility is shown before you choose a suite.",
          listTitle: "Models",
          detailTitle: "What this model can do",
          label: ({ model, piReady }) => piReady ? model.id : benchUiStyle.error(`× ${model.id}`),
          summary: ({ model, compatibility, piReady }) => !piReady
            ? `Unavailable · ${model.unavailableReason ? "missing model metadata" : "local server offline"}`
            : compatibility.ready
              ? `Pi + Inspect  ·  ${model.input?.includes("image") ? "text + images" : "text"}  ·  ${formatCount(model.contextWindow)} max input`
              : `Pi only  ·  Inspect: ${compatibility.short}`,
          details: modelDetails,
          searchText: ({ model }) => `${model.id} ${model.name ?? ""} ${model.input?.join(" ") ?? ""} ${model.api}`,
          searchPlaceholder: "model name, capability, or API format",
          searchable: true,
          isInitial: ({ model }) => model.id === selectedModel?.id || model.id === preferredModelId,
          allowBack: true,
        }));
        if (result === BACK) {
          stage = "provider";
          continue;
        }
        if (!result.piReady) {
          await recoverFromError(ui, [
            { action: "back", label: "Choose another model", detail: "Return to the model browser" },
          ], {
            step: "2 Model",
            context: result.model.id,
            title: "This local model is unavailable",
            message: result.model.unavailableReason ?? "Start its local server before using it with Pi or Inspect.",
            details: () => modelDetails(result),
            allowBack: true,
          });
          continue;
        }
        const extensionGap = await extensionProviderStaticGap(modelRuntime, result.model);
        if (extensionGap) {
          const recovery = await recoverFromError(ui, [
            { action: "another", label: "Choose another model", detail: "Return to the model browser" },
            { action: "continue", label: "Continue anyway", detail: "Accept the limitation for interactive runs" },
          ], {
            step: "2 Model",
            context: result.model.id,
            title: "This provider depends on a Pi extension",
            message: "Interactive runs start Pi without extensions. Bench writes this provider into the private run configuration, but its shape cannot be fully replicated there.",
            details: () => [
              benchUiStyle.muted("WHAT WAS CHECKED"),
              extensionGap,
              "",
              "Inspect evals are unaffected: Inspect uses its own connection translation.",
            ],
            tone: "warning",
            allowBack: true,
          });
          if (recovery.action === "another") continue;
        }
        selectedModel = result.model;
        preferredModelId = selectedModel.id;
        translated = null;
        lifecycle = null;
        dataScienceAccess = null;
        stage = "suite";
        continue;
      }

      if (stage === "suite") {
        const compatibility = modelCompatibility(modelRuntime, selectedModel);
        const suiteChoices = buildSuiteChoices(interactiveSuites, compatibility);
        const result = selectedOrCancel(await ui.select(suiteChoices, {
          step: "3 Suite",
          context: `${selectedModel.provider}/${selectedModel.id}`,
          title: "Choose a benchmark suite",
          message: "Inspect runs scored eval tasks. Visual and Data Science hand an isolated run folder to Pi.",
          listTitle: "Suites",
          detailTitle: "How this suite runs",
          label: (suite) => suite.label,
          summary: (suite) => suite.detail,
          details: (suite) => [suite.description, "", suite.detail],
          searchText: (suite) => `${suite.id} ${suite.label} ${suite.description}`,
          searchable: true,
          isInitial: (suite) => suite.id === selectedSuite?.id || suite.id === preferredSuiteId,
          allowBack: true,
        }));
        if (result === BACK) {
          stage = "model";
          continue;
        }

        const passthroughError = suitePassthroughError(result.id, inspectPassthrough);
        if (passthroughError) {
          const recovery = await recoverFromError(ui, [
            { action: "back", label: "Choose another suite", detail: "Return to the suite browser" },
            { action: "inspect", label: "Use Inspect evals", detail: "Keep the command-line options" },
          ], {
            step: "3 Suite",
            context: result.label,
            title: "Inspect-only command-line options",
            message: passthroughError,
            details: () => [
              benchUiStyle.muted("OPTIONS RECEIVED"),
              inspectPassthrough.join(" "),
              "",
              "Remove the arguments after -- to use an interactive Pi suite.",
            ],
            allowBack: true,
          });
          if (recovery !== BACK && recovery.action === "inspect") {
            preferredSuiteId = BENCHMARK_SUITE_IDS.inspect;
          }
          continue;
        }

        if (result.id === BENCHMARK_SUITE_IDS.inspect && !compatibility.ready) {
          const recovery = await recoverFromError(ui, [
            { action: "suite", label: "Choose another suite", detail: "Use this model through interactive Pi" },
            { action: "model", label: "Choose another model", detail: "Find a Pi + Inspect model" },
          ], {
            step: "3 Suite",
            context: `${selectedModel.provider}/${selectedModel.id}`,
            title: "This model cannot run Inspect evals",
            message: compatibility.reason,
            details: () => modelDetails({ model: selectedModel, compatibility, piReady: true }),
            allowBack: true,
          });
          stage = recovery === BACK || recovery.action === "suite" ? "suite" : "model";
          continue;
        }

        selectedSuite = result.suite ?? { id: result.id, label: result.label };
        preferredSuiteId = result.id;
        if (result.id !== BENCHMARK_SUITE_IDS.inspect) {
          stage = "interactive-benchmark";
          continue;
        }

        let resolutionAction = "retry";
        while (resolutionAction === "retry") {
          ui.showLoading("Checking Inspect authentication and model settings…", `${selectedProvider.provider}/${selectedModel.id}`);
          try {
            translated = await resolveInspect(modelRuntime, selectedModel);
            resolutionAction = "continue";
          } catch (error) {
            const recovery = await recoverFromError(ui, [
              { action: "suite", label: "Choose another suite", detail: "Use this model through interactive Pi" },
              { action: "model", label: "Choose another model", detail: "Return to the model browser" },
              { action: "retry", label: "Retry", detail: "Check the same model again" },
            ], {
              step: "3 Suite",
              context: `${selectedProvider.provider}/${selectedModel.id}`,
              title: "Could not prepare this model for Inspect",
              message: "Bench could not translate its current Pi authentication into an Inspect connection.",
              details: () => ["TECHNICAL DETAILS", errorMessage(error)],
              allowBack: true,
            });
            resolutionAction = recovery === BACK ? "suite" : recovery.action;
          }
        }
        if (resolutionAction !== "continue") {
          stage = resolutionAction;
          continue;
        }

        // Tracked separately from `stage`: on the happy path `stage` is already
        // "suite" here, so it cannot also carry the recovery decision.
        let discoveryAction = "retry";
        while (discoveryAction === "retry") {
          ui.showLoading("Finding Inspect benchmarks…");
          try {
            config = await loadInspectConfig(cwd);
            benchmarkSources = await discoverInspectBenchmarks(cwd, config.customTaskRoots);
            discoveryAction = "continue";
          } catch (error) {
            const recovery = await recoverFromError(ui, [
              { action: "suite", label: "Choose another suite", detail: "Return to suite selection" },
              { action: "retry", label: "Retry", detail: "Run Inspect discovery again" },
            ], {
              step: "3 Suite",
              context: "Inspect evals",
              title: "Could not load Inspect benchmarks",
              message: "Interactive Pi suites remain available.",
              details: () => [
                benchUiStyle.muted("WHAT TO DO"),
                setupAdvice(error),
                "",
                benchUiStyle.muted("TECHNICAL DETAILS"),
                errorMessage(error),
              ],
              allowBack: true,
            });
            discoveryAction = recovery === BACK || recovery.action === "suite" ? "suite" : "retry";
          }
        }
        if (discoveryAction !== "continue") {
          stage = discoveryAction;
          continue;
        }
        stage = "benchmark";
        continue;
      }

      if (stage === "interactive-benchmark") {
        const preferredBenchmarkId = selectedInteractiveBenchmark?.kind === selectedSuite.id
          ? selectedInteractiveBenchmark.id
          : preferences.benchmarks?.[selectedSuite.id] ?? null;
        const result = await selectInteractiveBenchmark(
          selectedSuite,
          selectedModel,
          preferredBenchmarkId,
          ui,
        );
        if (result === BACK) {
          stage = "suite";
          continue;
        }
        selectedInteractiveBenchmark = result;
        dataScienceAccess = null;

        if (selectedSuite.id === BENCHMARK_SUITE_IDS.dataScience) {
          let accessAction = "retry";
          while (accessAction === "retry") {
            ui.showLoading("Checking Data Science project access…", "SUPABASE_URL + SUPABASE_ANON_KEY");
            try {
              dataScienceAccess = await loadProjectDataScienceAccess({ repositoryRoot: cwd });
              accessAction = "continue";
            } catch (error) {
              const recovery = await recoverFromError(ui, [
                { action: "benchmark", label: "Choose another benchmark", detail: "Return to the benchmark browser" },
                { action: "suite", label: "Choose another suite", detail: "Return to suite selection" },
                { action: "retry", label: "Retry", detail: "Read the project configuration again" },
              ], {
                step: "4 Benchmark",
                context: selectedInteractiveBenchmark.title,
                title: "Data Science access is not configured",
                message: "Add SUPABASE_URL and SUPABASE_ANON_KEY to the shell or project .env before continuing.",
                details: () => [benchUiStyle.muted("TECHNICAL DETAILS"), errorMessage(error)],
                allowBack: true,
              });
              accessAction = recovery === BACK ? "benchmark" : recovery.action;
            }
          }
          if (accessAction !== "continue") {
            stage = accessAction === "benchmark" ? "interactive-benchmark" : "suite";
            continue;
          }
        }
        stage = "interactive-review";
        continue;
      }

      if (stage === "benchmark") {
        const result = selectedOrCancel(await ui.browseBenchmarks(benchmarkSources, {
          step: "4 Benchmark",
          context: `${selectedModel.provider}/${selectedModel.id}`,
          initialSource: selectedSourceId,
          initialTaskSpec: selectedTask?.spec ?? preferredTaskSpec,
        }));
        if (result === BACK) {
          stage = "suite";
          continue;
        }
        selectedSourceId = result.source;
        if (!await confirmSweepWarning(result.task, ui)) continue;
        selectedTask = result.task;
        preferredTaskSpec = selectedTask.spec;
        taskConfiguration = null;
        samples = null;
        concurrency = null;
        configureWasInteractive = false;
        samplesWereInteractive = false;
        concurrencyWasInteractive = false;
        stage = "configure";
        continue;
      }

      if (stage === "configure") {
        const interactionBefore = ui.interactionCount;
        const result = await selectTaskConfiguration(
          cwd,
          config,
          selectedTask,
          inspectPassthrough,
          ui,
          taskConfiguration,
        );
        configureWasInteractive = ui.interactionCount > interactionBefore;
        if (result === BACK) {
          stage = "benchmark";
          continue;
        }
        taskConfiguration = result;
        samplesWereInteractive = false;
        concurrencyWasInteractive = false;
        stage = "samples";
        continue;
      }

      if (stage === "samples") {
        const interactionBefore = ui.interactionCount;
        const result = await selectSamples(
          selectedTask,
          inspectPassthrough,
          taskConfiguration,
          ui,
          samples,
        );
        samplesWereInteractive = ui.interactionCount > interactionBefore;
        if (result === BACK) {
          stage = configureWasInteractive ? "configure" : "benchmark";
          continue;
        }
        samples = result;
        concurrencyWasInteractive = false;
        stage = "concurrency";
        continue;
      }

      if (stage === "concurrency") {
        const interactionBefore = ui.interactionCount;
        const result = await selectConcurrency(selectedModel, inspectPassthrough, ui, concurrency);
        concurrencyWasInteractive = ui.interactionCount > interactionBefore;
        if (result === BACK) {
          stage = samplesWereInteractive
            ? "samples"
            : configureWasInteractive ? "configure" : "benchmark";
          continue;
        }
        concurrency = result;
        ui.showLoading("Preparing the final run plan…", `${selectedModel.provider}/${selectedModel.id}  →  ${selectedTask.displayName}`);
        lifecycle = await prepareLocalModelLifecycle(selectedModel, {
          baseUrl: translated.baseUrl,
          apiKey: translated.childEnv?.[translated.apiKeyEnv],
        });
        stage = "review";
        continue;
      }

      if (stage === "review") {
        inspectArgs = buildInspectInvocation(
          selectedTask,
          selectedModel,
          translated,
          config,
          [
            ...taskConfiguration.args,
            ...samples.args,
            ...(concurrency?.args ?? []),
            ...inspectPassthrough,
          ],
        );
        const confirmed = await confirmRun(
          selectedModel,
          translated,
          selectedTask,
          taskConfiguration,
          samples,
          concurrency,
          lifecycle,
          config,
          inspectPassthrough,
          formatCommand("uv", inspectArgs, translated.apiKeyEnv),
          ui,
        );
        if (!confirmed) {
          stage = concurrencyWasInteractive
            ? "concurrency"
            : samplesWereInteractive
              ? "samples"
              : configureWasInteractive ? "configure" : "benchmark";
          continue;
        }
        stage = "launch";
        continue;
      }

      if (stage === "interactive-review") {
        const confirmed = await confirmInteractiveReview(
          cwd,
          selectedSuite,
          selectedInteractiveBenchmark,
          selectedModel,
          ui,
        );
        stage = confirmed ? "launch" : "interactive-benchmark";
      }
    }

    await saveBenchPreferences(cwd, updateSuitePreferences(preferences, {
      provider: selectedProvider.provider,
      model: selectedModel.id,
      suite: selectedSuite.id,
      inspectSource: selectedTask ? selectedSourceId : undefined,
      inspectTask: selectedTask?.spec,
      benchmark: selectedInteractiveBenchmark,
    })).catch(() => {});

    ui.stop({ preserveScreen: true });
    if (selectedSuite.id !== BENCHMARK_SUITE_IDS.inspect) {
      console.log(`\nPreparing ${selectedInteractiveBenchmark.title} with ${selectedModel.provider}/${selectedModel.id}.`);
      const execution = await executeInteractiveBenchmark({
        repositoryRoot: cwd,
        benchmark: selectedInteractiveBenchmark,
        model: selectedModel,
        modelRuntime,
        dataScienceAccess,
        onPrepared: ({ prepared, launchCommand }) => {
          console.log(`Run slot: ${prepared.paths.runDirectory}`);
          if (process.env.BENCH_VERBOSE === "1") console.log(`$ ${launchCommand}`);
          console.log("Starting interactive Pi…\n");
        },
      });
      const exitStatus = execution.childResult?.status ?? 1;
      process.exitCode = exitStatus;
      console.log(exitStatus === 0
        ? `\nPi exited. The prepared run is at ${execution.prepared.paths.runDirectory}.`
        : `\nPi exited with status ${exitStatus}. Run metadata was updated at ${execution.prepared.paths.runDirectory}.`);
      if (execution.cleanupResult?.message) {
        const cleanupMessage = `Local model: ${execution.cleanupResult.message}.`;
        if (execution.cleanupResult.status === "failed") console.error(`Warning: ${cleanupMessage}`);
        else console.log(cleanupMessage);
      }
      if (exitStatus === 0) await offerViewersAfterRun(cwd, VIEWER_IDS.visual);
      return;
    }

    console.log(`\nStarting ${selectedTask.displayName} with ${selectedModel.provider}/${selectedModel.id}.`);
    console.log(`Inspect will save results under ${config.logDir}.`);
    if (process.env.BENCH_VERBOSE === "1") {
      console.log(`$ ${formatCommand("uv", inspectArgs, translated.apiKeyEnv)}`);
    }
    console.log();

    let exitStatus = 1;
    let cleanupResult = null;
    try {
      exitStatus = (await runForeground("uv", inspectArgs, {
        cwd,
        env: translated.childEnv,
      })).status;
    } finally {
      cleanupResult = await lifecycle?.cleanup();
    }
    process.exitCode = exitStatus;
    console.log(exitStatus === 0
      ? `\nBench completed. Results are under ${config.logDir}. Run \`bench view inspect\` to browse them.`
      : `\nBench stopped because Inspect exited with status ${exitStatus}.`);
    if (cleanupResult?.message) {
      const cleanupMessage = `Local model: ${cleanupResult.message}.`;
      if (cleanupResult.status === "failed") console.error(`Warning: ${cleanupMessage}`);
      else console.log(cleanupMessage);
    }
    if (exitStatus === 0) await offerViewersAfterRun(cwd, VIEWER_IDS.inspect);
  } finally {
    ui.stop({ preserveScreen: true });
  }
}

async function runCli() {
  try {
    await main();
  } catch (error) {
    if (error instanceof SelectionCancelled) {
      console.error("Cancelled.");
      process.exitCode = 130;
      return;
    }
    console.error(`Error: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  await runCli();
}