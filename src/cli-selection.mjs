import { sweepWarningLines } from "./catalog.mjs";
import { apiLabel } from "./inspect-translate.mjs";
import { formatSampleCount, hasInspectOption, inspectOptionValue, localConcurrencyChoices, sampleChoices } from "./run-plan.mjs";
import { interactiveBenchmarkDetails, buildInteractiveReview } from "./suite-workflow.mjs";
import { BACK, benchUiStyle, selectedOrCancel } from "./ui/bench-ui.mjs";
import { formatCount, taskWarning } from "./ui/presentation.mjs";

function providerStatus(provider) {
  const { backend } = provider;
  if (backend.location === "local") {
    return backend.status === "online"
      ? benchUiStyle.success("● Local · server online")
      : backend.status === "offline"
        ? benchUiStyle.error("× Local · server offline")
        : benchUiStyle.warning("○ Local · server status unknown");
  }
  if (backend.location === "cloud") return "Cloud · remote API";
  return "Mixed or unknown location";
}

export function providerDetails(provider) {
  const { backend, models } = provider;
  const lines = [
    provider.provider,
    "",
    benchUiStyle.muted("WHERE IT RUNS"),
    providerStatus(provider),
    "",
  ];
  if (backend.location === "local") {
    lines.push(
      backend.status === "online"
        ? "The server is reachable from this machine."
        : "Start the local model server before running a benchmark.",
      "Speed and memory use depend on your hardware.",
    );
  } else {
    lines.push(
      "Requests are sent to a remote provider.",
      "Provider pricing, limits, and data policies apply.",
    );
  }
  if (provider.discoveryError) lines.push("", provider.discoveryError);
  lines.push("", benchUiStyle.muted("AVAILABLE MODELS"), String(models.length));
  return lines;
}

export function modelDetails(choice) {
  const { model, compatibility, piReady = true } = choice;
  const lines = [
    model.name || model.id,
    !piReady
      ? benchUiStyle.error(`× ${model.unavailableReason ?? "Local server is offline"}`)
      : compatibility.ready
        ? benchUiStyle.success("✓ Pi + Inspect")
        : benchUiStyle.success("✓ Available through Pi"),
    ...(!compatibility.ready && piReady
      ? [benchUiStyle.warning(`Inspect: ${compatibility.reason}`)]
      : []),
    "",
    benchUiStyle.muted("CAPABILITIES"),
    `Input: ${model.input ? model.input.includes("image") ? "Text and images" : "Text" : "Not advertised"}`,
    `Reasoning: ${model.reasoning === undefined ? "Not advertised" : model.reasoning ? "Supported" : "Not supported"}`,
    ...(model.localModelPolicy ? [
      `Output limit: ${model.localModelPolicy.output === "server" ? "Server-managed" : "Explicit Pi setting"}`,
      `Thinking control: ${model.localModelPolicy.thinking === "server" ? "Server-managed until explicitly changed in Pi" : "Pi configuration"}`,
    ] : []),
    "",
    benchUiStyle.muted("MAXIMUM INPUT"),
    Number.isFinite(model.contextWindow) ? `${formatCount(model.contextWindow)} tokens` : "Not advertised",
    "How much information the model can consider at once.",
    "",
    benchUiStyle.muted("WHERE IT RUNS"),
    model.backend.location === "local"
      ? `${model.backend.status === "online" ? "●" : "×"} This machine · server ${model.backend.status}`
      : "Cloud · requests go to the provider",
    "",
    benchUiStyle.muted("ADVANCED"),
    `Model ID: ${model.id}`,
    `API format: ${apiLabel(model.api)}`,
  ];
  return lines;
}

export async function confirmSweepWarning(task, ui) {
  const lines = sweepWarningLines(task);
  if (!lines) return true;
  const selected = selectedOrCancel(await ui.select(
    [
      { action: "back", label: "Choose another benchmark", detail: "Return to the benchmark browser" },
      { action: "continue", label: "Continue anyway", detail: "Configure and run this benchmark" },
    ],
    {
      step: "4 Benchmark",
      context: task.displayName,
      title: "Compatibility warning",
      message: lines[0],
      label: (item) => item.label,
      summary: (item) => item.detail,
      details: () => ["HISTORICAL CHECK", ...lines.slice(1)],
      compact: true,
      tone: "warning",
      allowBack: true,
    },
  ));
  return selected !== BACK && selected.action === "continue";
}

