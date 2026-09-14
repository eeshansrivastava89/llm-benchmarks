import assert from "node:assert/strict";
import test from "node:test";

import { stripTerminalSequences } from "@earendil-works/pi-tui";

import {
  BENCHMARK_SUITE_IDS,
  buildInteractiveReview,
  buildSuiteChoices,
  interactiveBenchmarkDetails,
  interactiveExpectedAssets,
  suitePassthroughError,
  updateSuitePreferences,
} from "../src/suite-workflow.mjs";
import { WorkflowHeader } from "../src/ui/presentation.mjs";

const interactiveSuites = [
  {
    id: "visual",
    kind: "visual",
    label: "Visual Bench",
    benchmarks: [
      { id: "sakura", kind: "visual", title: "Sakura", description: "Build a scene." },
    ],
  },
  {
    id: "data-science",
    kind: "data-science",
    label: "Data Science",
    benchmarks: [
      { id: "ab-test", kind: "data-science", title: "A/B Test", description: "Analyze results." },
    ],
  },
];

const model = {
  provider: "ollama",
  id: "qwen3.5",
  backend: { id: "ollama", location: "local", status: "online" },
};

test("workflow header includes the Suite step", () => {
  const narrow = stripTerminalSequences(new WorkflowHeader("3 Suite").render(100).join("\n"));
  const wide = stripTerminalSequences(new WorkflowHeader("3 Suite").render(180).join("\n"));
  assert.match(narrow, /3\/8  Suite/);
  assert.match(wide, /2 Model\s+>\s+3 Suite\s+>\s+4 Benchmark/);
});

test("suite choices keep Pi-only models available while identifying Inspect incompatibility", () => {
  const choices = buildSuiteChoices(interactiveSuites, {
    ready: false,
    short: "subscription login",
    reason: "Subscription login is not supported by Inspect",
  });

  assert.deepEqual(choices.map(({ id }) => id), ["inspect", "visual", "data-science"]);
  assert.match(choices[0].detail, /Inspect needs attention/);
  assert.equal(choices[1].detail, "1 benchmark · interactive Pi");
  assert.equal(choices[2].suite, interactiveSuites[1]);
});

test("interactive benchmark details use suite-specific output contracts", () => {
  assert.deepEqual(interactiveExpectedAssets("visual"), [
    "index.html",
    "preview.png",
    "preview.webm",
  ]);
  assert.deepEqual(interactiveExpectedAssets("data-science"), [
    "analysis.ipynb",
    "summary.json",
    "chart-distribution.png",
    "chart-treatment-effect.png",
    "chart-completion-rates.png",
  ]);
  assert.match(interactiveBenchmarkDetails(interactiveSuites[0].benchmarks[0]).join("\n"), /index\.html/);
  assert.throws(() => interactiveExpectedAssets("inspect"), /Unsupported interactive benchmark kind/);
});

test("interactive review identifies the run root, Pi handoff, and local cleanup", () => {
  const review = buildInteractiveReview({
    repositoryRoot: "/project",
    suite: interactiveSuites[0],
    benchmark: interactiveSuites[0].benchmarks[0],
    model,
  });

  assert.equal(review.runRoot, "/project/runs");
  assert.match(review.launch.join("\n"), /@prompt\.md/);
  assert.match(review.cleanup, /Unload.*Ollama/);
  const unsupportedCleanup = buildInteractiveReview({
    repositoryRoot: "/project",
    suite: interactiveSuites[0],
    benchmark: interactiveSuites[0].benchmarks[0],
    model: {
      provider: "llama-cpp",
      id: "local-model",
      backend: { id: "llama-cpp", location: "local", status: "online" },
    },
  }).cleanup;
  assert.match(unsupportedCleanup, /no automatic unload adapter.*leave.*running/i);
  assert.throws(
    () => buildInteractiveReview({
      repositoryRoot: "/project",
      suite: interactiveSuites[1],
      benchmark: interactiveSuites[0].benchmarks[0],
      model,
    }),
    /does not match benchmark kind/,
  );
});

test("Inspect passthrough options are rejected by interactive suites", () => {
  assert.equal(suitePassthroughError(BENCHMARK_SUITE_IDS.inspect, ["--limit", "1"]), null);
  assert.equal(suitePassthroughError(BENCHMARK_SUITE_IDS.visual, []), null);
  assert.match(
    suitePassthroughError(BENCHMARK_SUITE_IDS.visual, ["--limit", "1"]),
    /Inspect-only.*Visual Bench/,
  );
});

test("suite preferences preserve the last Inspect task and remember each interactive benchmark", () => {
  const previous = {
    schemaVersion: 1,
    provider: "openai",
    model: "gpt-old",
    suite: "inspect",
    source: "inspect_evals_recommended",
    task: "inspect_evals/mmlu",
    benchmarks: { visual: "sakura" },
  };
  const dataScience = updateSuitePreferences(previous, {
    provider: "ollama",
    model: "qwen3.5",
    suite: "data-science",
    benchmark: interactiveSuites[1].benchmarks[0],
  });

  assert.equal(dataScience.source, "inspect_evals_recommended");
  assert.equal(dataScience.task, "inspect_evals/mmlu");
  assert.deepEqual(dataScience.benchmarks, {
    visual: "sakura",
    "data-science": "ab-test",
  });

  const inspect = updateSuitePreferences(dataScience, {
    provider: "openai",
    model: "gpt-new",
    suite: "inspect",
    inspectSource: "custom",
    inspectTask: "benchmarks/smoke.py@smoke",
  });
  assert.equal(inspect.source, "custom");
  assert.equal(inspect.task, "benchmarks/smoke.py@smoke");
  assert.deepEqual(inspect.benchmarks, dataScience.benchmarks);
});
