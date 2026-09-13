import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { stripTerminalSequences } from "@earendil-works/pi-tui";

import {
  BenchError,
  annotateProviderBackends,
  buildBenchmarkSources,
  buildInspectInvocation,
  classifyBackend,
  discoverRegisteredTasks,
  discoverTasks,
  formatSampleCount,
  generateTaskConfigTemplate,
  groupModels,
  inspectOptionValue,
  loadSweepData,
  localConcurrencyChoices,
  modelCompatibility,
  passthroughArgs,
  prepareLocalModelLifecycle,
  probeTcp,
  resolveInspectModel,
  runInherited,
  sampleChoices,
  sentenceHint,
  sweepWarningLines,
  taskConfigPath,
  validateTaskConfig,
} from "../bin/bench.mjs";
import {
  benchmarkCategories,
  benchmarkDetails,
  benchmarkListItem,
  formatCount,
  taskWarning,
} from "../src/ui/bench-ui.mjs";
import { loadBenchPreferences, saveBenchPreferences } from "../src/preferences.mjs";

function model(overrides = {}) {
  return {
    provider: "test-provider",
    id: "vendor/model",
    name: "Test model",
    api: "openai-completions",
    baseUrl: "https://example.test/v1",
    reasoning: true,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 16_000,
    ...overrides,
  };
}

function modelRuntime({ subscription = false, resolution } = {}) {
  return {
    isUsingSubscription: () => subscription,
    getAuth: async () => resolution ?? {
      auth: { apiKey: "test-secret", headers: {} },
      env: {},
      source: "test",
    },
  };
}

