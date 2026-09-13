import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { BenchError } from "./errors.mjs";

const DEFAULT_SWEEP_DATA_PATH = fileURLToPath(
  new URL("../bench-data/inspect-evals-sweep-deepseek-flash-2026-09-12.json", import.meta.url),
);

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function validateSweepData(data, path) {
  const sweep = data?.sweep;
  const tasks = data?.tasks;
  if (
    data?.schemaVersion !== 1
    || !sweep
    || typeof sweep !== "object"
    || typeof sweep.date !== "string"
    || typeof sweep.model !== "string"
    || typeof sweep.inspectAiVersion !== "string"
    || typeof sweep.inspectEvalsVersion !== "string"
    || !tasks
    || typeof tasks !== "object"
    || Array.isArray(tasks)
    || Object.entries(tasks).some(([spec, result]) => (
      !spec.startsWith("inspect_evals/")
      || !result
      || typeof result !== "object"
      || !["passed", "blocked", "inconclusive"].includes(result.result)
      || typeof result.category !== "string"
      || typeof result.recommendation !== "string"
      || typeof result.diagnostic !== "string"
    ))
  ) {
    throw new BenchError(`Invalid Inspect Evals sweep data: ${path}`);
  }
  return data;
}

export async function loadSweepData(path = DEFAULT_SWEEP_DATA_PATH) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    throw new BenchError(`Could not read Inspect Evals sweep data at ${path}: ${errorMessage(error)}`);
  }

  try {
    return validateSweepData(JSON.parse(source), path);
  } catch (error) {
    if (error instanceof BenchError) throw error;
    throw new BenchError(`Invalid Inspect Evals sweep data at ${path}: ${errorMessage(error)}`);
  }
}

function groupedBenchmarkSort(left, right) {
  return (left.group ?? "Other").localeCompare(right.group ?? "Other")
    || left.displayName.localeCompare(right.displayName);
}

export function annotateSweepTask(task, sweepData) {
  const result = sweepData.tasks[task.spec];
  if (!result) return { ...task, sweep: null };
  return {
    ...task,
    sweep: {
      ...result,
      ...sweepData.sweep,
      versionMatches: task.packageVersion === sweepData.sweep.inspectEvalsVersion,
    },
  };
}

export function buildBenchmarkSources(registered, custom, sweepData) {
  const inspectEvals = registered
    .filter((task) => task.source === "inspect_evals")
    .map((task) => annotateSweepTask(task, sweepData));
  const recommended = inspectEvals
    .filter((task) => task.sweep?.result === "passed")
    .sort(groupedBenchmarkSort);
  const warningCount = inspectEvals.filter((task) => (
    task.sweep?.result === "blocked" || task.sweep?.result === "inconclusive"
  )).length;

  if (inspectEvals.length > 0 && recommended.length === 0) {
    throw new BenchError(
      `The saved Inspect Evals ${sweepData.sweep.inspectEvalsVersion} sweep does not match any installed tasks`,
    );
  }

  const sources = [];
  if (inspectEvals.length > 0) {
    sources.push(
      {
        source: "inspect_evals_recommended",
        kind: "recommended",
        label: "Recommended Inspect Evals",
        detail: `${recommended.length} tasks that worked in the saved one-sample check · grouped by category`,
        benchmarks: recommended,
        sweep: sweepData.sweep,
      },
      {
        source: "inspect_evals_all",
        kind: "all",
        label: "All Inspect Evals",
        detail: `Complete installed catalog · ${warningCount} need historical compatibility review`,
        benchmarks: inspectEvals.sort((left, right) => left.displayName.localeCompare(right.displayName)),
        sweep: sweepData.sweep,
      },
    );
  }

  const otherRegistered = new Map();
  for (const task of registered.filter((entry) => entry.source !== "inspect_evals")) {
    const sourceTasks = otherRegistered.get(task.source) ?? [];
    sourceTasks.push(task);
    otherRegistered.set(task.source, sourceTasks);
  }
  sources.push(
    ...[...otherRegistered.entries()]
      .map(([source, benchmarks]) => ({
        source,
        kind: "installed",
        label: benchmarks[0].sourceLabel,
        benchmarks: benchmarks.sort((left, right) => left.displayName.localeCompare(right.displayName)),
      }))
      .sort((left, right) => left.label.localeCompare(right.label)),
  );

  if (custom.length > 0) {
    sources.push({
      source: "local",
      kind: "local",
      label: "Local tests",
      detail: `${custom.length} task${custom.length === 1 ? "" : "s"} discovered from this project's configured roots`,
      benchmarks: custom
        .map((task) => ({
          ...task,
          source: "local",
          sourceLabel: "Local tests",
          displayName: task.name,
          spec: `${task.file}@${task.name}`,
          params: [],
          evalId: null,
          sampleCount: null,
          packageVersion: null,
          sweep: null,
        }))
        .sort((left, right) => left.displayName.localeCompare(right.displayName)),
    });
  }

  if (sources.length === 0) {
    throw new BenchError("Inspect found no installed or local benchmarks");
  }
  return sources;
}

export function sentenceHint(value) {
  const normalized = String(value).replace(/\s+/g, " ").trim();
  const end = normalized.search(/[.!?](?=\s|$)/);
  return end === -1 ? normalized : normalized.slice(0, end + 1);
}

function humanizeSweepValue(value) {
  return value.replaceAll("_", " ");
}

function compactDiagnostic(value, maxLength = 280) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export function sweepWarningLines(task) {
  const sweep = task.sweep;
  if (!sweep || (sweep.result === "passed" && sweep.versionMatches)) return null;
  if (sweep.result === "passed") {
    return [
      `⚠ ${task.displayName} worked only with an older Inspect Evals version.`,
      `Installed: ${task.packageVersion ?? "unknown"} · Sweep: ${sweep.inspectEvalsVersion}`,
      `Sweep: ${sweep.model} · ${sweep.date}`,
      "This is historical compatibility evidence, not a prediction for the currently selected task version or model.",
    ];
  }
  const outcome = sweep.result === "inconclusive"
    ? "was inconclusive"
    : "was blocked";
  return [
    `⚠ The saved one-sample check for ${task.displayName} ${outcome}.`,
    `Reason (${humanizeSweepValue(sweep.category)}): ${compactDiagnostic(sweep.diagnostic)}`,
    `Sweep: ${sweep.model} · ${sweep.date} · Inspect Evals ${sweep.inspectEvalsVersion}`,
    "This is historical compatibility evidence, not a prediction for the currently selected model.",
  ];
}
