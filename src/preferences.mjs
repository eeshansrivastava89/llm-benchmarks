import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const FILE_NAME = ".bench-state.json";

export async function loadBenchPreferences(cwd) {
  try {
    const value = JSON.parse(await readFile(resolve(cwd, FILE_NAME), "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export async function saveBenchPreferences(cwd, preferences) {
  await writeFile(
    resolve(cwd, FILE_NAME),
    `${JSON.stringify({ schemaVersion: 1, ...preferences }, null, 2)}\n`,
    "utf8",
  );
}
