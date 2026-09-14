import { spawn, execFile } from "node:child_process";
import { chmod, open, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { platform } from "node:os";
import { join, resolve } from "node:path";

import { BenchError } from "./errors.mjs";
import { probeTcp } from "./providers.mjs";

export const VIEWER_IDS = Object.freeze({
  inspect: "inspect",
  visual: "visual",
});

const HOST = "127.0.0.1";
const DEFAULT_INSPECT_PORT = 7575;
const DEFAULT_VISUAL_PORT = 4321;
const STATE_SCHEMA_VERSION = 1;
const DEFAULT_POLL_INTERVAL_MS = 150;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;

export function createViewerDescriptors(options = {}) {
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd());
  const environment = options.environment ?? process.env;
  const runtimeRoot = resolve(options.runtimeRoot ?? join(repositoryRoot, ".bench-runtime"));
  const inspectPort = viewerPort(environment.BENCH_INSPECT_VIEWER_PORT, DEFAULT_INSPECT_PORT, "BENCH_INSPECT_VIEWER_PORT");
  const visualPort = viewerPort(environment.BENCH_VISUAL_VIEWER_PORT, DEFAULT_VISUAL_PORT, "BENCH_VISUAL_VIEWER_PORT");
  if (inspectPort === visualPort) {
    throw new BenchError("Inspect and Visual viewers must use different ports");
  }

  return {
    repositoryRoot,
    runtimeRoot,
    statePath: join(runtimeRoot, "viewers.json"),
    viewers: {
      inspect: {
        id: VIEWER_IDS.inspect,
        label: "Inspect results",
        host: HOST,
        port: inspectPort,
        url: `http://${HOST}:${inspectPort}`,
        healthPath: "/api/app-config",
        command: "uv",
        args: [
          "run",
          "--project",
          repositoryRoot,
          "inspect",
          "view",
          "start",
          "--host",
          HOST,
          "--port",
          String(inspectPort),
          "--log-dir",
          join(repositoryRoot, "logs"),
        ],
        cwd: runtimeRoot,
        commandId: "inspect-viewer-v1",
        processMarkers: ["uv", "inspect", "view", "start", String(inspectPort)],
        startupTimeoutMs: 20_000,
        logPath: join(runtimeRoot, "inspect-viewer.log"),
        signature: (value) => typeof value?.inspect_version === "string",
      },
      visual: {
        id: VIEWER_IDS.visual,
        label: "Visual results",
        host: HOST,
        port: visualPort,
        url: `http://${HOST}:${visualPort}`,
        healthPath: "/api/benchmarks",
        command: "npm",
        args: ["run", "dev", "--", "--host", HOST, "--port", String(visualPort)],
        cwd: repositoryRoot,
        commandId: "visual-viewer-v1",
        processMarkers: ["npm", "run", "dev", String(visualPort)],
        startupTimeoutMs: 30_000,
        logPath: join(runtimeRoot, "visual-viewer.log"),
        signature: (value) => Array.isArray(value?.benchmarks),
      },
    },
  };
}

export function createViewerManager(options = {}) {
  const descriptorSet = options.descriptorSet ?? createViewerDescriptors(options);
  const dependencies = {
    endpointStatus: options.endpointStatus ?? defaultEndpointStatus,
    spawnViewer: options.spawnViewer ?? defaultSpawnViewer,
    processMatches: options.processMatches ?? defaultProcessMatches,
    groupExists: options.groupExists ?? defaultGroupExists,
    signalGroup: options.signalGroup ?? defaultSignalGroup,
    sleep: options.sleep ?? ((milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))),
    now: options.now ?? (() => new Date()),
    openUrl: options.openUrl ?? defaultOpenUrl,
    clock: options.clock ?? Date.now,
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    stopTimeoutMs: options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS,
  };

  return {
    descriptors: descriptorSet,
    async start(target) {
      const ids = targetViewerIds(target);
      const results = [];
      for (const id of ids) results.push(await startViewer(descriptorSet, id, dependencies));
      return results;
    },
    async status(target = "both") {
      const state = await readViewerState(descriptorSet.statePath);
      return Promise.all(targetViewerIds(target).map((id) => viewerStatus(
        descriptorSet.viewers[id],
        state.viewers[id],
        dependencies,
      )));
    },
    async stop(target) {
      const ids = targetViewerIds(target);
      const results = [];
      for (const id of ids) results.push(await stopViewer(descriptorSet, id, dependencies));
      return results;
    },
    async open(id) {
      const descriptor = viewerDescriptor(descriptorSet, id);
      await dependencies.openUrl(descriptor.url);
      return descriptor.url;
    },
  };
}

export function targetViewerIds(target) {
  if (target === "both") return [VIEWER_IDS.inspect, VIEWER_IDS.visual];
  if (target === VIEWER_IDS.inspect || target === VIEWER_IDS.visual) return [target];
  throw new BenchError(`Unknown viewer target: ${target}`);
}