async function executable(t, source) {
  const directory = await mkdtemp(join(tmpdir(), "bench-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "command");
  await writeFile(path, `#!/bin/sh\n${source}\n`);
  await chmod(path, 0o755);
  return path;
}

test("passthrough arguments require and preserve the separator", () => {
  assert.deepEqual(passthroughArgs([]), []);
  assert.deepEqual(passthroughArgs(["--", "--limit", "20", "--epochs", "3"]), [
    "--limit",
    "20",
    "--epochs",
    "3",
  ]);
  assert.throws(() => passthroughArgs(["--limit", "20"]), BenchError);
});

test("available models are grouped and sorted without an allowlist", () => {
  const grouped = groupModels([
    model({ provider: "zeta", id: "b" }),
    model({ provider: "alpha", id: "c" }),
    model({ provider: "alpha", id: "a" }),
  ]);
  assert.deepEqual(grouped.map(({ provider }) => provider), ["alpha", "zeta"]);
  assert.deepEqual(grouped[0].models.map(({ id }) => id), ["a", "c"]);
  assert.throws(() => groupModels([]), /no authenticated models/i);
});

test("backend classification only treats loopback endpoints as local", () => {
  assert.deepEqual(classifyBackend("https://api.example.test/v1"), { location: "cloud" });
  assert.equal(classifyBackend("http://127.0.0.1:8000/v1").location, "local");
  assert.equal(classifyBackend("http://localhost:11434/v1").location, "local");
  assert.equal(classifyBackend("http://[::1]:8080/v1").location, "local");
  assert.deepEqual(classifyBackend("not a url"), { location: "unknown", status: "unknown" });
});

test("local backend probes are deduplicated and cloud endpoints are not contacted", async () => {
  const probes = [];
  const providers = groupModels([
    model({ provider: "local", id: "one", baseUrl: "http://127.0.0.1:8000/v1" }),
    model({ provider: "local", id: "two", baseUrl: "http://127.0.0.1:8000/v1" }),
    model({ provider: "cloud", id: "three", baseUrl: "https://api.example.test/v1" }),
  ]);
  const annotated = await annotateProviderBackends(providers, {
    probe: async ({ endpoint }) => {
      probes.push(endpoint);
      return true;
    },
  });

  assert.deepEqual(probes, ["127.0.0.1:8000"]);
  assert.equal(annotated.find(({ provider }) => provider === "local").backend.status, "online");
  assert.equal(annotated.find(({ provider }) => provider === "cloud").backend.location, "cloud");
});

test("TCP probe reports whether a local server is listening", async () => {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");

  assert.equal(await probeTcp({ hostname: "127.0.0.1", port: address.port }), true);
  await new Promise((resolvePromise) => server.close(resolvePromise));
  assert.equal(await probeTcp({ hostname: "127.0.0.1", port: address.port }), false);
});

test("benchmark descriptions are reduced to one normalized sentence", () => {
  assert.equal(
    sentenceHint("Measures reasoning. Includes several task variants."),
    "Measures reasoning.",
  );
  assert.equal(sentenceHint("  One-line   summary without punctuation  "), "One-line summary without punctuation");
});

test("sample choices are bounded by the official dataset size", () => {
  assert.equal(formatSampleCount(58_492), "58,492");
  assert.equal(formatSampleCount(null), "unavailable");
  assert.deepEqual(
    sampleChoices(750).map(({ action, limit }) => [action, limit]),
    [
      ["limit", 1],
      ["limit", 10],
      ["limit", 100],
      ["limit", 500],
      ["custom", null],
      ["all", null],
    ],
  );
  assert.deepEqual(
    sampleChoices(1).map(({ action, limit }) => [action, limit]),
    [["all", null]],
  );
});

test("Inspect option detection supports separate and equals forms", () => {
  assert.equal(inspectOptionValue(["--limit", "100"], "--limit"), "100");
  assert.equal(inspectOptionValue(["--limit=500"], "--limit"), "500");
  assert.equal(inspectOptionValue(["--max-connections", "2"], "--max-connections"), "2");
  assert.equal(inspectOptionValue(["--adaptive-connections", "--limit", "10"], "--adaptive-connections"), "enabled");
  assert.equal(inspectOptionValue([], "--limit"), null);
});

test("local concurrency choices default to a safe static cap", () => {
  const choices = localConcurrencyChoices();
  assert.match(choices[0].label, /Safe.*Recommended/);
  assert.match(sampleChoices(100)[0].label, /Quick check.*Recommended/);
  assert.deepEqual(
    choices.map(({ action, connections }) => [action, connections]),
    [
      ["static", 1],
      ["static", 2],
      ["static", 4],
      ["static", 8],
      ["custom", null],
      ["adaptive", null],
    ],
  );
});

test("model compatibility rejects known unusable choices before authentication", () => {
  const readyRuntime = modelRuntime();
  assert.equal(modelCompatibility(readyRuntime, model()).ready, true);
  assert.match(
    modelCompatibility(modelRuntime({ subscription: true }), model()).reason,
    /Subscription login/,
  );
  assert.match(
    modelCompatibility(readyRuntime, model({ api: "unknown-api" })).reason,
    /Unsupported API format/,
  );
  assert.match(
    modelCompatibility(readyRuntime, model({ backend: { location: "local", status: "offline" } })).reason,
    /offline/,
  );
});

test("recent selections are stored without copying provider or task catalogs", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "bench-preferences-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.deepEqual(await loadBenchPreferences(directory), {});
  await saveBenchPreferences(directory, {
    provider: "ollama",
    model: "qwen3.5",
    source: "local",
    task: "benchmarks/smoke.py@smoke",
  });
  assert.deepEqual(await loadBenchPreferences(directory), {
    schemaVersion: 1,
    provider: "ollama",
    model: "qwen3.5",
    source: "local",
    task: "benchmarks/smoke.py@smoke",
  });
});

test("Ollama models loaded by bench are unloaded after the run", async () => {
  let loaded = false;
  const calls = [];
  const selected = model({
    provider: "ollama",
    id: "qwen3.5",
    baseUrl: "http://127.0.0.1:11434/v1",
    backend: { location: "local", status: "online" },
  });
  const lifecycle = await prepareLocalModelLifecycle(selected, {
    baseUrl: selected.baseUrl,
    childEnv: {},
  }, {
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith("/api/ps")) {
        return new Response(JSON.stringify({
          models: loaded ? [{ name: "qwen3.5:latest" }] : [],
        }));
      }
      const body = JSON.parse(options.body);
      assert.deepEqual(body, { model: "qwen3.5", keep_alive: 0 });
      loaded = false;
      return new Response(JSON.stringify({ done: true, done_reason: "unload" }));
    },
    logger: { log() {}, error() {} },
  });

  assert.match(lifecycle.summary, /unload after run/);
  loaded = true;
  const cleanup = await lifecycle.cleanup();
  assert.equal(cleanup.status, "unloaded");
  assert.equal(loaded, false);
  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), [
    "/api/ps",
    "/api/ps",
    "/api/generate",
  ]);
});

