import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { resolveInspectResultsUrl } from "../src/viewer-config.mjs";
import {
  createViewerDescriptors,
  createViewerManager,
} from "../src/viewers.mjs";

async function viewerFixture(t, overrides = {}) {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "bench-viewers-"));
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  const descriptorSet = createViewerDescriptors({
    repositoryRoot,
    environment: overrides.environment ?? {},
  });
  descriptorSet.viewers.inspect.startupTimeoutMs = overrides.startupTimeoutMs ?? 100;
  descriptorSet.viewers.visual.startupTimeoutMs = overrides.startupTimeoutMs ?? 100;
  return { repositoryRoot, descriptorSet };
}

function fakeManager(descriptorSet, controls = {}) {
  let clock = 0;
  const signals = [];
  const manager = createViewerManager({
    descriptorSet,
    endpointStatus: async (descriptor) => controls.endpoint?.[descriptor.id] ?? "stopped",
    spawnViewer: async (descriptor) => {
      controls.spawnCount = (controls.spawnCount ?? 0) + 1;
      controls.spawnedIds = [...(controls.spawnedIds ?? []), descriptor.id];
      controls.onSpawn?.(descriptor);
      return controls.child?.[descriptor.id] ?? { pid: descriptor.id === "inspect" ? 4101 : 4102, exitCode: null };
    },
    processMatches: async () => controls.processMatches ?? true,
    groupExists: async () => controls.groupExists ?? false,
    signalGroup: async (pgid, signal) => {
      signals.push({ pgid, signal });
      controls.onSignal?.(pgid, signal);
    },
    sleep: async (milliseconds) => {
      clock += milliseconds;
      controls.onSleep?.();
    },
    clock: () => clock,
    pollIntervalMs: 10,
    stopTimeoutMs: 30,
    now: () => new Date("2026-06-11T12:00:00.000Z"),
    openUrl: async (url) => {
      controls.openedUrl = url;
    },
  });
  return { manager, signals };
}

test("viewer descriptors use fixed loopback endpoints and explicit commands", () => {
  const descriptors = createViewerDescriptors({
    repositoryRoot: "/project",
    environment: {},
  });

  assert.equal(descriptors.viewers.inspect.url, "http://127.0.0.1:7575");
  assert.deepEqual(descriptors.viewers.inspect.args, [
    "run", "--project", "/project", "inspect", "view", "start",
    "--host", "127.0.0.1", "--port", "7575", "--log-dir", "/project/logs",
  ]);
  assert.equal(descriptors.viewers.inspect.cwd, "/project/.bench-runtime");
  assert.equal(descriptors.viewers.visual.url, "http://127.0.0.1:4321");
  assert.deepEqual(descriptors.viewers.visual.args, [
    "run", "dev", "--", "--host", "127.0.0.1", "--port", "4321",
  ]);
  assert.equal(descriptors.viewers.inspect.signature({ inspect_version: "0.3.263" }), true);
  assert.equal(descriptors.viewers.inspect.signature({ benchmarks: [] }), false);
  assert.equal(descriptors.viewers.visual.signature({ benchmarks: [] }), true);
});

test("viewer ports are configurable but cannot collide", () => {
  const descriptors = createViewerDescriptors({
    repositoryRoot: "/project",
    environment: {
      BENCH_INSPECT_VIEWER_PORT: "17575",
      BENCH_VISUAL_VIEWER_PORT: "14321",
    },
  });
  assert.equal(descriptors.viewers.inspect.port, 17575);
  assert.equal(descriptors.viewers.visual.port, 14321);
  assert.throws(() => createViewerDescriptors({
    repositoryRoot: "/project",
    environment: {
      BENCH_INSPECT_VIEWER_PORT: "9000",
      BENCH_VISUAL_VIEWER_PORT: "9000",
    },
  }), /different ports/);
  assert.throws(() => createViewerDescriptors({
    repositoryRoot: "/project",
    environment: { BENCH_INSPECT_VIEWER_PORT: "free" },
  }), /integer from 1 to 65535/);
});

test("Inspect result links use local viewer configuration and require an explicit static URL", () => {
  assert.equal(resolveInspectResultsUrl({ environment: {} }), "http://127.0.0.1:7575");
  assert.equal(resolveInspectResultsUrl({
    environment: { BENCH_INSPECT_VIEWER_PORT: "17575" },
  }), "http://127.0.0.1:17575");
  assert.equal(resolveInspectResultsUrl({ staticBuild: true, environment: {} }), undefined);
  assert.equal(resolveInspectResultsUrl({
    staticBuild: true,
    environment: { PUBLIC_INSPECT_VIEWER_URL: "https://inspect.example/results" },
  }), "https://inspect.example/results");
  assert.throws(() => resolveInspectResultsUrl({
    staticBuild: true,
    environment: { PUBLIC_INSPECT_VIEWER_URL: "javascript:alert(1)" },
  }), /HTTP\(S\) URL/);
  assert.throws(() => resolveInspectResultsUrl({
    staticBuild: true,
    environment: { PUBLIC_INSPECT_VIEWER_URL: "http://localhost:7575" },
  }), /must not target localhost/);
});