async function askPositiveInteger(ui, label, maximum = null, context = "", step = "6 Samples", initialValue = null) {
  const range = Number.isInteger(maximum) ? `1–${formatSampleCount(maximum)}` : "a positive whole number";
  const result = selectedOrCancel(await ui.input({
    step,
    context,
    title: label,
    message: `Enter ${range}.`,
    placeholder: Number.isInteger(maximum) ? `1–${maximum}` : "1 or greater",
    initialValue: initialValue === null ? "" : String(initialValue),
    allowBack: true,
    validate: (answer) => {
      const value = Number(answer.trim());
      return Number.isSafeInteger(value) && value > 0 && (maximum === null || value <= maximum)
        ? null
        : `Enter ${range}.`;
    },
  }));
  return result === BACK ? BACK : Number(result.trim());
}

export async function selectSamples(task, inspectPassthrough, taskConfiguration = { path: null }, ui, previous = null) {
  const sampleId = inspectOptionValue(inspectPassthrough, "--sample-id");
  if (sampleId !== null) {
    return { args: [], limit: null, summary: `Specific sample ${sampleId} · command line`, risk: "normal" };
  }
  const explicitLimit = inspectOptionValue(inspectPassthrough, "--limit");
  if (explicitLimit !== null) {
    const numericLimit = Number(explicitLimit);
    return {
      args: [],
      limit: explicitLimit,
      summary: `${explicitLimit} sample limit · command line`,
      risk: Number.isFinite(numericLimit) && numericLimit > 100 ? "high" : "normal",
    };
  }
  if (task.sampleCount === 1) {
    return { args: [], limit: 1, summary: "Complete task · 1 sample", risk: "normal" };
  }

  const choices = sampleChoices(task.sampleCount);
  const presetLimits = new Set(choices.filter(({ action }) => action === "limit").map(({ limit }) => limit));
  const selected = selectedOrCancel(await ui.select(choices, {
    step: "6 Samples",
    context: task.displayName,
    title: "Sample budget",
    message: Number.isInteger(task.sampleCount)
      ? taskConfiguration.path
        ? `${formatSampleCount(task.sampleCount)} samples with defaults; the task config may reduce this.`
        : `${formatSampleCount(task.sampleCount)} samples with official defaults.`
      : "This task does not publish an exact sample count.",
    label: (choice) => choice.label,
    summary: (choice) => choice.detail,
    details: (choice) => [
      choice.detail,
      ...(choice.action === "limit"
        ? ["", "REPEATABILITY", "Bench uses the same random subset on repeated runs.", "Advanced: sample shuffle seed 42"]
        : []),
      ...(choice.action === "all"
        ? ["", "CAUTION", "Runtime and provider usage depend on the task and model."]
        : []),
    ],
    compact: true,
    isInitial: (choice) => previous
      ? choice.action === "all"
        ? previous.limit === null
        : choice.action === "custom"
          ? previous.limit !== null && !presetLimits.has(previous.limit)
          : choice.limit === previous.limit
      : choice.limit === 1,
    allowBack: true,
  }));
  if (selected === BACK) return BACK;

  const limit = selected.action === "custom"
    ? await askPositiveInteger(ui, "Sample count", task.sampleCount, task.displayName, "6 Samples", previous?.limit ?? null)
    : selected.limit;
  if (limit === BACK) return BACK;
  if (limit === null) {
    return {
      args: [],
      limit,
      summary: Number.isInteger(task.sampleCount)
        ? `Full dataset · ${formatSampleCount(task.sampleCount)} sample${task.sampleCount === 1 ? "" : "s"}`
        : "No sample limit · dataset size unknown",
      risk: !Number.isInteger(task.sampleCount) || task.sampleCount > 100 ? "high" : "normal",
    };
  }

  const usesCommandLineShuffle = hasInspectOption(inspectPassthrough, "--sample-shuffle");
  const shuffleArgs = usesCommandLineShuffle ? [] : ["--sample-shuffle", "42"];
  const sampling = usesCommandLineShuffle ? "sampling order from command line" : "shuffled, seed 42";
  const runLabel = selected.action === "custom" ? "Custom run" : selected.label.split(" · ")[0];
  return {
    args: [...shuffleArgs, "--limit", String(limit)],
    limit,
    summary: Number.isInteger(task.sampleCount)
      ? `${runLabel} · ${formatSampleCount(limit)} of ${formatSampleCount(task.sampleCount)} · same random subset`
      : `${runLabel} · ${formatSampleCount(limit)} sample${limit === 1 ? "" : "s"} maximum · same random subset`,
    detail: sampling,
    risk: limit > 100 ? "high" : "normal",
  };
}