async function startViewer(descriptorSet, id, dependencies) {
  const descriptor = viewerDescriptor(descriptorSet, id);
  let state = await readViewerState(descriptorSet.statePath);
  const current = await viewerStatus(descriptor, state.viewers[id], dependencies);

  if (current.health === "healthy") {
    if (state.viewers[id] && !current.owned) {
      delete state.viewers[id];
      await writeViewerState(descriptorSet, state);
    }
    return { ...current, action: "reused" };
  }
  if (current.health === "occupied") {
    throw new BenchError(`${descriptor.label} port ${descriptor.port} is occupied by an unknown application`);
  }
  if (state.viewers[id]) {
    delete state.viewers[id];
    await writeViewerState(descriptorSet, state);
  }

  await mkdir(descriptorSet.runtimeRoot, { recursive: true, mode: 0o700 });
  await chmod(descriptorSet.runtimeRoot, 0o700);
  if (id === VIEWER_IDS.inspect) {
    await mkdir(join(descriptorSet.repositoryRoot, "logs"), { recursive: true });
  }
  const child = await dependencies.spawnViewer(descriptor);
  if (!Number.isInteger(child.pid) || child.pid <= 0) {
    throw new BenchError(`${descriptor.label} did not provide a valid process ID`);
  }

  const deadline = dependencies.clock() + descriptor.startupTimeoutMs;
  while (dependencies.clock() < deadline) {
    const health = await dependencies.endpointStatus(descriptor);
    if (health === "healthy") {
      const entry = {
        pid: child.pid,
        pgid: child.pid,
        url: descriptor.url,
        commandId: descriptor.commandId,
        startedAt: dependencies.now().toISOString(),
        logPath: descriptor.logPath,
      };
      state = await readViewerState(descriptorSet.statePath);
      state.viewers[id] = entry;
      await writeViewerState(descriptorSet, state);
      return {
        id,
        label: descriptor.label,
        url: descriptor.url,
        health: "healthy",
        owned: true,
        pid: child.pid,
        action: "started",
      };
    }
    if (
      (child.exitCode !== null && child.exitCode !== undefined)
      || (child.signalCode !== null && child.signalCode !== undefined)
    ) {
      await terminateStartedChild(child.pid, descriptor, dependencies);
      const reason = child.signalCode ? `signal ${child.signalCode}` : `status ${child.exitCode}`;
      throw new BenchError(`${descriptor.label} exited with ${reason}; see ${descriptor.logPath}`);
    }
    await dependencies.sleep(optionsPollInterval(dependencies));
  }

  await terminateStartedChild(child.pid, descriptor, dependencies);
  throw new BenchError(`${descriptor.label} did not become healthy within ${descriptor.startupTimeoutMs}ms; see ${descriptor.logPath}`);
}

async function stopViewer(descriptorSet, id, dependencies) {
  const descriptor = viewerDescriptor(descriptorSet, id);
  const state = await readViewerState(descriptorSet.statePath);
  const entry = state.viewers[id];
  if (!entry) {
    const status = await viewerStatus(descriptor, null, dependencies);
    return { ...status, action: "not-owned" };
  }

  const stateMatches = entry.commandId === descriptor.commandId && entry.url === descriptor.url;
  const groupExists = stateMatches && await dependencies.groupExists(entry.pgid);
  const processMatches = groupExists && await dependencies.processMatches(entry, descriptor);
  const health = await dependencies.endpointStatus(descriptor);
  if (!stateMatches || !groupExists || !processMatches) {
    delete state.viewers[id];
    await writeViewerState(descriptorSet, state);
    return {
      id,
      label: descriptor.label,
      url: descriptor.url,
      health: health === "healthy" ? "healthy" : "stale",
      owned: false,
      action: "stale-state-removed",
    };
  }
  if (health === "occupied") {
    throw new BenchError(`Refusing to stop ${descriptor.label}: its port now serves an unknown application`);
  }

  await dependencies.signalGroup(entry.pgid, "SIGTERM");
  const deadline = dependencies.clock() + dependencies.stopTimeoutMs;
  while (dependencies.clock() < deadline) {
    const [stillRunning, endpoint] = await Promise.all([
      dependencies.groupExists(entry.pgid),
      dependencies.endpointStatus(descriptor),
    ]);
    if (!stillRunning && endpoint !== "healthy") break;
    await dependencies.sleep(optionsPollInterval(dependencies));
  }

  if (await dependencies.groupExists(entry.pgid)) {
    if (!await dependencies.processMatches(entry, descriptor)) {
      throw new BenchError(`Refusing to force-stop ${descriptor.label}: process identity changed`);
    }
    await dependencies.signalGroup(entry.pgid, "SIGKILL");
    const killDeadline = dependencies.clock() + dependencies.stopTimeoutMs;
    while (dependencies.clock() < killDeadline && await dependencies.groupExists(entry.pgid)) {
      await dependencies.sleep(optionsPollInterval(dependencies));
    }
    if (await dependencies.groupExists(entry.pgid)) {
      throw new BenchError(`${descriptor.label} process group ${entry.pgid} did not stop`);
    }
  }

  delete state.viewers[id];
  await writeViewerState(descriptorSet, state);
  return {
    id,
    label: descriptor.label,
    url: descriptor.url,
    health: "stopped",
    owned: false,
    action: "stopped",
  };
}