test("starting records ownership, reuses the healthy process, and opens its URL", async (t) => {
  const privateValue = "provider-secret-must-not-persist";
  const { descriptorSet } = await viewerFixture(t, {
    environment: { PROVIDER_API_KEY: privateValue },
  });
  const controls = {
    endpoint: { inspect: "stopped" },
    groupExists: true,
    onSleep() {
      controls.endpoint.inspect = "healthy";
    },
  };
  const { manager } = fakeManager(descriptorSet, controls);
  const [started] = await manager.start("inspect");
  assert.equal(started.action, "started");
  assert.equal(started.owned, true);
  assert.equal(controls.spawnCount, 1);

  const state = JSON.parse(await readFile(descriptorSet.statePath, "utf8"));
  assert.deepEqual(Object.keys(state.viewers), ["inspect"]);
  assert.deepEqual(state.viewers.inspect, {
    pid: 4101,
    pgid: 4101,
    url: "http://127.0.0.1:7575",
    commandId: "inspect-viewer-v1",
    startedAt: "2026-06-11T12:00:00.000Z",
    logPath: descriptorSet.viewers.inspect.logPath,
  });
  assert.equal((await stat(descriptorSet.runtimeRoot)).mode & 0o777, 0o700);
  assert.equal((await stat(descriptorSet.statePath)).mode & 0o777, 0o600);
  assert.doesNotMatch(JSON.stringify(state), /API_KEY|SUPABASE|secret/i);
  assert.doesNotMatch(JSON.stringify(descriptorSet.viewers), new RegExp(privateValue));

  const [reused] = await manager.start("inspect");
  assert.equal(reused.action, "reused");
  assert.equal(reused.owned, true);
  assert.equal(controls.spawnCount, 1);
  await manager.open("inspect");
  assert.equal(controls.openedUrl, "http://127.0.0.1:7575");
});

test("both viewer descriptors launch independent fake children", async (t) => {
  const { descriptorSet } = await viewerFixture(t);
  const controls = {
    endpoint: { inspect: "stopped", visual: "stopped" },
    groupExists: true,
    onSleep() {
      for (const id of controls.spawnedIds ?? []) controls.endpoint[id] = "healthy";
    },
  };
  const { manager } = fakeManager(descriptorSet, controls);

  const results = await manager.start("both");

  assert.deepEqual(controls.spawnedIds, ["inspect", "visual"]);
  assert.deepEqual(results.map(({ id, action }) => [id, action]), [
    ["inspect", "started"],
    ["visual", "started"],
  ]);
  const state = JSON.parse(await readFile(descriptorSet.statePath, "utf8"));
  assert.deepEqual(Object.keys(state.viewers).sort(), ["inspect", "visual"]);
});

test("a matching external viewer is reused but never recorded as owned", async (t) => {
  const { descriptorSet } = await viewerFixture(t);
  const controls = { endpoint: { inspect: "healthy" }, groupExists: false };
  const { manager } = fakeManager(descriptorSet, controls);
  const [result] = await manager.start("inspect");

  assert.equal(result.action, "reused");
  assert.equal(result.owned, false);
  assert.equal(controls.spawnCount, undefined);
  await assert.rejects(readFile(descriptorSet.statePath, "utf8"), { code: "ENOENT" });
});

test("stop is idempotent and leaves external viewers and unknown port occupants alone", async (t) => {
  const { descriptorSet } = await viewerFixture(t);
  const controls = { endpoint: { visual: "stopped" } };
  const { manager, signals } = fakeManager(descriptorSet, controls);
  assert.equal((await manager.stop("visual"))[0].action, "already-stopped");
  controls.endpoint.visual = "healthy";
  assert.equal((await manager.stop("visual"))[0].action, "not-owned");
  controls.endpoint.visual = "occupied";
  assert.equal((await manager.stop("visual"))[0].action, "not-owned");
  assert.deepEqual(signals, []);
});

