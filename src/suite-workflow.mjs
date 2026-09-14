import { join, resolve } from "node:path";

import { expectedRunOutputAssets } from "./lib/prompt-prep.ts";
import { interactiveCleanupSupport } from "./local-lifecycle.mjs";

export const BENCHMARK_SUITE_IDS = Object.freeze({
  inspect: "inspect",
  visual: "visual",
  dataScience: "data-science",
});

export function buildSuiteChoices(interactiveSuites, inspectCompatibility) {
  const interactive = new Map(interactiveSuites.map((suite) => [suite.id, suite]));
  const visual = interactive.get(BENCHMARK_SUITE_IDS.visual);
  const dataScience = interactive.get(BENCHMARK_SUITE_IDS.dataScience);

  return [
    {
      id: BENCHMARK_SUITE_IDS.inspect,
      label: "Inspect evals",
      detail: inspectCompatibility.ready
        ? "Pi + Inspect · scored evaluation tasks"
        : `Inspect needs attention · ${inspectCompatibility.short}`,
      description: "Run Inspect tasks with task configuration, sample budgets, and Inspect eval logs.",
    },
    interactiveSuiteChoice(visual, "Build a polished interactive artifact and capture its rendered output."),
    interactiveSuiteChoice(dataScience, "Analyze the project dataset and produce a notebook, summary, and charts."),
  ];
}

export function interactiveBenchmarkDetails(benchmark) {
  return [
    benchmark.description,
    "",
    `BENCHMARK ID: ${benchmark.id}`,
    `KIND: ${benchmark.kind}`,
    ...(benchmark.sourcePath ? [`SOURCE: ${benchmark.sourcePath}`] : []),
    "",
    "EXPECTED OUTPUTS",
    ...interactiveExpectedAssets(benchmark.kind).map((asset) => `• ${asset}`),
  ];
}

export function interactiveExpectedAssets(kind) {
  if (kind !== BENCHMARK_SUITE_IDS.visual && kind !== BENCHMARK_SUITE_IDS.dataScience) {
    throw new Error(`Unsupported interactive benchmark kind: ${kind}`);
  }
  return expectedRunOutputAssets(kind);
}

export function buildInteractiveReview({ repositoryRoot, suite, benchmark, model }) {
  if (!suite || !benchmark || !model) {
    throw new Error("Suite, benchmark, and model are required for interactive review.");
  }
  if (suite.id !== benchmark.kind) {
    throw new Error(`Suite "${suite.id}" does not match benchmark kind "${benchmark.kind}".`);
  }

  const cleanup = interactiveCleanupSupport(model);
  return {
    suite: suite.label,
    benchmark: benchmark.title,
    benchmarkId: benchmark.id,
    model: `${model.provider}/${model.id}`,
    runRoot: resolve(join(repositoryRoot, "runs")),
    expectedAssets: interactiveExpectedAssets(benchmark.kind),
    launch: [
      "Create a new run slot only after confirmation.",
      "Open interactive Pi inside that isolated run directory.",
      "Submit @prompt.md, then return to Bench when Pi exits.",
    ],
    cleanup: cleanup.summary,
    cleanupSupported: cleanup.supported,
  };
}

export function suitePassthroughError(suiteId, passthrough) {
  if (suiteId === BENCHMARK_SUITE_IDS.inspect || passthrough.length === 0) return null;
  return `Arguments after -- are Inspect-only and cannot be used with the ${suiteLabel(suiteId)} suite.`;
}

export function updateSuitePreferences(previous, selection) {
  const benchmarks = {
    ...(previous.benchmarks && typeof previous.benchmarks === "object" ? previous.benchmarks : {}),
  };
  if (selection.benchmark?.id && selection.suite !== BENCHMARK_SUITE_IDS.inspect) {
    benchmarks[selection.suite] = selection.benchmark.id;
  }

  return {
    ...previous,
    provider: selection.provider,
    model: selection.model,
    suite: selection.suite,
    source: selection.inspectSource ?? previous.source,
    task: selection.inspectTask ?? previous.task,
    benchmarks,
  };
}

function interactiveSuiteChoice(suite, description) {
  if (!suite) {
    throw new Error("Interactive benchmark suite discovery returned an incomplete catalog.");
  }
  const count = suite.benchmarks.length;
  return {
    id: suite.id,
    label: suite.label,
    detail: `${count} benchmark${count === 1 ? "" : "s"} · interactive Pi`,
    description,
    suite,
  };
}

function suiteLabel(suiteId) {
  if (suiteId === BENCHMARK_SUITE_IDS.visual) return "Visual Bench";
  if (suiteId === BENCHMARK_SUITE_IDS.dataScience) return "Data Science";
  return suiteId;
}