test("bench preserves a local model that was already loaded", async () => {
  let requests = 0;
  const selected = model({
    provider: "ollama",
    id: "already-loaded:latest",
    baseUrl: "http://localhost:11434/v1",
    backend: { location: "local", status: "online" },
  });
  const lifecycle = await prepareLocalModelLifecycle(selected, {
    baseUrl: selected.baseUrl,
    childEnv: {},
  }, {
    fetchImpl: async () => {
      requests += 1;
      return new Response(JSON.stringify({ models: [{ model: "already-loaded:latest" }] }));
    },
    logger: { log() {}, error() {} },
  });

  assert.match(lifecycle.summary, /already running/);
  const cleanup = await lifecycle.cleanup();
  assert.equal(cleanup.status, "kept");
  assert.equal(requests, 1);
});

test("oMLX models loaded by bench use the authenticated public unload endpoint", async () => {
  let loaded = false;
  const calls = [];
  const selected = model({
    provider: "omlx",
    id: "Qwen/Test Model",
    baseUrl: "http://127.0.0.1:8000/v1",
    backend: { location: "local", status: "online" },
  });
  const lifecycle = await prepareLocalModelLifecycle(selected, {
    baseUrl: selected.baseUrl,
    apiKeyEnv: "OMLX_API_KEY",
    childEnv: { OMLX_API_KEY: "secret" },
  }, {
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith("/models/status")) {
        return new Response(JSON.stringify({
          models: [{ id: selected.id, loaded }],
        }));
      }
      loaded = false;
      return new Response(JSON.stringify({ status: "ok" }));
    },
    logger: { log() {}, error() {} },
  });

  loaded = true;
  await lifecycle.cleanup();
  assert.equal(loaded, false);
  assert.equal(new URL(calls.at(-1).url).pathname, "/v1/models/Qwen%2FTest%20Model/unload");
  assert.equal(calls.at(-1).options.headers.authorization, "Bearer secret");
});

test("task config paths are stable and project-local", () => {
  assert.equal(
    taskConfigPath("/project", "bench-configs", {
      source: "inspect_evals",
      displayName: "bbq",
    }),
    "/project/bench-configs/inspect_evals/bbq.yaml",
  );
});

test("OpenAI Chat Completions translation is explicit", async () => {
  const translated = await resolveInspectModel(modelRuntime(), model());
  assert.equal(translated.inspectModel, "openai-api/test-provider/vendor/model");
  assert.equal(translated.baseUrl, "https://example.test/v1");
  assert.deepEqual(translated.modelArgs, { responses_api: false });
  assert.equal(translated.apiKeyEnv, "TEST_PROVIDER_API_KEY");
  assert.equal(translated.childEnv.TEST_PROVIDER_API_KEY, "test-secret");
  assert.equal(translated.extraHeaders, undefined);
});

