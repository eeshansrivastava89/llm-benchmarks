import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { main } from "../bin/bench.mjs";
import { BenchError, SelectionCancelled } from "../src/errors.mjs";
import { BenchUI, CANCEL } from "../src/ui/bench-ui.mjs";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const PROVIDER = {
  provider: "omlx",
  backend: { location: "local", status: "online" },
  models: [{
    id: "test-model",
    provider: "omlx",
    api: "openai-completions",
    backend: { location: "local", status: "online" },
    contextWindow: 4_096,
    input: ["text"],
  }],
};

const MODEL_RUNTIME = {
  isUsingSubscription: () => false,
  extensionProviders: new Set(),
};

const INTERACTIVE_SUITES = [
  { id: "visual", kind: "visual", label: "Visual Bench", benchmarks: [{ id: "sakura", kind: "visual" }] },
  { id: "data-science", kind: "data-science", label: "Data Science", benchmarks: [{ id: "retail", kind: "data-science" }] },
];

const INSPECT_CONFIG = { customTaskRoots: ["benchmarks"], logDir: "logs", taskConfigDir: "bench-configs" };

const INSPECT_SOURCES = [
  {
    source: "inspect_evals_recommended",
    label: "Recommended Inspect Evals",
    detail: "recommended",
    benchmarks: [{ spec: "inspect_evals/arc_easy", displayName: "arc_easy", group: "Reasoning", params: [], sampleCount: 10 }],
  },
  {
    source: "inspect_evals_all",
    label: "All Inspect Evals",
    detail: "all",
    benchmarks: [{ spec: "inspect_evals/arc_easy", displayName: "arc_easy", group: "Reasoning", params: [], sampleCount: 10 }],
  },
];

// Records every call so the test can assert on the interactive sequence.
// The cap turns a control-flow regression (the stage machine bouncing back to a
// picker forever) into a readable failure instead of a hanging suite.
const MAX_PICKERS = 12;

class ScriptedUI {
  constructor(respond) {
    this.respond = respond;
    this.calls = [];
    this.interactionCount = 0;
    this.loader = null;
  }

  start() {}
  stop() {}
  showLoading(message, context = "") {
    this.calls.push({ kind: "loading", message, context });
  }
  flash(message) {
    this.calls.push({ kind: "flash", message });
  }
  async select(items, options) {
    this.interactionCount += 1;
    this.calls.push({ kind: "select", step: options?.step, items });
    const pickers = this.calls.filter((call) => call.kind === "select").length;
    if (pickers > MAX_PICKERS) {
      throw new Error(
        `The stage machine showed ${pickers} pickers without reaching the benchmark browser: ${this.steps.join(" -> ")}`,
      );
    }
    return this.respond({ items, options, calls: this.calls });
  }
  async browseBenchmarks(sources, options) {
    this.calls.push({ kind: "browseBenchmarks", sources, options });
    return CANCEL;
  }

  get steps() {
    return this.calls.filter((call) => call.kind === "select").map((call) => call.step);
  }
  get browsing() {
    return this.calls.filter((call) => call.kind === "browseBenchmarks");
  }
  get loadings() {
    return this.calls.filter((call) => call.kind === "loading").map((call) => call.message);
  }
}

// Answers the pickers the way a user would: model, then the Inspect suite.
function happyPathResponder({ items, options }) {
  if (options.step === "1 Provider") return PROVIDER;
  if (options.step === "2 Model") {
    return { model: PROVIDER.models[0], piReady: true, compatibility: { ready: true, short: "ready", reason: "" } };
  }
  if (options.step === "3 Suite") {
    const recovery = items.find((item) => item.action);
    if (recovery) return recovery;
    return items.find((item) => item.id === "inspect");
  }
  throw new Error(`Unexpected picker at step ${options.step}`);
}

