import { state } from "./state.js";
import { uniqueBy } from "./utils.js";

const DS_BENCHMARK_IDS = new Set(["ab-test-analysis"]);

export function benchmarkMatchesKind(benchmarkId, kind) {
  if (kind === "data-science") {
    return DS_BENCHMARK_IDS.has(benchmarkId);
  }
  return !DS_BENCHMARK_IDS.has(benchmarkId);
}

export function filteredRuns() {
  return state.runs.filter((run) => {
    const kind = runKind(run);
    const kindMatch = kind === state.selectedKind;
    const modelMatch = state.selectedModel === "all" || run.model?.id === state.selectedModel;
    const benchmarkMatch = state.selectedBenchmark === "all" || run.benchmark?.id === state.selectedBenchmark;
    const harnessMatch = state.selectedHarness === "all" || stackAttemptIdentity(run).harness === state.selectedHarness;
    const searchMatch = !state.runsSearch.trim() || searchableRunText(run).includes(state.runsSearch.trim().toLowerCase());
    const cloudMatch = state.showCloudModels || !isCloudRun(run);
    return kindMatch && modelMatch && benchmarkMatch && harnessMatch && searchMatch && cloudMatch;
  });
}

export function isCloudRun(run) {
  return run.runner?.modelSource === "cloud";
}

export function groupRuns(runs, titleForRun, subtitleForRun) {
  const groups = new Map();
  for (const run of runs) {
    const title = titleForRun(run);
    const group = groups.get(title) ?? { title, subtitles: new Set(), runs: [] };
    group.subtitles.add(subtitleForRun(run));
    group.runs.push(run);
    groups.set(title, group);
  }
  return Array.from(groups.values()).map((g) => ({
    title: g.title,
    subtitles: Array.from(g.subtitles),
    runs: g.runs
  }));
}

export function modelsFromRuns(runs) {
  return uniqueBy(
    runs
      .map((run) => run.model?.id)
      .filter(Boolean)
      .map((id) => ({ id })),
    (m) => m.id
  );
}

export function harnessesFromRuns(runs) {
  return uniqueBy(
    runs
      .map((run) => stackAttemptIdentity(run).harness)
      .filter(Boolean)
      .map((id) => ({ id })),
    (item) => item.id
  );
}

export function runSummaryText(runs) {
  const isDs = state.selectedKind === "data-science";
  const prepared = runs.filter((r) => r.status === "prepared" && !hasCapturedVideo(r)).length;
  const videoReady = runs.filter((r) => hasCapturedVideo(r)).length;
  const needsCapture = runs.filter((r) => needsMediaCapture(r)).length;
  const failed = runs.filter((r) => r.status === "failed").length;
  const dsReady = runs.filter((r) => runKind(r) === "data-science" && r.assets?.ds?.summary).length;
  if (state.mode === "compare") {
    if (isDs) return String(runs.length) + " data-science, " + dsReady + " with summary, " + failed + " failed";
    return String(runs.length) + " visual, " + videoReady + " with video, " + needsCapture + " need capture, " + failed + " failed";
  }
  if (isDs) return dsReady + " with summary, " + prepared + " prepared, " + failed + " failed";
  return videoReady + " with video, " + needsCapture + " need capture, " + prepared + " prepared, " + failed + " failed";
}

export function runKind(run) {
  return run.kind ?? "visual";
}

function runKindLabel(run) {
  const kind = runKind(run);
  if (kind === "data-science") return "Data Science";
  return "Visual";
}

function runnerLabel(run) {
  const label = run.runner?.harnessLabel ?? run.runner?.actualRunner ?? run.runner?.intendedRunner ?? run.runner?.mode ?? run.tool ?? "manual";
  const version = run.runner?.harnessVersion;
  return version ? `${label} ${version}` : label;
}

export function stackAttemptIdentity(run) {
  const modelArtifact = run.model?.slug ?? run.model?.id ?? "unknown-model";
  const source = stackSource(run);
  const harness = runnerLabel(run);
  const modelLabel = run.model?.id ?? modelArtifact;

  return {
    key: [source.key, modelArtifact, harness].map(normalizeIdentityPart).join("|"),
    label: [modelLabel, source.label, harness].filter(Boolean).join(" · "),
    modelLabel,
    modelSource: source.key,
    backend: source.label,
    modelArtifact,
    harness
  };
}

export function hasCapturedVideo(run) {
  return Boolean(run.assets?.video || run.assets?.videoMp4);
}

export function needsMediaCapture(run) {
  return Boolean(run.runDirectory && run.assets?.html && (!run.assets?.preview || !hasCapturedVideo(run)));
}

export function needsDsScoring(run) {
  return Boolean(runKind(run) === "data-science" && run.runDirectory && run.assets?.ds?.summary && !run.assets?.ds?.scorecard);
}

