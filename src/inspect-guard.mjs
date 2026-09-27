import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BenchError } from "./errors.mjs";
import { runCaptured } from "./inspect-discovery.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/inspect_guard.py", import.meta.url));

export async function inspectLogNames(cwd, logDir) {
  try {
    return new Set((await readdir(resolve(cwd, logDir))).filter((name) => /\.(eval|json)$/.test(name)));
  } catch (error) {
    if (error.code === "ENOENT") return new Set();
    throw error;
  }
}

export async function checkInspectOutcome(cwd, logDir, before, runId, execute = runCaptured) {
  const after = await inspectLogNames(cwd, logDir);
  const newLogs = [...after].filter((name) => !before.has(name)).map((name) => resolve(cwd, logDir, name));
  if (newLogs.length === 0) throw new BenchError("Inspect exited without creating an evaluation log");
  await execute("uv", ["run", "python", SCRIPT, "outcome", runId, JSON.stringify(newLogs)], cwd, process.env,
    "Inspect evaluation failed");
}
