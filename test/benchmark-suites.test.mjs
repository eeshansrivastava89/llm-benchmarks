import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  loadInteractiveBenchmarkSuites,
  loadProjectDataScienceAccess,
  prepareInteractiveBenchmarkRun,
} from "../src/benchmark-suites.mjs";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(REPOSITORY_ROOT, "test", "fixtures");

async function temporaryDirectory(t, prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function readFixture(name) {
  return JSON.parse(await readFile(join(FIXTURES, name), "utf8"));
}

async function normalizedMetadata(prepared) {
  const metadata = JSON.parse(await readFile(prepared.paths.metadataPath, "utf8"));
  metadata.runDirectory = "<run-directory>";
  metadata.benchmark.prompt = "<benchmark-prompt>";
  metadata.benchmark.sourcePath = "<benchmark-source>";
  return metadata;
}

async function benchmarkById(id) {
  const suites = await loadInteractiveBenchmarkSuites({
    repositoryRoot: REPOSITORY_ROOT,
  });
  return suites.flatMap((suite) => suite.benchmarks).find((benchmark) => benchmark.id === id);
}

test("interactive suites are discovered from benchmark kind frontmatter", async () => {
  const suites = await loadInteractiveBenchmarkSuites({
    repositoryRoot: REPOSITORY_ROOT,
  });

  assert.deepEqual(
    suites.map(({ id, kind, label, benchmarks }) => ({
      id,
      kind,
      label,
      benchmarkIds: benchmarks.map((benchmark) => benchmark.id),
    })),
    [
      {
        id: "visual",
        kind: "visual",
        label: "Visual Bench",
        benchmarkIds: [
          "macro-wildflower-meadow",
          "sakura",
          "snow-globe-village",
          "solar-system",
          "sunset-ocean-study",
        ],
      },
      {
        id: "data-science",
        kind: "data-science",
        label: "Data Science",
        benchmarkIds: ["ab-test-analysis"],
      },
    ],
  );
});

test("Bench prepares visual runs through the canonical visual modules", async (t) => {
  const runsRoot = await temporaryDirectory(t, "bench-visual-runs-");
  const benchmark = await benchmarkById("sakura");
  assert.ok(benchmark);

  const prepared = await prepareInteractiveBenchmarkRun({
    repositoryRoot: REPOSITORY_ROOT,
    runsRoot,
    benchmark,
    modelId: "model-a",
    modelSource: "cloud",
    backendLabel: "Cloud",
    baseUrl: "https://api.example.test/v1",
    now: new Date("2026-05-07T04:00:32.122Z"),
  });

  assert.deepEqual(
    await normalizedMetadata(prepared),
    await readFixture("visual-prepared-run.json"),
  );
  assert.deepEqual(await readdir(prepared.paths.runDirectory), [
    "metadata.json",
    "prompt.md",
  ]);
});

test("Bench prepares data-science runs only with validated project access", async (t) => {
  const repositoryRoot = await temporaryDirectory(t, "bench-ds-project-");
  const runsRoot = join(repositoryRoot, "runs");
  await writeFile(
    join(repositoryRoot, ".env"),
    [
      "SUPABASE_URL=https://project.supabase.test/",
      "SUPABASE_ANON_KEY='project-test-key'",
      "",
    ].join("\n"),
    "utf8",
  );
  const benchmark = await benchmarkById("ab-test-analysis");
  assert.ok(benchmark);

  const prepared = await prepareInteractiveBenchmarkRun({
    repositoryRoot,
    runsRoot,
    environment: {},
    benchmark,
    modelId: "model-ds",
    modelSource: "cloud",
    backendLabel: "Cloud",
    now: new Date("2026-05-26T04:00:32.122Z"),
  });

  assert.deepEqual(
    await normalizedMetadata(prepared),
    await readFixture("data-science-prepared-run.json"),
  );
  assert.deepEqual((await readdir(prepared.paths.runDirectory)).sort(), [
    "metadata.json",
    "prompt.md",
    "supabase.json",
  ]);
  const accessFile = JSON.parse(await readFile(prepared.paths.supabaseConfigPath, "utf8"));
  assert.equal(
    accessFile.url,
    "https://project.supabase.test/rest/v1/posthog_events?select=*&session_id=not.is.null&variant=not.is.null",
  );
  assert.equal(accessFile.headers.apikey, "project-test-key");
  assert.equal((await stat(prepared.paths.supabaseConfigPath)).mode & 0o777, 0o600);
  assert.doesNotMatch(await readFile(prepared.paths.metadataPath, "utf8"), /project-test-key/);
  assert.doesNotMatch(await readFile(prepared.paths.promptPath, "utf8"), /project-test-key/);
});

test("shell Data Science settings take precedence over the project env file", async (t) => {
  const repositoryRoot = await temporaryDirectory(t, "bench-ds-env-");
  await writeFile(
    join(repositoryRoot, ".env"),
    "SUPABASE_URL=https://file.supabase.test\nSUPABASE_ANON_KEY=file-key\n",
    "utf8",
  );

  const access = await loadProjectDataScienceAccess({
    repositoryRoot,
    environment: {
      SUPABASE_URL: "https://shell.supabase.test",
      SUPABASE_ANON_KEY: "shell-key",
    },
  });

  assert.deepEqual(access, {
    baseUrl: "https://shell.supabase.test",
    anonKey: "shell-key",
  });
});

test("missing Data Science access fails before a run directory is created", async (t) => {
  const repositoryRoot = await temporaryDirectory(t, "bench-ds-missing-");
  const benchmark = await benchmarkById("ab-test-analysis");
  assert.ok(benchmark);

  await assert.rejects(
    prepareInteractiveBenchmarkRun({
      repositoryRoot,
      environment: {},
      benchmark,
      modelId: "model-ds",
      now: new Date("2026-05-26T04:00:32.122Z"),
    }),
    /SUPABASE_URL and SUPABASE_ANON_KEY/,
  );
  await assert.rejects(stat(join(repositoryRoot, "runs")), { code: "ENOENT" });
});