test("OpenAI Responses translation enables the Responses API", async () => {
  const translated = await resolveInspectModel(
    modelRuntime(),
    model({ api: "openai-responses" }),
  );
  assert.deepEqual(translated.modelArgs, { responses_api: true });
});

test("Kimi translation enables its fixed-sampling compatibility hook", async () => {
  const translated = await resolveInspectModel(
    modelRuntime(),
    model({ provider: "kimi", id: "k3" }),
  );
  assert.equal(translated.childEnv.BENCH_KIMI_FIXED_SAMPLING, "1");
  assert.match(translated.adapter.summary, /Kimi fixed sampling/);
});

test("Anthropic translation preserves model IDs containing slashes", async () => {
  const translated = await resolveInspectModel(
    modelRuntime(),
    model({ api: "anthropic-messages" }),
  );
  assert.equal(translated.inspectModel, "anthropic/test-provider/vendor/model");
  assert.equal(translated.apiKeyEnv, "ANTHROPIC_API_KEY");
  assert.equal(translated.childEnv.ANTHROPIC_AUTH_TOKEN, "");
});

test("Google translation uses the model ID without a custom service prefix", async () => {
  const translated = await resolveInspectModel(
    modelRuntime(),
    model({ api: "google-generative-ai", id: "gemini-test" }),
  );
  assert.equal(translated.inspectModel, "google/gemini-test");
  assert.equal(translated.apiKeyEnv, "GOOGLE_API_KEY");
  await assert.rejects(
    resolveInspectModel(modelRuntime(), model({ api: "google-generative-ai" })),
    /cannot be represented by Inspect/,
  );
});

test("OpenCode Go adapter creates a fresh session header for each run", async () => {
  const selected = model({
    provider: "opencode-go",
    id: "flash-model",
    api: "openai-responses",
  });
  const first = await resolveInspectModel(modelRuntime(), selected);
  const second = await resolveInspectModel(modelRuntime(), selected);

  assert.equal(first.extraHeaders["x-opencode-client"], "inspect-ai");
  assert.match(first.extraHeaders["x-opencode-session"], /^[0-9a-f-]{36}$/);
  assert.notEqual(
    first.extraHeaders["x-opencode-session"],
    second.extraHeaders["x-opencode-session"],
  );
});

test("unsupported and untranslatable authentication fails closed", async () => {
  await assert.rejects(
    resolveInspectModel(modelRuntime(), model({ api: "unknown-api" })),
    /Unsupported Pi API/,
  );
  await assert.rejects(
    resolveInspectModel(modelRuntime({ subscription: true }), model()),
    /Subscription-backed provider/,
  );
  await assert.rejects(
    resolveInspectModel(
      modelRuntime({ resolution: { auth: { apiKey: "key", headers: { authorization: "secret" } }, env: {} } }),
      model(),
    ),
    /requires headers/,
  );
  await assert.rejects(
    resolveInspectModel(
      modelRuntime({ resolution: { auth: { apiKey: "key", headers: {} }, env: { account: "value" } } }),
      model(),
    ),
    /requires configuration/,
  );
});

test("regular Inspect invocation includes metadata and unchanged user arguments", async () => {
  const selected = model();
  const translated = await resolveInspectModel(modelRuntime(), selected);
  const args = buildInspectInvocation(
    { file: "smoke.py", name: "smoke" },
    selected,
    translated,
    { logDir: "logs" },
    ["--limit", "20", "--epochs", "3"],
  );

  assert.deepEqual(args.slice(0, 4), ["run", "inspect", "eval", "smoke.py@smoke"]);
  assert.ok(args.includes("openai-api/test-provider/vendor/model"));
  assert.ok(args.includes("responses_api=false"));
  assert.deepEqual(args.slice(-4), ["--limit", "20", "--epochs", "3"]);
  assert.ok(args.includes('pi_provider="test-provider"'));
  assert.ok(args.includes('pi_model="vendor/model"'));
  assert.ok(args.includes('pi_api="openai-completions"'));
  assert.equal(args.join(" ").includes("test-secret"), false);
});

