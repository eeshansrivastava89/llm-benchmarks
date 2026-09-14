import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildPiInvocation,
  executeInteractiveBenchmark,
  finalizeInteractiveDiagnostics,
  interactiveDiagnosticPaths,
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

function confinementTestOptions(root) {
  const runtime = {
    platform: "darwin",
    runtime: "sandbox-exec",
    executable: "/usr/bin/sandbox-exec",
  };
  return {
    diagnosticsRoot: join(root, "private-diagnostics"),
    confinementCheckImpl: async () => runtime,
    confinementLaunchImpl: async (command, args, options) => ({
      command,
      args,
      cwd: options.runDirectory,
      env: options.env,
      runDirectory: options.runDirectory,
      runtime,
      cleanup: async () => {},
    }),
  };
}

test("Pi invocation disables ambient resources, keeps built-in tools, and uses a private session", () => {
  const invocation = buildPiInvocation(cloudModel(), visualBenchmark(), {
    sessionDirectory: "/run/.bench-session",
  });
  assert.deepEqual(invocation, [
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--no-approve",
    "--tools",
    "read,bash,edit,write",
    "--session-dir",
    "/run/.bench-session",
    "--append-system-prompt",
    "Write durable benchmark outputs only in the current run directory. The operating-system policy blocks persistent writes elsewhere; host reads, installed tools, IPC, and network access remain available.",
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
  assert.doesNotMatch(buildPiInvocation(model, visualBenchmark(), {
    sessionDirectory: "/run/.bench-session",
  }).join(" "), /private-local-key/);
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

test("foreground Pi execution accepts a controllable fake child", async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => true;
  let spawnCall;

  const running = runForeground("pi", ["--provider", "test"], {
    cwd: "/tmp/fake-run",
    env: { SAFE_VALUE: "yes" },
    signalTarget: new EventEmitter(),
    spawnImpl: (command, args, options) => {
      spawnCall = { command, args, options };
      queueMicrotask(() => child.emit("close", 0, null));
      return child;
    },
  });

  assert.deepEqual(await running, {
    code: 0,
    signal: null,
    interruptedBy: null,
    status: 0,
  });
  assert.deepEqual(spawnCall, {
    command: "pi",
    args: ["--provider", "test"],
    options: {
      cwd: "/tmp/fake-run",
      env: { SAFE_VALUE: "yes" },
      stdio: "inherit",
    },
  });
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

test("write-confinement preflight fails before lifecycle setup or run preparation", async () => {
  let lifecycleStarted = false;
  let runPrepared = false;

  await assert.rejects(
    executeInteractiveBenchmark({
      repositoryRoot: process.cwd(),
      benchmark: visualBenchmark(),
      model: cloudModel(),
      modelRuntime: {},
      confinementCheckImpl: async () => {
        throw new Error("write confinement unavailable");
      },
      lifecycleFactory: async () => {
        lifecycleStarted = true;
      },
      prepareRunImpl: async () => {
        runPrepared = true;
      },
    }),
    /write confinement unavailable/u,
  );

  assert.equal(lifecycleStarted, false);
  assert.equal(runPrepared, false);
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
    ...confinementTestOptions(runsRoot),
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
  assert.deepEqual(launch.args, buildPiInvocation(cloudModel(), visualBenchmark(), {
    sessionDirectory: join(execution.prepared.paths.runDirectory, ".bench-session"),
  }));
  assert.equal(launch.options.cwd, execution.prepared.paths.runDirectory);
  assert.deepEqual(launch.options.env, { SAFE_VALUE: "yes" });
  const metadata = await metadataFor(execution);
  assert.equal(metadata.status, "prepared");
  assert.equal(metadata.runner.actualRunner, "Pi");
  assert.deepEqual(metadata.runner.isolation, {
    mode: "os-write-confinement",
    runtime: "sandbox-exec",
    platform: "darwin",
    filesystem: "run-slot-and-temporary-write",
    reads: "host-readable",
    network: "host-access",
    diagnostics: "private-bench-runtime",
  });
  assert.equal(metadata.runner.launchCommand, execution.launchCommand);
  assert.doesNotMatch(metadata.runner.launchCommand, /undefined=<redacted>/);
});

test("Visual diagnostics move outside the run slot while Data Science diagnostics are discarded", async (t) => {
  const root = await temporaryRunsRoot(t);
  const prepared = {
    paths: { runDirectory: join(root, "runs", "sakura", "model", "run-1") },
    run: {
      runId: "run-1",
      benchmark: { id: "sakura" },
      model: { slug: "model" },
    },
  };
  const visualPaths = interactiveDiagnosticPaths(root, prepared);
  await mkdir(visualPaths.stagingDirectory, { recursive: true });
  await writeFile(join(visualPaths.stagingDirectory, "session.jsonl"), '{"type":"session"}\n');
  await writeFile(join(visualPaths.stagingDirectory, "ignore.txt"), "ignored");

  assert.deepEqual(await finalizeInteractiveDiagnostics({
    kind: "visual",
    ...visualPaths,
  }), { status: "retained", files: 1 });
  assert.equal(
    await readFile(join(visualPaths.destinationDirectory, "session.jsonl"), "utf8"),
    '{"type":"session"}\n',
  );
  assert.equal((await stat(join(visualPaths.destinationDirectory, "session.jsonl"))).mode & 0o777, 0o600);
  await assert.rejects(stat(visualPaths.stagingDirectory), { code: "ENOENT" });

  const dataSciencePaths = {
    stagingDirectory: join(prepared.paths.runDirectory, ".bench-session-ds"),
    destinationDirectory: join(root, ".bench-runtime", "should-not-exist"),
  };
  await mkdir(dataSciencePaths.stagingDirectory, { recursive: true });
  await writeFile(join(dataSciencePaths.stagingDirectory, "session.jsonl"), "temporary-secret");
  assert.deepEqual(await finalizeInteractiveDiagnostics({
    kind: "data-science",
    ...dataSciencePaths,
  }), { status: "discarded", files: 0 });
  await assert.rejects(stat(dataSciencePaths.stagingDirectory), { code: "ENOENT" });
  await assert.rejects(stat(dataSciencePaths.destinationDirectory), { code: "ENOENT" });
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
    ...confinementTestOptions(runsRoot),
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

test("normal Pi exit unloads Ollama through its mocked API", async (t) => {
  const runsRoot = await temporaryRunsRoot(t);
  const requests = [];
  const model = cloudModel({
    provider: "ollama",
    id: "qwen-test",
    baseUrl: "http://127.0.0.1:11434/v1",
    backend: { location: "local", status: "online" },
  });

  const execution = await executeInteractiveBenchmark({
    repositoryRoot: process.cwd(),
    runsRoot,
    benchmark: visualBenchmark(),
    model,
    modelRuntime: {},
    ...confinementTestOptions(runsRoot),
    lifecycleOptions: {
      fetchImpl: async (url, options = {}) => {
        requests.push({ url: String(url), options });
        if (String(url).endsWith("/api/ps")) {
          return new Response(JSON.stringify({ models: [{ name: "qwen-test:latest" }] }));
        }
        assert.deepEqual(JSON.parse(options.body), { model: "qwen-test", keep_alive: 0 });
        return new Response(JSON.stringify({ done: true }));
      },
    },
    runForegroundImpl: async () => ({
      code: 0,
      signal: null,
      interruptedBy: null,
      status: 0,
    }),
  });

  assert.equal(execution.cleanupResult.status, "unloaded");
  assert.deepEqual(requests.map(({ url }) => new URL(url).pathname), [
    "/api/ps",
    "/api/generate",
  ]);
  assert.equal((await metadataFor(execution)).status, "prepared");
});

test("interrupted Pi exit unloads oMLX through its authenticated mocked API", async (t) => {
  const runsRoot = await temporaryRunsRoot(t);
  const requests = [];
  const apiKey = "private-omlx-cleanup-key";
  const model = cloudModel({
    provider: "omlx",
    id: "Qwen/Test Model",
    baseUrl: "http://127.0.0.1:8000/v1",
    backend: { location: "local", status: "online" },
  });

  const execution = await executeInteractiveBenchmark({
    repositoryRoot: process.cwd(),
    runsRoot,
    benchmark: visualBenchmark(),
    model,
    modelRuntime: {
      getAuth: async () => ({ auth: { apiKey } }),
    },
    ...confinementTestOptions(runsRoot),
    lifecycleOptions: {
      fetchImpl: async (url, options = {}) => {
        requests.push({ url: String(url), options });
        if (String(url).endsWith("/models/status")) {
          return new Response(JSON.stringify({
            models: [{ id: model.id, loaded: true }],
          }));
        }
        return new Response(JSON.stringify({ status: "ok" }));
      },
    },
    runForegroundImpl: async () => ({
      code: null,
      signal: "SIGTERM",
      interruptedBy: "SIGTERM",
      status: 143,
    }),
  });

  assert.equal(execution.cleanupResult.status, "unloaded");
  assert.deepEqual(requests.map(({ url }) => new URL(url).pathname), [
    "/v1/models/status",
    "/v1/models/Qwen%2FTest%20Model/unload",
  ]);
  assert.equal(requests.every(({ options }) => options.headers.authorization === `Bearer ${apiKey}`), true);
  const metadata = await metadataFor(execution);
  assert.equal(metadata.status, "cancelled");
  assert.doesNotMatch(JSON.stringify(metadata), /private-omlx-cleanup-key/);
  assert.doesNotMatch(execution.launchCommand, /private-omlx-cleanup-key/);
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
    ...confinementTestOptions(runsRoot),
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
  assert.equal(metadata.runner.isolation.network, "host-access");
  assert.equal(metadata.runner.isolation.diagnostics, "discarded-after-run");
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
      ...confinementTestOptions(runsRoot),
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
