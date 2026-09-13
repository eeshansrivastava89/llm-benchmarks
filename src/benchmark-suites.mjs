import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadBenchmarks } from "./lib/benchmarks.ts";
import {
  prepareRun,
  validateDataScienceAccess,
} from "./lib/prompt-prep.ts";

const DEFAULT_REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));

export const INTERACTIVE_BENCHMARK_SUITES = Object.freeze([
  Object.freeze({ id: "visual", kind: "visual", label: "Visual Bench" }),
  Object.freeze({ id: "data-science", kind: "data-science", label: "Data Science" }),
]);

export async function loadInteractiveBenchmarkSuites(options = {}) {
  const repositoryRoot = resolve(options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT);
  const benchmarkDirectory = resolve(
    options.benchmarkDirectory ?? join(repositoryRoot, "benchmarks"),
  );
  const benchmarks = await loadBenchmarks(benchmarkDirectory);

  return INTERACTIVE_BENCHMARK_SUITES.map((suite) => ({
    ...suite,
    benchmarks: benchmarks.filter((benchmark) => benchmark.kind === suite.kind),
  }));
}

export async function prepareInteractiveBenchmarkRun(input) {
  if (!input?.benchmark) {
    throw new Error("A benchmark is required to prepare an interactive run.");
  }
  if (input.benchmark.kind !== "visual" && input.benchmark.kind !== "data-science") {
    throw new Error("Interactive benchmarks require a validated visual or data-science kind.");
  }
  if (typeof input.modelId !== "string" || input.modelId.trim().length === 0) {
    throw new Error("A model ID is required to prepare an interactive run.");
  }

  const repositoryRoot = resolve(input.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT);
  const dataScienceAccess = input.benchmark.kind === "data-science"
    ? input.dataScienceAccess ?? await loadProjectDataScienceAccess({
        repositoryRoot,
        environment: input.environment,
      })
    : undefined;

  return prepareRun({
    benchmark: input.benchmark,
    modelId: input.modelId,
    modelSource: input.modelSource,
    runner: "pi",
    kind: input.benchmark.kind,
    baseUrl: input.baseUrl,
    backendLabel: input.backendLabel,
    runsRoot: resolve(input.runsRoot ?? join(repositoryRoot, "runs")),
    now: input.now,
    dataScienceAccess,
  });
}

export async function loadProjectDataScienceAccess(options = {}) {
  const repositoryRoot = resolve(options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT);
  const environment = options.environment ?? process.env;
  const fileEnvironment = await readEnvironmentFile(
    join(repositoryRoot, ".env"),
    options.readFileImpl ?? readFile,
  );

  return validateDataScienceAccess({
    baseUrl: preferredValue(environment.SUPABASE_URL, fileEnvironment.SUPABASE_URL),
    anonKey: preferredValue(
      environment.SUPABASE_ANON_KEY,
      fileEnvironment.SUPABASE_ANON_KEY,
    ),
  });
}

async function readEnvironmentFile(path, readFileImpl) {
  let source;
  try {
    source = await readFileImpl(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new Error(`Could not read Data Science configuration at ${path}: ${errorMessage(error)}`);
  }

  const values = {};
  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    if (key !== "SUPABASE_URL" && key !== "SUPABASE_ANON_KEY") continue;
    values[key] = unquote(trimmed.slice(separator + 1).trim());
  }
  return values;
}

function preferredValue(primary, fallback) {
  return primary?.trim() || fallback?.trim() || "";
}

function unquote(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