async function withTempCwd(run) {
  const cwd = await mkdtemp(join(tmpdir(), "bench-stage-"));
  try {
    return await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function runMain(cwd, ui, overrides = {}) {
  return main([], {
    cwd,
    skipTtyCheck: true,
    createUi: () => ui,
    loadConfig: async () => INSPECT_CONFIG,
    discoverProviderModels: async () => ({
      modelRuntime: MODEL_RUNTIME,
      providers: [PROVIDER],
      diagnostics: [],
    }),
    discoverInteractiveSuites: async () => INTERACTIVE_SUITES,
    resolveInspect: async () => ({ inspectModel: "openai-api/omlx/test-model", baseUrl: "http://127.0.0.1:8000/v1" }),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Stage machine
// ---------------------------------------------------------------------------

test("Inspect evals reaches the benchmark browser after a successful discovery", async () => {
  await withTempCwd(async (cwd) => {
    const ui = new ScriptedUI(happyPathResponder);
    let discovered = 0;

    await assert.rejects(
      runMain(cwd, ui, {
        discoverInspectBenchmarks: async () => { discovered += 1; return INSPECT_SOURCES; },
      }),
      SelectionCancelled,
    );

    assert.equal(discovered, 1, "discovery ran once");
    assert.equal(ui.browsing.length, 1, "the benchmark browser was reached");
    assert.deepEqual(ui.browsing[0].sources, INSPECT_SOURCES, "the browser received the discovered sources");
    assert.deepEqual(ui.steps, ["1 Provider", "2 Model", "3 Suite"], "the suite picker was shown once, not re-entered");
    assert.deepEqual(ui.loadings.filter((message) => message.startsWith("Checking Inspect") || message.startsWith("Finding Inspect")), [
      "Checking Inspect authentication and model settings…",
      "Finding Inspect benchmarks…",
    ]);
  });
});

test("a failed discovery returns to the suite picker instead of the browser", async () => {
  await withTempCwd(async (cwd) => {
    const suiteSelections = [];
    const ui = new ScriptedUI((state) => {
      const { items, options } = state;
      if (options.step !== "3 Suite") return happyPathResponder(state);
      const recovery = items.find((item) => item.action);
      if (recovery) return { action: "suite" };
      suiteSelections.push(items);
      // Second visit to the suite picker ends the test.
      return suiteSelections.length > 1 ? CANCEL : items.find((item) => item.id === "inspect");
    });

    await assert.rejects(
      runMain(cwd, ui, {
        discoverInspectBenchmarks: async () => { throw new BenchError("Inspect task discovery failed"); },
      }),
      SelectionCancelled,
    );

    assert.equal(ui.browsing.length, 0, "the browser was never reached");
    assert.equal(ui.steps.filter((step) => step === "3 Suite").length, 3, "suite picker, recovery screen, suite picker");
  });
});

test("a failed discovery retries until it succeeds", async () => {
  await withTempCwd(async (cwd) => {
    const ui = new ScriptedUI((state) => {
      const recovery = state.items.find((item) => item.action);
      if (recovery) return { action: "retry" };
      return happyPathResponder(state);
    });
    let attempts = 0;

    await assert.rejects(
      runMain(cwd, ui, {
        discoverInspectBenchmarks: async () => {
          attempts += 1;
          if (attempts === 1) throw new BenchError("Inspect registry discovery failed");
          return INSPECT_SOURCES;
        },
      }),
      SelectionCancelled,
    );

    assert.equal(attempts, 2, "discovery was retried");
    assert.equal(ui.browsing.length, 1, "the browser was reached once discovery succeeded");
    assert.deepEqual(ui.browsing[0].sources, INSPECT_SOURCES);
    assert.equal(
      ui.loadings.filter((message) => message === "Finding Inspect benchmarks…").length,
      2,
      "each attempt showed the discovery spinner",
    );
  });
});

// ---------------------------------------------------------------------------
// Loader lifecycle
// ---------------------------------------------------------------------------

class FakeTerminal {
  constructor(rows = 40, columns = 120) {
    this.rows = rows;
    this.columns = columns;
  }
  hideCursor() {}
  showCursor() {}
  start() {}
  stop() {}
  write() {}
}

test("showLoading releases the previous loader so no interval outlives stop()", () => {
  const ui = new BenchUI({ terminal: new FakeTerminal() });
  ui.start();

  // The Inspect flow shows two loaders back to back with no screen in between.
  ui.showLoading("Checking Inspect authentication and model settings…");
  const first = ui.loader;
  ui.showLoading("Finding Inspect benchmarks…");
  const second = ui.loader;

  // Snapshot, then release everything: a regression here leaves refed intervals
  // that would keep the test runner alive instead of reporting a failure.
  const firstInterval = first.intervalId;
  const secondIntervalWhileShown = second.intervalId;
  ui.stop({ preserveScreen: true });
  const secondIntervalAfterStop = second.intervalId;
  const loaderAfterStop = ui.loader;
  first.stop();
  second.stop();

  assert.notEqual(first, second, "a new loader was created");
  assert.equal(firstInterval, null, "the replaced loader's interval was cleared");
  assert.notEqual(secondIntervalWhileShown, null, "the active loader animates while shown");
  assert.equal(secondIntervalAfterStop, null, "stop() clears the active loader's interval");
  assert.equal(loaderAfterStop, null, "stop() releases the loader reference");
});
