import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildToolPrompt } from "../../src/lib/prompt-prep.ts";
import { loadBenchmarks } from "../../src/lib/benchmarks.ts";

const BENCHMARKS = join(import.meta.dirname, "..", "..", "benchmarks");

describe("buildToolPrompt", () => {
  const visualBenchmark = {
    id: "sakura",
    kind: "visual" as const,
    title: "Sakura Tree",
    description: "Cherry blossom animation.",
    prompt: "Animate a cherry blossom tree.",
    sourcePath: "",
  };

  const dsBenchmark = {
    id: "ab-test-analysis",
    kind: "data-science" as const,
    title: "A/B Test Analysis",
    description: "Analyze the A/B test.",
    prompt: "Analyze the A/B test data from Supabase.",
    sourcePath: "",
  };

  it("returns a visual benchmark prompt as-is", () => {
    const prompt = buildToolPrompt({
      benchmark: visualBenchmark,
      kind: "visual",
    });
    expect(prompt).toBe("Animate a cherry blossom tree.");
  });

  it("returns a data-science benchmark prompt as-is", () => {
    const prompt = buildToolPrompt({
      benchmark: dsBenchmark,
      kind: "data-science",
    });
    expect(prompt).toBe("Analyze the A/B test data from Supabase.");
  });
});

describe("loadBenchmarks", () => {
  it("loads benchmarks from the project benchmarks directory", async () => {
    const benchmarks = await loadBenchmarks(BENCHMARKS);
    expect(benchmarks.length).toBeGreaterThan(0);
    const sakura = benchmarks.find((b) => b.id === "sakura");
    expect(sakura).toBeDefined();
    if (sakura) {
      expect(sakura.title).toBe("Sakura Tree");
      expect(sakura.prompt).toContain("cherry blossom");
    }
  });

  it("loads ab-test-analysis benchmark", async () => {
    const benchmarks = await loadBenchmarks(BENCHMARKS);
    const ab = benchmarks.find((b) => b.id === "ab-test-analysis");
    expect(ab).toBeDefined();
    if (ab) {
      expect(ab.title).toBeTruthy();
      expect(ab.prompt).toContain("Supabase");
    }
  });

  it("discovers exactly five visual benchmarks from frontmatter", async () => {
    const benchmarks = await loadBenchmarks(BENCHMARKS);
    const visualBenchmarks = benchmarks.filter((benchmark) => benchmark.kind === "visual");
    expect(visualBenchmarks.map((benchmark) => benchmark.id).sort()).toEqual([
      "macro-wildflower-meadow",
      "sakura",
      "snow-globe-village",
      "solar-system",
      "sunset-ocean-study"
    ]);
    for (const benchmark of visualBenchmarks) {
      expect(benchmark.prompt).toContain("Create a complete, self-contained HTML file");
      expect(benchmark.prompt).toContain("Write the file as `index.html`");
    }
  });

  it("discovers exactly one data-science benchmark from frontmatter", async () => {
    const benchmarks = await loadBenchmarks(BENCHMARKS);
    const dataScienceBenchmarks = benchmarks.filter(
      (benchmark) => benchmark.kind === "data-science"
    );
    expect(dataScienceBenchmarks.map((benchmark) => benchmark.id)).toEqual([
      "ab-test-analysis"
    ]);
    const [ds] = dataScienceBenchmarks;
    if (ds) {
      expect(ds.prompt).not.toContain("Create a complete, self-contained HTML file");
      expect(ds.prompt).not.toContain("Write the file as `index.html`");
    }
  });
});