test("OpenCode Go invocation carries generated headers in an inline model spec", async () => {
  const selected = model({ provider: "opencode-go", id: "flash", api: "openai-responses" });
  const translated = await resolveInspectModel(modelRuntime(), selected);
  const args = buildInspectInvocation(
    { file: "smoke.py", name: "smoke" },
    selected,
    translated,
    { logDir: "logs" },
  );
  const specIndex = args.indexOf("--model-spec");
  const spec = JSON.parse(args[specIndex + 1]);

  assert.equal(args.includes("--model"), false);
  assert.equal(spec.model, "openai-api/opencode-go/flash");
  assert.equal(spec.base_url, "https://example.test/v1");
  assert.deepEqual(spec.model_args, { responses_api: true });
  assert.equal(spec.extra_headers["x-opencode-client"], "inspect-ai");
  assert.match(spec.extra_headers["x-opencode-session"], /^[0-9a-f-]{36}$/);
});

test("installed Inspect benchmark registry includes official Inspect Evals descriptions", async () => {
  const tasks = await discoverRegisteredTasks(process.cwd());
  const inspectEvals = tasks.filter((task) => task.source === "inspect_evals");
  const arcEasy = inspectEvals.find((task) => task.spec === "inspect_evals/arc_easy");
  const bbq = inspectEvals.find((task) => task.spec === "inspect_evals/bbq");

  assert.ok(tasks.length >= 200);
  assert.ok(arcEasy);
  assert.ok(bbq);
  assert.equal(bbq.sampleCount, 58_492);
  assert.deepEqual(bbq.params, ["subsets", "shuffle"]);
  assert.equal(bbq.evalId, "bbq");
  assert.equal(bbq.packageVersion, "0.17.0");
  assert.equal(arcEasy.group, "Reasoning");
  assert.match(arcEasy.description, /grade-school science multiple-choice/i);
  assert.ok(inspectEvals.every((task) => typeof task.description === "string" && task.description.length > 0));
  assert.ok(tasks.find((task) => task.spec === "inspect_evals/gdm_sp01_milestones").description);
  assert.ok(tasks.find((task) => task.spec === "inspect_evals/paperbench_score").description);
  assert.equal(inspectEvals.filter((task) => Number.isInteger(task.sampleCount)).length, 236);
});

test("saved sweep creates grouped recommendations and warning annotations", async () => {
  const [tasks, sweep] = await Promise.all([
    discoverRegisteredTasks(process.cwd()),
    loadSweepData(),
  ]);
  const sources = buildBenchmarkSources(tasks, [{ name: "smoke", file: "benchmarks/smoke.py" }], sweep);
  const recommended = sources.find(({ source }) => source === "inspect_evals_recommended");
  const all = sources.find(({ source }) => source === "inspect_evals_all");
  const local = sources.find(({ source }) => source === "local");

  assert.deepEqual(sources.slice(0, 2).map(({ label }) => label), [
    "Recommended Inspect Evals",
    "All Inspect Evals",
  ]);
  assert.equal(recommended.benchmarks.length, 100);
  assert.equal(all.benchmarks.length, 247);
  assert.ok(recommended.benchmarks.every((task) => task.sweep.result === "passed"));
  assert.deepEqual(
    recommended.benchmarks.map((task) => `${task.group}/${task.displayName}`),
    recommended.benchmarks
      .map((task) => `${task.group}/${task.displayName}`)
      .toSorted((left, right) => left.localeCompare(right)),
  );
  assert.equal(new Set(recommended.benchmarks.map((task) => task.group)).size, 10);
  assert.equal(local.benchmarks[0].spec, "benchmarks/smoke.py@smoke");

  const blocked = all.benchmarks.find((task) => task.displayName === "abstention_bench");
  const inconclusive = all.benchmarks.find((task) => task.displayName === "anima");
  const passed = all.benchmarks.find((task) => task.displayName === "arc_easy");
  assert.equal(blocked.sweep.result, "blocked");
  assert.match(sweepWarningLines(blocked).join("\n"), /missing dependency[\s\S]*deepseek/i);
  assert.match(sweepWarningLines(inconclusive).join("\n"), /inconclusive/i);
  assert.equal(sweepWarningLines(passed), null);
});