export async function selectConcurrency(model, inspectPassthrough, ui, previous = null) {
  if (model.backend.location !== "local") return null;

  const explicitMaximum = inspectOptionValue(inspectPassthrough, "--max-connections");
  if (explicitMaximum !== null) {
    return {
      args: [],
      connections: explicitMaximum,
      summary: `${explicitMaximum} request${explicitMaximum === "1" ? "" : "s"} at a time · command line`,
    };
  }
  const explicitAdaptive = inspectOptionValue(inspectPassthrough, "--adaptive-connections");
  if (explicitAdaptive !== null) {
    return {
      args: [],
      connections: null,
      summary: `adaptive ${explicitAdaptive} · command line`,
    };
  }

  const selected = selectedOrCancel(await ui.select(localConcurrencyChoices(), {
    step: "7 Concurrency",
    context: `${model.provider}/${model.id}  ·  local model`,
    title: "Request concurrency",
    message: "More parallel requests can finish sooner, but they use more memory. Choose Safe if unsure.",
    label: (choice) => choice.label,
    summary: (choice) => choice.detail,
    details: (choice) => [
      choice.detail,
      "",
      `REQUESTS AT ONCE: ${choice.connections ?? "decided by Inspect"}`,
      ...(choice.action === "adaptive" ? ["", "CAUTION", "Inspect may choose a high value for one local server."] : []),
    ],
    compact: true,
    isInitial: (choice) => previous
      ? previous.connections === null
        ? choice.action === "adaptive"
        : [1, 2, 4, 8].includes(previous.connections)
          ? choice.action === "static" && choice.connections === previous.connections
          : choice.action === "custom"
      : choice.connections === 1,
    allowBack: true,
  }));
  if (selected === BACK) return BACK;
  if (selected.action === "adaptive") {
    return { args: [], connections: null, summary: "Inspect decides · advanced" };
  }
  const connections = selected.action === "custom"
    ? await askPositiveInteger(ui, "Maximum requests at once", null, `${model.provider}/${model.id}`, "7 Concurrency", previous?.connections ?? null)
    : selected.connections;
  if (connections === BACK) return BACK;
  const intent = selected.action === "custom" ? "Custom" : selected.label.split(" · ")[0];
  return {
    args: ["--max-connections", String(connections)],
    connections,
    summary: `${intent} · ${connections} request${connections === 1 ? "" : "s"} at a time`,
  };
}

export async function confirmRun(
  model,
  translated,
  task,
  taskConfiguration,
  samples,
  concurrency,
  lifecycle,
  config,
  inspectPassthrough,
  redactedCommand,
  ui,
) {
  const cautions = [
    ...(samples.risk === "high" ? ["Large or unlimited run selected. Time and provider usage may be significant."] : []),
    ...(taskWarning(task) ? ["This task has historical compatibility evidence that needs review."] : []),
    ...(lifecycle?.warning ? [`Local model status could not be checked: ${lifecycle.warning}`] : []),
  ];
  const receipt = [
    benchUiStyle.muted("MODEL"),
    `${model.provider}/${model.id}  ·  ${model.backend.location}`,
    ...(translated.adapter
      ? ["", benchUiStyle.muted("PROVIDER COMPATIBILITY"), translated.adapter.summary]
      : []),
    "",
    benchUiStyle.muted("BENCHMARK"),
    `${task.displayName}${task.group ? `  ·  ${task.group}` : ""}`,
    "",
    benchUiStyle.muted("RUN SIZE"),
    samples.summary,
    "",
    benchUiStyle.muted("TASK OPTIONS"),
    taskConfiguration.summary,
    ...(task.sweep
      ? [
          "",
          benchUiStyle.muted("HISTORICAL CHECK"),
          task.sweep.result === "passed" && task.sweep.versionMatches
            ? "✓ Worked in the saved one-sample check"
            : `⚠ ${task.sweep.result} · review before running`,
        ]
      : []),
    ...(concurrency ? ["", benchUiStyle.muted("REQUESTS AT ONCE"), concurrency.summary] : []),
    ...(lifecycle ? ["", benchUiStyle.muted("AFTER THE RUN"), lifecycle.summary] : []),
    "",
    benchUiStyle.muted("RESULTS"),
    `Inspect will save logs under ${config.logDir}`,
    ...(inspectPassthrough.length > 0
      ? ["", benchUiStyle.muted("COMMAND-LINE OVERRIDES"), inspectPassthrough.join(" ")]
      : []),
    ...(cautions.length > 0 ? ["", benchUiStyle.warning("CAUTION"), ...cautions.map(benchUiStyle.warning)] : []),
  ];

  while (true) {
    const safeToDefaultRun = cautions.length === 0;
    const actions = [
      ...(safeToDefaultRun ? [{ action: "run", label: "Run benchmark", detail: "Start Inspect" }] : []),
      { action: "back", label: "Go back", detail: "Adjust the most recent choice" },
      ...(!safeToDefaultRun ? [{ action: "run", label: "Run anyway", detail: "Accept the cautions and start Inspect" }] : []),
      { action: "command", label: "View redacted command", detail: "For advanced troubleshooting" },
    ];
    const selected = selectedOrCancel(await ui.select(actions, {
      step: "8 Review",
      context: `${model.provider}/${model.id}  →  ${task.displayName}`,
      title: cautions.length > 0 ? "Review cautions before running" : "Ready to run",
      message: cautions.length > 0
        ? "Go back is selected by default. Continue only if this run is intentional."
        : `Results will be saved under ${config.logDir}.`,
      label: (item) => item.label,
      summary: (item) => item.detail,
      details: () => receipt,
      tone: cautions.length > 0 ? "warning" : undefined,
      allowBack: true,
    }));
    if (selected === BACK || selected.action === "back") return false;
    if (selected.action === "run") return true;
    selectedOrCancel(await ui.select([
      { action: "back", label: "Back to review", detail: "Return to the run plan" },
    ], {
      step: "8 Review",
      context: task.displayName,
      title: "Redacted Inspect command",
      message: "Authentication values are omitted.",
      details: () => redactedCommand,
      compact: true,
      allowBack: true,
    }));
  }
}