test("ownership survives the launching CLI exiting and a new CLI can stop the real process", { skip: process.platform === "win32" }, async (t) => {
  const { repositoryRoot } = await viewerFixture(t);
  const socket = createServer();
  await new Promise((resolvePromise) => socket.listen(0, "127.0.0.1", resolvePromise));
  const port = socket.address().port;
  await new Promise((resolvePromise) => socket.close(resolvePromise));
  const serverPath = join(repositoryRoot, "viewer-server.mjs");
  await writeFile(serverPath, `
    import { createServer } from 'node:http';
    createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ benchmarks: [] }));
    }).listen(Number(process.argv[2]), '127.0.0.1');
  `);
  const controllerPath = join(repositoryRoot, "viewer-cli.mjs");
  await writeFile(controllerPath, `
    import { createViewerDescriptors, createViewerManager } from ${JSON.stringify(new URL("../src/viewers.mjs", import.meta.url).href)};
    const descriptorSet = createViewerDescriptors({
      repositoryRoot: ${JSON.stringify(repositoryRoot)},
      environment: { BENCH_VISUAL_VIEWER_PORT: '${port}', BENCH_INSPECT_VIEWER_PORT: '${port === 7575 ? 7576 : 7575}' },
    });
    Object.assign(descriptorSet.viewers.visual, {
      command: process.execPath, args: [${JSON.stringify(serverPath)}, '${port}'],
      processMarkers: [${JSON.stringify(serverPath)}, '${port}'], startupTimeoutMs: 5000,
    });
    console.log(JSON.stringify(await createViewerManager({ descriptorSet })[process.argv[2]]('visual')));
  `);
  const run = async (action) => {
    const { stdout } = await promisify(execFile)(process.execPath, [controllerPath, action], { timeout: 15_000 });
    return JSON.parse(stdout)[0];
  };
  const started = await run("start");
  t.after(() => {
    // Best-effort cleanup of only the child created by this test if an assertion fails.
    try { process.kill(-started.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  });
  assert.equal(started.action, "started");
  assert.equal(started.owned, true);
  const status = await run("status");
  assert.equal(status.owned, true);
  assert.equal(status.pid, started.pid);
  const reused = await run("start");
  assert.equal(reused.action, "reused");
  assert.equal(reused.owned, true);
  assert.equal(reused.pid, started.pid);
  assert.equal((await run("stop")).action, "stopped");
  assert.equal((await run("status")).health, "stopped");
  assert.equal((await run("stop")).action, "already-stopped");
});

test("an unknown application on a configured port blocks startup", async (t) => {
  const { descriptorSet } = await viewerFixture(t);
  const controls = { endpoint: { visual: "occupied" } };
  const { manager } = fakeManager(descriptorSet, controls);

  await assert.rejects(manager.start("visual"), /occupied by an unknown application/);
  assert.equal(controls.spawnCount, undefined);
});

test("stop signals only a validated owned process group and removes state", async (t) => {
  const { descriptorSet } = await viewerFixture(t);
  const controls = {
    endpoint: { inspect: "stopped" },
    groupExists: true,
    onSleep() {
      controls.endpoint.inspect = "healthy";
    },
  };
  const { manager, signals } = fakeManager(descriptorSet, controls);
  await manager.start("inspect");
  controls.onSignal = (_pgid, signal) => {
    if (signal === "SIGTERM") {
      controls.groupExists = false;
      controls.endpoint.inspect = "stopped";
    }
  };

  const [result] = await manager.stop("inspect");
  assert.equal(result.action, "stopped");
  assert.deepEqual(signals, [{ pgid: 4101, signal: "SIGTERM" }]);
  const state = JSON.parse(await readFile(descriptorSet.statePath, "utf8"));
  assert.deepEqual(state.viewers, {});
});

test("stale ownership is removed without signaling an unrelated process", async (t) => {
  const { descriptorSet } = await viewerFixture(t);
  const controls = {
    endpoint: { inspect: "stopped" },
    groupExists: true,
    onSleep() {
      controls.endpoint.inspect = "healthy";
    },
  };
  const { manager, signals } = fakeManager(descriptorSet, controls);
  await manager.start("inspect");
  controls.endpoint.inspect = "stopped";
  controls.groupExists = false;

  const [result] = await manager.stop("inspect");
  assert.equal(result.action, "stale-state-removed");
  assert.deepEqual(signals, []);
});

test("viewer startup reports missing commands and early child failures", async (t) => {
  const { descriptorSet } = await viewerFixture(t);
  const missing = createViewerManager({
    descriptorSet,
    endpointStatus: async () => "stopped",
    spawnViewer: async () => {
      throw new Error("command missing");
    },
  });
  await assert.rejects(missing.start("inspect"), /command missing/);

  const controls = {
    endpoint: { inspect: "stopped" },
    groupExists: false,
    child: { inspect: { pid: 4101, exitCode: 7, signalCode: null } },
  };
  const { manager } = fakeManager(descriptorSet, controls);
  await assert.rejects(manager.start("inspect"), /exited with status 7/);
});

test("startup timeout terminates only the spawned process group", async (t) => {
  const { descriptorSet } = await viewerFixture(t, { startupTimeoutMs: 20 });
  const controls = {
    endpoint: { inspect: "stopped" },
    groupExists: true,
    onSignal(_pgid, signal) {
      if (signal === "SIGKILL") controls.groupExists = false;
    },
  };
  const { manager, signals } = fakeManager(descriptorSet, controls);

  await assert.rejects(manager.start("inspect"), /did not become healthy/);
  assert.deepEqual(signals, [
    { pgid: 4101, signal: "SIGTERM" },
    { pgid: 4101, signal: "SIGKILL" },
  ]);
});