test("benchmark TUI keeps rows compact and moves metadata into details", () => {
  const passed = {
    source: "inspect_evals",
    spec: "inspect_evals/arc_easy",
    displayName: "arc_easy",
    title: "ARC Easy",
    group: "Reasoning",
    sampleCount: 2_376,
    params: [],
    description: "Grade-school science questions.",
    sweep: {
      result: "passed",
      versionMatches: true,
      model: "deepseek/deepseek-flash",
      date: "2026-09-12",
      inspectEvalsVersion: "0.17.0",
    },
  };
  const blocked = {
    ...passed,
    spec: "inspect_evals/abstention_bench",
    displayName: "abstention_bench",
    title: "AbstentionBench",
    group: "Safeguards",
    sampleCount: 39_558,
    params: ["grader_model"],
    sweep: {
      ...passed.sweep,
      result: "blocked",
      category: "missing_dependency",
      diagnostic: "ModuleNotFoundError: No module named 'hydra'",
    },
  };

  assert.equal(formatCount(2_376), "2.4k");
  assert.equal(taskWarning(passed), false);
  assert.equal(taskWarning(blocked), true);
  assert.deepEqual(benchmarkListItem(blocked), {
    value: "inspect_evals/abstention_bench",
    label: "⚠ abstention_bench",
    description: "40k",
  });
  assert.deepEqual(benchmarkCategories([blocked, passed]), [
    { name: "All", count: 2 },
    { name: "Reasoning", count: 1 },
    { name: "Safeguards", count: 1 },
  ]);

  const details = stripTerminalSequences(benchmarkDetails(blocked).join("\n"));
  assert.match(details, /AbstentionBench/);
  assert.match(details, /39,558 samples/);
  assert.match(details, /Check was blocked/);
  assert.match(details, /ModuleNotFoundError/);
  assert.doesNotMatch(benchmarkListItem(blocked).label, /samples|Safeguards|ModuleNotFoundError/);
});

