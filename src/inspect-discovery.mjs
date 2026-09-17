import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { buildBenchmarkSources, loadSweepData } from "./catalog.mjs";
import { BenchError, errorMessage } from "./errors.mjs";

const REGISTRY_DISCOVERY_SCRIPT = fileURLToPath(
  new URL("../scripts/inspect_registry_discovery.py", import.meta.url),
);

const activeCapturedChildren = new Set();

export function stopActiveCapturedChildren() {
  for (const child of activeCapturedChildren) child.kill("SIGTERM");
  activeCapturedChildren.clear();
}

export function runCaptured(command, args, cwd, env = process.env, failureLabel = "Command failed") {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeCapturedChildren.add(child);
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(new BenchError(`Required command not found: ${command}`));
        return;
      }
      reject(new BenchError(`Could not start ${command}: ${errorMessage(error)}`));
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }
      const detail = stderr.trim() || stdout.trim() || (signal ? `terminated by ${signal}` : `exit code ${code}`);
      reject(new BenchError(`${failureLabel}:\n${detail}`));
    });
  });
}

export async function discoverTasks(cwd, taskRoots, options = {}) {
  const output = await runCaptured(
    options.uvCommand ?? "uv",
    ["run", "inspect", "list", "tasks", "--json", "--", ...taskRoots],
    cwd,
    options.env,
    "Inspect task discovery failed",
  );

  let tasks;
  try {
    tasks = JSON.parse(output);
  } catch (error) {
    throw new BenchError(`Inspect returned invalid JSON: ${errorMessage(error)}`);
  }
  if (
    !Array.isArray(tasks) ||
    tasks.some((task) => !task || typeof task !== "object" || typeof task.name !== "string" || typeof task.file !== "string")
  ) {
    throw new BenchError("Inspect returned an unexpected task listing");
  }
  if (tasks.length === 0 && !options.allowEmpty) {
    throw new BenchError(`Inspect found no benchmarks in: ${taskRoots.join(", ")}`);
  }

  return tasks.sort((left, right) => left.name.localeCompare(right.name) || left.file.localeCompare(right.file));
}

export async function discoverRegisteredTasks(cwd, options = {}) {
  const output = await runCaptured(
    options.uvCommand ?? "uv",
    ["run", "python", REGISTRY_DISCOVERY_SCRIPT],
    cwd,
    options.env,
    "Inspect registry discovery failed",
  );

  let tasks;
  try {
    tasks = JSON.parse(output);
  } catch (error) {
    throw new BenchError(`Inspect registry returned invalid JSON: ${errorMessage(error)}`);
  }
  if (
    !Array.isArray(tasks)
    || tasks.some((task) => (
      !task
      || typeof task.name !== "string"
      || !Array.isArray(task.params)
      || task.params.some((parameter) => typeof parameter !== "string")
      || (task.description !== null && typeof task.description !== "string")
      || (task.group !== null && typeof task.group !== "string")
      || (task.evalId !== null && typeof task.evalId !== "string")
      || (task.sampleCount !== null && (!Number.isInteger(task.sampleCount) || task.sampleCount < 0))
      || (task.packageVersion !== null && typeof task.packageVersion !== "string")
    ))
  ) {
    throw new BenchError("Inspect returned an unexpected registry listing");
  }

  return tasks.map((task) => {
    const separator = task.name.indexOf("/");
    const source = separator === -1 ? "installed" : task.name.slice(0, separator);
    return {
      ...task,
      source,
      sourceLabel: source === "inspect_evals" ? "Inspect Evals" : source,
      displayName: separator === -1 ? task.name : task.name.slice(separator + 1),
      spec: task.name,
    };
  });
}

export async function discoverBenchmarks(cwd, customTaskRoots, options = {}) {
  const [registered, custom, sweepData] = await Promise.all([
    discoverRegisteredTasks(cwd, options),
    customTaskRoots.length > 0
      ? discoverTasks(cwd, customTaskRoots, { ...options, allowEmpty: true })
      : Promise.resolve([]),
    loadSweepData(options.sweepDataPath),
  ]);
  return buildBenchmarkSources(registered, custom, sweepData);
}