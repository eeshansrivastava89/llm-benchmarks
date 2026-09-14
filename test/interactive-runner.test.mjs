import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildPiInvocation,
  executeInteractiveBenchmark,
  interactiveModelMetadata,
  resolveLocalModelConnection,
  runForeground,
} from "../src/interactive-runner.mjs";

function cloudModel(overrides = {}) {
  return {
    provider: "openai",
    id: "gpt-test",
    baseUrl: "https://api.example.test/v1",
    backend: { location: "cloud" },
    ...overrides,
  };
}

function visualBenchmark() {
  return {
    id: "sakura",
    kind: "visual",
    title: "Sakura Tree",
    description: "Build a scene.",
    prompt: "Create index.html in this run directory.",
  };
}

async function temporaryRunsRoot(t) {
  const directory = await mkdtemp(join(tmpdir(), "bench-interactive-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function metadataFor(execution) {
  return JSON.parse(await readFile(execution.prepared.paths.metadataPath, "utf8"));
}

test("Pi invocation uses the exact provider, model, session name, and prompt file", () => {
  assert.deepEqual(buildPiInvocation(cloudModel(), visualBenchmark()), [
    "--provider",
    "openai",
    "--model",
    "gpt-test",
    "--name",
    "Bench: Sakura Tree",
    "--",
    "@prompt.md",
  ]);
  assert.deepEqual(interactiveModelMetadata(cloudModel()), {
    modelSource: "cloud",
    backendLabel: "openai",
  });
  assert.deepEqual(interactiveModelMetadata(cloudModel({
    provider: "omlx",
    backend: { location: "local", status: "online" },
  })), {
    modelSource: "omlx",
    backendLabel: "oMLX",
  });
});

test("local cleanup access stays separate from Pi command arguments", async () => {
  const model = cloudModel({
    provider: "omlx",
    id: "local-model",
    baseUrl: "http://127.0.0.1:8000/v1",
    backend: { location: "local", status: "online" },
  });
  const connection = await resolveLocalModelConnection({
    getAuth: async () => ({ auth: { apiKey: "private-local-key" } }),
  }, model);

  assert.deepEqual(connection, {
    baseUrl: "http://127.0.0.1:8000/v1",
    apiKey: "private-local-key",
  });
  assert.doesNotMatch(buildPiInvocation(model, visualBenchmark()).join(" "), /private-local-key/);
});

test("foreground child execution preserves statuses and reports missing commands", async () => {
  const success = await runForeground(process.execPath, ["-e", "process.exit(0)"], {
    cwd: process.cwd(),
    env: process.env,
  });
  const failure = await runForeground(process.execPath, ["-e", "process.exit(7)"], {
    cwd: process.cwd(),
    env: process.env,
  });

  assert.equal(success.status, 0);
  assert.equal(failure.status, 7);
  await assert.rejects(
    runForeground(join(tmpdir(), "missing-pi-command"), [], {
      cwd: process.cwd(),
      env: process.env,
    }),
    /Required command not found/,
  );
});

test("foreground execution forwards handled termination and waits for the child", async () => {
  const signalTarget = new EventEmitter();
  const running = runForeground(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { cwd: process.cwd(), env: process.env, signalTarget },
  );
  setTimeout(() => signalTarget.emit("SIGTERM"), 30);
  const result = await running;

  assert.equal(result.interruptedBy, "SIGTERM");
  assert.equal(result.signal, "SIGTERM");
  assert.equal(result.status, 128 + 15);
  assert.equal(signalTarget.listenerCount("SIGINT"), 0);
  assert.equal(signalTarget.listenerCount("SIGTERM"), 0);
});

test("successful execution prepares one slot, launches in it, and leaves it prepared", async (t) => {
  const runsRoot = await temporaryRunsRoot(t);
  let launch;
  let lifecyclePolicy;
  let cleanupCalls = 0;
  const events = [];
  const execution = await executeInteractiveBenchmark({
    repositoryRoot: process.cwd(),
    runsRoot,
    benchmark: visualBenchmark(),
    model: cloudModel(),
    modelRuntime: {},
    env: { SAFE_VALUE: "yes" },
    lifecycleFactory: async (_model, connection, options) => {
      assert.equal(connection, null);
      lifecyclePolicy = options.policy;
      return {
        cleanup: async () => {
          cleanupCalls += 1;
          return { status: "unloaded", message: "test cleanup" };
        },
      };
    },
    onPrepared: ({ prepared }) => {
      events.push(`prepared:${prepared.paths.runDirectory}`);
    },
    runForegroundImpl: async (command, args, options) => {
      events.push(`launch:${options.cwd}`);
      launch = { command, args, options };
      return { code: 0, signal: null, interruptedBy: null, status: 0 };
    },
  });

  assert.equal(lifecyclePolicy, "always");
  assert.equal(cleanupCalls, 1);
  assert.deepEqual(events, [
    `prepared:${execution.prepared.paths.runDirectory}`,
    `launch:${execution.prepared.paths.runDirectory}`,
  ]);
  assert.equal(launch.command, "pi");
  assert.deepEqual(launch.args, buildPiInvocation(cloudModel(), visualBenchmark()));
  assert.equal(launch.options.cwd, execution.prepared.paths.runDirectory);
  assert.deepEqual(launch.options.env, { SAFE_VALUE: "yes" });
  const metadata = await metadataFor(execution);
  assert.equal(metadata.status, "prepared");
  assert.equal(metadata.runner.actualRunner, "Pi");
  assert.equal(metadata.runner.launchCommand, execution.launchCommand);
  assert.doesNotMatch(metadata.runner.launchCommand, /undefined=<redacted>/);
});

test("handled termination cancels the slot after cleanup", async (t) => {
  const runsRoot = await temporaryRunsRoot(t);
  let cleaned = false;
  const execution = await executeInteractiveBenchmark({
    repositoryRoot: process.cwd(),
    runsRoot,
    benchmark: visualBenchmark(),
    model: cloudModel(),
    modelRuntime: {},
    lifecycleFactory: async () => ({
      cleanup: async () => {
        cleaned = true;
        return { status: "unloaded", message: "cleaned" };
      },
    }),
    runForegroundImpl: async () => ({
      code: null,
      signal: "SIGINT",
      interruptedBy: "SIGINT",
      status: 130,
    }),
  });

  assert.equal(cleaned, true);
  const metadata = await metadataFor(execution);
  assert.equal(metadata.status, "cancelled");
  assert.ok(metadata.cancelledAt);
});

test("nonzero Pi exits fail the slot and remove Data Science access", async (t) => {
  const runsRoot = await temporaryRunsRoot(t);
  const benchmark = {
    id: "ab-test-analysis",
    kind: "data-science",
    title: "A/B Test Analysis",
    description: "Analyze results.",
    prompt: "Read supabase.json and produce the required analysis files.",
  };
  const execution = await executeInteractiveBenchmark({
    repositoryRoot: process.cwd(),
    runsRoot,
    benchmark,
    model: cloudModel(),
    modelRuntime: {},
    dataScienceAccess: {
      baseUrl: "https://project.supabase.test",
      anonKey: "private-test-key",
    },
    runForegroundImpl: async (_command, _args, options) => {
      await stat(join(options.cwd, "supabase.json"));
      return { code: 7, signal: null, interruptedBy: null, status: 7 };
    },
  });

  const metadata = await metadataFor(execution);
  assert.equal(metadata.status, "failed");
  assert.equal(metadata.error.message, "Pi exited with status 7");
  assert.doesNotMatch(JSON.stringify(metadata), /private-test-key/);
  await assert.rejects(stat(execution.prepared.paths.supabaseConfigPath), { code: "ENOENT" });
});

test("launch failures are sanitized, recorded, cleaned up, and remove access files", async (t) => {
  const runsRoot = await temporaryRunsRoot(t);
  let preparedPaths;
  let cleaned = false;
  const benchmark = {
    id: "ab-test-analysis",
    kind: "data-science",
    title: "A/B Test Analysis",
    description: "Analyze results.",
    prompt: "Analyze the dataset.",
  };

  await assert.rejects(
    executeInteractiveBenchmark({
      repositoryRoot: process.cwd(),
      runsRoot,
      benchmark,
      model: cloudModel(),
      modelRuntime: {},
      dataScienceAccess: {
        baseUrl: "https://project.supabase.test",
        anonKey: "do-not-record-this-secret",
      },
      lifecycleFactory: async () => ({
        cleanup: async () => {
          cleaned = true;
          return { status: "unloaded", message: "cleaned" };
        },
      }),
      updateMetadataImpl: async (paths, update) => {
        preparedPaths = paths;
        const { updateRunMetadata } = await import("../src/lib/runs.ts");
        return updateRunMetadata(paths, update);
      },
      runForegroundImpl: async () => {
        throw new Error("provider secret do-not-record-this-secret");
      },
    }),
    (error) => {
      assert.match(error.message, /^Could not launch Pi\.$/);
      assert.doesNotMatch(error.message, /do-not-record-this-secret/);
      return true;
    },
  );

  assert.equal(cleaned, true);
  const metadata = JSON.parse(await readFile(preparedPaths.metadataPath, "utf8"));
  assert.equal(metadata.status, "failed");
  assert.equal(metadata.error.message, "Could not launch Pi.");
  assert.doesNotMatch(JSON.stringify(metadata), /do-not-record-this-secret/);
  await assert.rejects(stat(preparedPaths.supabaseConfigPath), { code: "ENOENT" });
});