test("task configs are generated from and validated against the installed task source", async (t) => {
  const task = {
    source: "inspect_evals",
    displayName: "bbq",
    spec: "inspect_evals/bbq",
    evalId: "bbq",
    params: ["subsets", "shuffle"],
  };
  const template = await generateTaskConfigTemplate(process.cwd(), task);
  assert.match(template.content, /# package-version: 0\.17\.0/);
  assert.match(template.content, /# signature: [0-9a-f]{16}/);
  assert.match(template.content, /subsets: null/);
  assert.match(template.content, /shuffle: false/);
  assert.match(template.content, /ukgovernmentbeis\.github\.io\/inspect_evals\/evals\/bbq\//);

  const directory = await mkdtemp(join(tmpdir(), "bench-config-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "bbq.yaml");
  await writeFile(path, template.content);
  await validateTaskConfig(process.cwd(), task, path);

  await writeFile(path, "unknown_parameter: true\n");
  await assert.rejects(
    validateTaskConfig(process.cwd(), task, path),
    /unknown task parameter: unknown_parameter/,
  );
});

test("Inspect discovery handles empty results, failures, and missing uv", async (t) => {
  const empty = await executable(t, "printf '[]\\n'");
  await assert.rejects(
    discoverTasks(process.cwd(), ["smoke.py"], { uvCommand: empty }),
    /found no benchmarks/,
  );

  const failure = await executable(t, "echo 'inspect failed' >&2\nexit 7");
  await assert.rejects(
    discoverTasks(process.cwd(), ["smoke.py"], { uvCommand: failure }),
    /Inspect task discovery failed:\ninspect failed/,
  );

  await assert.rejects(
    discoverTasks(process.cwd(), ["smoke.py"], {
      uvCommand: join(tmpdir(), "missing-bench-uv"),
    }),
    /Required command not found/,
  );
});

test("Inspect child exit status is preserved", async () => {
  const status = await runInherited(
    process.execPath,
    ["-e", "process.exit(7)"],
    { cwd: process.cwd(), env: process.env },
  );
  assert.equal(status, 7);
});

test("OpenCode Go adapter sends a fresh session header through Inspect", async (t) => {
  let receivedHeaders;
  const server = createServer((request, response) => {
    receivedHeaders = request.headers;
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "test-model",
        content: [{ type: "text", text: "4" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }));
    });
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  t.after(() => new Promise((resolvePromise) => server.close(resolvePromise)));

  const logDir = await mkdtemp(join(tmpdir(), "bench-inspect-log-"));
  t.after(() => rm(logDir, { recursive: true, force: true }));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const selected = model({
    provider: "opencode-go",
    id: "test-model",
    api: "anthropic-messages",
    baseUrl: `http://127.0.0.1:${address.port}`,
  });
  const translated = await resolveInspectModel(modelRuntime(), selected);
  translated.modelArgs.streaming = false;
  const args = buildInspectInvocation(
    { file: "benchmarks/smoke.py", name: "smoke" },
    selected,
    translated,
    { logDir },
    ["--display", "none", "--max-retries", "0", "--max-tokens", "16"],
  );
  const status = await runInherited("uv", args, {
    cwd: process.cwd(),
    env: translated.childEnv,
  });

  assert.equal(status, 0);
  assert.equal(receivedHeaders["x-opencode-client"], "inspect-ai");
  assert.equal(
    receivedHeaders["x-opencode-session"],
    translated.extraHeaders["x-opencode-session"],
  );
});

test("Kimi adapter removes task sampling parameters before the API request", async (t) => {
  let receivedBody;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id: "chatcmpl_test",
        object: "chat.completion",
        created: 0,
        model: "k3",
        choices: [{
          index: 0,
          message: { role: "assistant", content: "ok" },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  t.after(() => new Promise((resolvePromise) => server.close(resolvePromise)));

  const directory = await mkdtemp(join(tmpdir(), "bench-kimi-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const taskPath = join(directory, "fixed_sampling.py");
  const logDir = join(directory, "logs");
  await writeFile(taskPath, `
from inspect_ai import Task, task
from inspect_ai.dataset import Sample
from inspect_ai.model import GenerateConfig
from inspect_ai.scorer import match
from inspect_ai.solver import generate

@task
def fixed_sampling():
    return Task(
        dataset=[Sample(input="Reply with ok", target="ok")],
        solver=[generate()],
        scorer=match(),
        config=GenerateConfig(
            max_tokens=16,
            temperature=0,
            top_p=1,
            frequency_penalty=0.5,
            presence_penalty=0.5,
        ),
    )
`);

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const selected = model({
    provider: "kimi",
    id: "k3",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
  });
  const translated = await resolveInspectModel(modelRuntime(), selected);
  translated.modelArgs.stream = false;
  const args = buildInspectInvocation(
    { file: taskPath, name: "fixed_sampling" },
    selected,
    translated,
    { logDir },
    ["--display", "none", "--max-retries", "0"],
  );
  const status = await runInherited("uv", args, {
    cwd: process.cwd(),
    env: translated.childEnv,
  });

  assert.equal(status, 0);
  assert.equal(receivedBody.model, "k3");
  assert.equal("temperature" in receivedBody, false);
  assert.equal("top_p" in receivedBody, false);
  assert.equal("frequency_penalty" in receivedBody, false);
  assert.equal("presence_penalty" in receivedBody, false);
});
