import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRunPaths, createRunId, slugModelId } from "../../src/lib/paths";

describe("slugModelId", () => {
  it("creates deterministic lowercase filesystem-safe model slugs", () => {
    expect(slugModelId("lmstudio-community/Qwen2.5 Coder:7B Instruct")).toMatch(
      /^lmstudio-community-qwen2-5-coder-7b-instruct-[a-f0-9]{10}$/
    );
    expect(slugModelId("lmstudio-community/Qwen2.5 Coder:7B Instruct")).toBe(
      slugModelId("lmstudio-community/Qwen2.5 Coder:7B Instruct")
    );
  });

  it("handles empty and long awkward model IDs", () => {
    expect(slugModelId("::: ///   ")).toMatch(/^model-[a-f0-9]{10}$/);

    const longId = `Vendor/${"Very Long Model Name ".repeat(12)}:latest`;
    const slug = slugModelId(longId);

    expect(slug).toMatch(/^[a-z0-9-]+-[a-f0-9]{10}$/);
    expect(slug.length).toBeLessThanOrEqual(80);
  });
});

describe("createRunId", () => {
  it("creates sortable filesystem-safe timestamp run IDs from injected dates", () => {
    const earlier = createRunId(new Date("2026-05-06T01:02:03.004Z"));
    const later = createRunId(new Date("2026-05-06T01:02:04.004Z"));

    expect(earlier).toBe("2026-05-06T01-02-03-004Z");
    expect(later).toBe("2026-05-06T01-02-04-004Z");
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });
});

describe("buildRunPaths", () => {
  it("constructs run folder paths under benchmark, model slug, and run ID", () => {
    const paths = buildRunPaths({
      runsRoot: "/tmp/local-visual-runs",
      benchmarkId: "sakura",
      modelId: "lmstudio-community/Qwen2.5 Coder:7B Instruct",
      runId: "2026-05-06T01-02-03-004Z"
    });

    expect(paths.modelSlug).toMatch(
      /^lmstudio-community-qwen2-5-coder-7b-instruct-[a-f0-9]{10}$/
    );
    expect(paths.runDirectory).toBe(
      join(
        "/tmp/local-visual-runs",
        "sakura",
        paths.modelSlug,
        "2026-05-06T01-02-03-004Z"
      )
    );
    expect(paths.metadataPath).toBe(join(paths.runDirectory, "metadata.json"));
    expect(paths.promptPath).toBe(join(paths.runDirectory, "prompt.md"));
    expect(paths.rawResponsePath).toBe(join(paths.runDirectory, "response.raw.txt"));
    expect(paths.requestPath).toBe(join(paths.runDirectory, "request.json"));
    expect(paths.streamPath).toBe(join(paths.runDirectory, "stream.ndjson"));
    expect(paths.responsePath).toBe(join(paths.runDirectory, "response.txt"));
    expect(paths.commandPath).toBe(join(paths.runDirectory, "command.txt"));
    expect(paths.htmlPath).toBe(join(paths.runDirectory, "index.html"));
    expect(paths.previewPath).toBe(join(paths.runDirectory, "preview.png"));
  });

  it("rejects path-like benchmark IDs before constructing run folders", () => {
    expect(() =>
      buildRunPaths({
        runsRoot: "/tmp/local-visual-runs",
        benchmarkId: "../outside",
        modelId: "model-a",
        runId: "2026-05-06T01-02-03-004Z"
      })
    ).toThrow(/Benchmark ID must be a filesystem-safe slug/);
  });

  it("rejects path-like run IDs before constructing run folders", () => {
    expect(() =>
      buildRunPaths({
        runsRoot: "/tmp/local-visual-runs",
        benchmarkId: "sakura",
        modelId: "model-a",
        runId: "../run-1"
      })
    ).toThrow(/Run ID must be filesystem-safe/);
  });
});