export async function selectInteractiveBenchmark(suite, model, preferredBenchmarkId, ui) {
  const result = selectedOrCancel(await ui.select(suite.benchmarks, {
    step: "4 Benchmark",
    context: `${suite.label}  ·  ${model.provider}/${model.id}`,
    title: `Choose a ${suite.label} benchmark`,
    message: "The benchmark prompt and output contract come from the shared catalog.",
    listTitle: "Benchmarks",
    detailTitle: "Benchmark contract",
    label: (benchmark) => benchmark.title,
    summary: (benchmark) => benchmark.description,
    details: interactiveBenchmarkDetails,
    searchText: (benchmark) => `${benchmark.id} ${benchmark.title} ${benchmark.description}`,
    searchPlaceholder: "benchmark name or description",
    searchable: true,
    isInitial: (benchmark) => benchmark.id === preferredBenchmarkId,
    allowBack: true,
  }));
  return result;
}

export async function confirmInteractiveReview(repositoryRoot, suite, benchmark, model, ui) {
  const review = buildInteractiveReview({ repositoryRoot, suite, benchmark, model });
  const receipt = [
    benchUiStyle.muted("MODEL"),
    `${review.model}  ·  ${model.backend.location}`,
    "",
    benchUiStyle.muted("SUITE"),
    review.suite,
    "",
    benchUiStyle.muted("BENCHMARK"),
    `${review.benchmark}  ·  ${review.benchmarkId}`,
    "",
    benchUiStyle.muted("EXPECTED OUTPUTS"),
    ...review.expectedAssets.map((asset) => `• ${asset}`),
    "",
    benchUiStyle.muted("RUN ROOT"),
    review.runRoot,
    "",
    benchUiStyle.muted("PI HANDOFF"),
    ...review.launch.map((line) => `• ${line}`),
    "",
    benchUiStyle.muted("AFTER PI EXITS"),
    review.cleanup,
    ...(!review.cleanupSupported
      ? ["", benchUiStyle.warning("CAUTION"), benchUiStyle.warning("This local model will remain loaded after Pi exits.")]
      : []),
  ];
  const safeToLaunch = review.cleanupSupported;
  const selected = selectedOrCancel(await ui.select([
    ...(safeToLaunch ? [{ action: "launch", label: "Launch Pi", detail: "Create the run slot and start Pi" }] : []),
    { action: "back", label: "Go back", detail: "Choose a different benchmark" },
    ...(!safeToLaunch ? [{ action: "launch", label: "Launch anyway", detail: "Leave the local model running afterward" }] : []),
  ], {
    step: "8 Review",
    context: `${model.provider}/${model.id}  →  ${benchmark.title}`,
    title: safeToLaunch ? "Ready to launch Pi" : "Review cleanup limitation",
    message: safeToLaunch
      ? "The run slot will be created only after you confirm."
      : "Go back is selected by default because this provider has no unload adapter.",
    label: (item) => item.label,
    summary: (item) => item.detail,
    details: () => receipt,
    compact: true,
    tone: safeToLaunch ? undefined : "warning",
    allowBack: true,
  }));
  return selected !== BACK && selected.action === "launch";
}