export function runCardState(run) {
  const kind = runKind(run);
  if (kind === "data-science") {
    const ds = run.assets?.ds ?? {};
    if (ds.chartTreatmentEffect || ds.summary) return { status: "completed", label: "analysis" };
    return { status: "prepared", label: "slot" };
  }
  if (hasCapturedVideo(run)) {
    return { status: "completed", label: "video" };
  }
  if (run.status === "failed" || run.status === "cancelled") {
    return { status: run.status, label: run.status };
  }
  if (run.assets?.html) {
    return { status: "prepared", label: "capture" };
  }
  if (run.assets?.preview) {
    return { status: "completed", label: "preview" };
  }
  return { status: "prepared", label: "slot" };
}

export function displayRunError(run) {
  const message = run.capture?.video?.error?.message ?? run.error?.message;
  if (!message) return null;
  if (/rendered too slowly/iu.test(message)) return message;
  if (/chat completion timed out/iu.test(message)) return "External tool timed out before writing an artifact.";
  if (/LM Studio.*chat completion/iu.test(message)) return "External tool failed to produce an artifact.";
  if (/LM Studio/iu.test(message)) return "External tool error. Open details for the original message.";
  return message;
}

export function runCardMediaMessage(run, isCapturing, isScoring) {
  if (isCapturing) return "Capturing preview media";
  if (isScoring) return "Scoring analysis";
  if (runKind(run) === "data-science") {
    const ds = run.assets?.ds ?? {};
    const chartCount = [ds.chartDistribution, ds.chartTreatmentEffect, ds.chartCompletionRates].filter(Boolean).length;
    if (ds.scorecard) return "Scored";
    if (chartCount === 3 && ds.summary) return "3 charts · summary ready";
    if (chartCount > 0) return chartCount + " chart" + (chartCount > 1 ? "s" : "") + " ready";
    if (run.status === "failed") return displayRunError(run) ?? "Analysis failed";
    return "Waiting for analysis outputs";
  }
  if (hasCapturedVideo(run)) return videoReadyMessage(run);
  if (run.status === "failed" || run.capture?.video?.status === "failed") {
    return displayRunError(run) ?? "Capture failed";
  }
  if (run.assets?.html) return "Needs media capture";
  if (run.assets?.preview) return "Preview ready";
  return "Waiting for index.html source";
}

function videoReadyMessage(run) {
  const quality = run.capture?.video?.quality;
  if (quality?.measuredFps && quality?.minFps && quality.measuredFps < quality.minFps) {
    return "Video ready · slow render " + String(quality.measuredFps) + " FPS";
  }
  return "Video ready";
}

export function runCardIdentity(run, mode) {
  const promptTitle = run.benchmark?.title ?? run.benchmark?.id ?? "Untitled run";
  const modelId = run.model?.id ?? "Unknown model";
  const stack = stackAttemptIdentity(run);

  if (mode === "benchmark") {
    return { primary: modelId, secondary: stack.label.replace(modelId, "").replace(/^\s*·\s*/u, "") };
  }

  if (mode === "model") {
    return { primary: promptTitle, secondary: stack.harness };
  }

  return { primary: promptTitle, secondary: stack.label };
}

export function runRecordText(run) {
  return {
    title: "Prompt",
    value: run.promptText ?? run.benchmark?.prompt ?? "",
    emptyText: "Prompt unavailable in run folder.",
    copyLabel: "Copy prompt"
  };
}

export function findRunByDirectoryOrId(run) {
  return state.runs.find((candidate) =>
    (run.runDirectory && candidate.runDirectory === run.runDirectory) ||
    (run.runId && candidate.runId === run.runId)
  );
}

function searchableRunText(run) {
  return [
    run.runId,
    runKindLabel(run),
    run.status,
    runnerLabel(run),
    run.benchmark?.id,
    run.benchmark?.title,
    run.benchmark?.description,
    run.benchmark?.prompt,
    run.model?.id,
    run.model?.slug,
    stackAttemptIdentity(run).key,
    stackAttemptIdentity(run).label,
    run.runner?.backendLabel,
    run.runner?.baseUrl,
    run.runner?.launchCommand,
    run.runner?.metricSource,
    run.runDirectory,
    run.notes,
    ...Object.values(run.assets ?? {})
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function stackSource(run) {
  const source = run.runner?.modelSource;
  if (source) {
    return {
      key: source,
      label: run.runner?.backendLabel ?? modelSourceLabel(source)
    };
  }
  return {
    key: "source-unrecorded",
    label: "source unrecorded"
  };
}

function modelSourceLabel(source) {
  if (source === "ollama") return "Ollama";
  if (source === "omlx") return "oMLX";
  if (source === "llama-cpp") return "llama.cpp";
  if (source === "llama-cpp-mtp") return "llama.cpp MTP";
  if (source === "cloud") return "Cloud";
  return source;
}

function normalizeIdentityPart(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, "-");
}