async function viewerStatus(descriptor, entry, dependencies) {
  const health = await dependencies.endpointStatus(descriptor);
  if (health === "occupied") {
    return {
      id: descriptor.id,
      label: descriptor.label,
      url: descriptor.url,
      health,
      owned: false,
      pid: entry?.pid,
    };
  }
  if (health !== "healthy") {
    return {
      id: descriptor.id,
      label: descriptor.label,
      url: descriptor.url,
      health: entry ? "stale" : "stopped",
      owned: false,
      pid: entry?.pid,
    };
  }

  const stateMatches = entry?.commandId === descriptor.commandId && entry?.url === descriptor.url;
  const owned = Boolean(
    stateMatches
    && await dependencies.groupExists(entry.pgid)
    && await dependencies.processMatches(entry, descriptor)
  );
  return {
    id: descriptor.id,
    label: descriptor.label,
    url: descriptor.url,
    health: "healthy",
    owned,
    pid: owned ? entry.pid : undefined,
  };
}

async function defaultEndpointStatus(descriptor) {
  const listening = await probeTcp({ hostname: descriptor.host, port: descriptor.port }, 250);
  if (!listening) return "stopped";

  try {
    const response = await fetch(new URL(descriptor.healthPath, descriptor.url), {
      signal: AbortSignal.timeout(1_500),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return "occupied";
    return descriptor.signature(await response.json()) ? "healthy" : "occupied";
  } catch {
    return "occupied";
  }
}

async function defaultSpawnViewer(descriptor) {
  const log = await open(descriptor.logPath, "a", 0o600);
  let child;
  try {
    await log.chmod(0o600);
    child = spawn(descriptor.command, descriptor.args, {
      cwd: descriptor.cwd,
      env: process.env,
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
    });
    await new Promise((resolvePromise, reject) => {
      child.once("spawn", resolvePromise);
      child.once("error", reject);
    });
    child.on("error", () => {});
    child.unref();
    return child;
  } catch (error) {
    throw new BenchError(`Could not start ${descriptor.label}: ${errorMessage(error)}`);
  } finally {
    await log.close();
  }
}

async function defaultProcessMatches(entry, descriptor) {
  let command;
  try {
    command = await execFileText("ps", ["-p", String(entry.pid), "-o", "command="]);
  } catch {
    return false;
  }
  return descriptor.processMarkers.every((marker) => command.includes(marker));
}

async function defaultGroupExists(pgid) {
  try {
    process.kill(platform() === "win32" ? pgid : -pgid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function defaultSignalGroup(pgid, signal) {
  try {
    process.kill(platform() === "win32" ? pgid : -pgid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function terminateStartedChild(pgid, descriptor, dependencies) {
  if (!await dependencies.groupExists(pgid)) return;
  const entry = { pid: pgid, pgid, commandId: descriptor.commandId, url: descriptor.url };
  if (!await dependencies.processMatches(entry, descriptor)) return;
  await dependencies.signalGroup(pgid, "SIGTERM");
  const deadline = dependencies.clock() + dependencies.stopTimeoutMs;
  while (dependencies.clock() < deadline && await dependencies.groupExists(pgid)) {
    await dependencies.sleep(optionsPollInterval(dependencies));
  }
  if (await dependencies.groupExists(pgid) && await dependencies.processMatches(entry, descriptor)) {
    await dependencies.signalGroup(pgid, "SIGKILL");
  }
}

async function readViewerState(path) {
  let value;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return emptyState();
    if (error instanceof SyntaxError) {
      throw new BenchError(`Viewer state is invalid: ${path}`);
    }
    throw error;
  }
  if (value?.schemaVersion !== STATE_SCHEMA_VERSION || !value.viewers || typeof value.viewers !== "object") {
    throw new BenchError(`Viewer state is invalid: ${path}`);
  }
  return value;
}

async function writeViewerState(descriptorSet, state) {
  await mkdir(descriptorSet.runtimeRoot, { recursive: true, mode: 0o700 });
  await chmod(descriptorSet.runtimeRoot, 0o700);
  const temporaryPath = `${descriptorSet.statePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, descriptorSet.statePath);
}

function emptyState() {
  return { schemaVersion: STATE_SCHEMA_VERSION, viewers: {} };
}

function viewerDescriptor(descriptorSet, id) {
  const descriptor = descriptorSet.viewers[id];
  if (!descriptor) throw new BenchError(`Unknown viewer: ${id}`);
  return descriptor;
}

function viewerPort(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new BenchError(`${name} must be an integer from 1 to 65535`);
  }
  return port;
}

function optionsPollInterval(dependencies) {
  return dependencies.pollIntervalMs;
}

async function defaultOpenUrl(url) {
  const command = platform() === "darwin"
    ? ["open", [url]]
    : platform() === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]];
  const child = spawn(command[0], command[1], { detached: true, stdio: "ignore" });
  await new Promise((resolvePromise, reject) => {
    child.once("spawn", resolvePromise);
    child.once("error", reject);
  });
  child.unref();
}

function execFileText(command, args) {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, { encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error);
      else resolvePromise(stdout);
    });
  });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
