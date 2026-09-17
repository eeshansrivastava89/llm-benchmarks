import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareRun } from "../../src/lib/prompt-prep.ts";
import { loadBenchmarks } from "../../src/lib/benchmarks.ts";
import type { BenchmarkRecord } from "../../src/lib/types.ts";

const BENCHMARKS = join(import.meta.dirname, "..", "..", "benchmarks");

const benchmark: BenchmarkRecord = {
  id: "sakura",
  kind: "visual",
  title: "Sakura Tree",
  description: "Dreamy cherry blossom animation.",
  prompt: "Animate a cherry blossom tree."
};

describe("prepareRun", () => {
  it("creates a prepared run folder with metadata and a tool-agnostic prompt", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "viewer-prep-runs-"));
    const prepared = await prepareRun({
      benchmark,
      modelId: "google/gemma-4-e4b",
      runsRoot,
      now: new Date("2026-05-07T04:00:32.122Z")
    });

    expect(prepared.run).toMatchObject({
      runId: "2026-05-07T04-00-32-122Z",
      status: "prepared",
      model: {
        id: "google/gemma-4-e4b"
      },
      assets: {
        metadata: "metadata.json",
        prompt: "prompt.md",
        html: "index.html",
        preview: "preview.png"
      }
    });
    // Prompt is a pass-through — HTML instructions come from .md files, not prepareRun
    expect(prepared.prompt).toContain("Animate a cherry blossom tree.");
    // Tool-agnostic: prepareRun must never leak tool-specific details into the prompt
    expect(prepared.prompt).not.toContain("OpenCode");
    expect(prepared.prompt).not.toContain("Pi");
    expect(prepared.prompt).not.toContain("Model label:");
    expect(prepared.prompt).not.toContain("Benchmark:");
    expect(prepared.prompt).not.toContain("Run folder:");
    expect(prepared.prompt).not.toContain("Output contract:");
    expect(prepared.prompt).not.toContain(prepared.paths.htmlPath);
    expect(prepared.prompt).not.toContain(prepared.paths.runDirectory);
    expect(prepared.prompt).not.toContain("preview.png");
    await expect(stat(prepared.paths.runDirectory)).resolves.toBeTruthy();
    await expect(readFile(prepared.paths.promptPath, "utf8")).resolves.toBe(
      prepared.prompt
    );
    await expect(readFile(prepared.paths.metadataPath, "utf8")).resolves.toContain(
      "\"status\": \"prepared\""
    );
  });

  it("records custom model source metadata for cloud runs", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "viewer-prep-custom-runs-"));
    const prepared = await prepareRun({
      benchmark,
      modelId: "ChatGPT",
      modelSource: "cloud",
      backendLabel: "Cloud",
      runsRoot,
      now: new Date("2026-05-07T04:00:32.122Z")
    });

    expect(prepared.run).toMatchObject({
      model: {
        id: "ChatGPT",
        slug: "chatgpt"
      },
      tool: "pi",
      runner: {
        mode: "external",
        modelSource: "cloud",
        intendedRunner: "Pi",
        backendLabel: "Cloud",
        model: "ChatGPT"
      }
    });
  });

  it("records model source and harness metadata without command artifacts", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "viewer-prep-omlx-runs-"));
    const prepared = await prepareRun({
      benchmark,
      modelId: "Qwen3.6-35B-A3B-4bit",
      modelSource: "omlx",
      baseUrl: "http://127.0.0.1:8000/v1",
      runsRoot,
      now: new Date("2026-05-07T04:00:32.122Z")
    });

    expect(prepared.command).toBeUndefined();
    expect(prepared.run).toMatchObject({
      kind: "visual",
      tool: "pi",
      runner: {
        mode: "external",
        modelSource: "omlx",
        intendedRunner: "Pi",
        backendLabel: "oMLX",
        baseUrl: "http://127.0.0.1:8000/v1"
      }
    });
    expect(prepared.run.assets.command).toBeUndefined();
    await expect(readFile(prepared.paths.metadataPath, "utf8")).resolves.toContain(
      "\"modelSource\": \"omlx\""
    );
  });

  it("creates a prepared run with HTML instructions from a loaded visual benchmark", async () => {
    const benchmarks = await loadBenchmarks(BENCHMARKS);
    const sakura = benchmarks.find((b) => b.id === "sakura");
    expect(sakura).toBeDefined();
    if (!sakura) return;

    const runsRoot = await mkdtemp(join(tmpdir(), "viewer-prep-loaded-"));
    const prepared = await prepareRun({
      benchmark: sakura,
      modelId: "google/gemma-4-e4b",
      runsRoot,
      now: new Date("2026-05-07T04:00:32.122Z")
    });

    // HTML instructions come from the .md file via loadBenchmarks
    expect(prepared.prompt).toContain("Create a complete, self-contained HTML file");
    expect(prepared.prompt).toContain("Write the file as `index.html`");
    expect(prepared.prompt).toContain("cherry blossom");
    // Aesthetic self-review via Playwright is part of the prompt — the model
    // screenshots its output and refines until accurate and aesthetically
    // pleasing. Mechanical correctness is implied (a broken canvas can't be
    // aesthetically pleasing), so it is not instructed separately.
    expect(prepared.prompt).toContain("Playwright");
    // Still tool-agnostic — no leaked paths or tool names
    expect(prepared.prompt).not.toContain("OpenCode");
    expect(prepared.prompt).not.toContain(prepared.paths.htmlPath);
    expect(prepared.prompt).not.toContain(prepared.paths.runDirectory);
  });

  it("prepares data-science runs with DS assets and raw prompt", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "viewer-prep-ds-runs-"));
    const dsBenchmark: BenchmarkRecord = {
      id: "ab-test-analysis",
      kind: "data-science",
      title: "A/B Test Production Analysis",
      description: "Analyze the A/B test.",
      prompt: "Analyze the A/B test data from Supabase."
    };
    const prepared = await prepareRun({
      benchmark: dsBenchmark,
      modelId: "qwen3-30b-a3b",
      kind: "data-science",
      runsRoot,
      now: new Date("2026-05-26T04:00:32.122Z"),
      dataScienceAccess: {
        baseUrl: "https://example.supabase.co/",
        anonKey: "test-anon-key"
      }
    });

    expect(prepared.run).toMatchObject({
      kind: "data-science",
      assets: {
        metadata: "metadata.json",
        prompt: "prompt.md",
        ds: {
          notebook: "analysis.ipynb",
          summary: "summary.json",
          chartDistribution: "chart-distribution.png",
          chartTreatmentEffect: "chart-treatment-effect.png",
          chartCompletionRates: "chart-completion-rates.png"
        }
      }
    });
    expect(prepared.prompt).not.toContain("Write the file as `index.html`");
    expect(prepared.prompt).toContain("Analyze the A/B test data from Supabase.");
    expect(prepared.run.assets.html).toBeUndefined();
    expect(prepared.run.assets.preview).toBeUndefined();
    await expect(readFile(prepared.paths.supabaseConfigPath, "utf8")).resolves.toContain(
      "https://example.supabase.co/rest/v1/posthog_events"
    );
    expect((await stat(prepared.paths.supabaseConfigPath)).mode & 0o777).toBe(0o600);
  });

  it("rejects missing data-science access before creating a run folder", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "viewer-prep-ds-missing-"));
    const dsBenchmark: BenchmarkRecord = {
      id: "ab-test-analysis",
      kind: "data-science",
      title: "A/B Test Production Analysis",
      description: "Analyze the A/B test.",
      prompt: "Analyze the A/B test data from Supabase."
    };

    await expect(prepareRun({
      benchmark: dsBenchmark,
      modelId: "qwen3-30b-a3b",
      runsRoot,
      now: new Date("2026-05-26T04:00:32.122Z")
    })).rejects.toThrow(/SUPABASE_URL and SUPABASE_ANON_KEY/);

    await expect(stat(join(runsRoot, "ab-test-analysis"))).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("rejects a run kind that disagrees with benchmark frontmatter", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "viewer-prep-kind-mismatch-"));
    await expect(prepareRun({
      benchmark,
      modelId: "model-a",
      kind: "data-science",
      dataScienceAccess: {
        baseUrl: "https://example.supabase.co",
        anonKey: "test-anon-key"
      },
      runsRoot
    })).rejects.toThrow(/does not match benchmark kind/);
  });
});
