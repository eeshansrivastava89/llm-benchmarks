import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRunPaths } from "../../src/lib/paths";
import {
  deleteRunDirectory,
  markRunFailed,
  updateRunMetadata,
  listRunMetadata,
  writePromptMarkdown,
  writeRawResponse,
  writeRunHtml,
  writeRunMetadata
} from "../../src/lib/runs";
import type { RunMetadata } from "../../src/lib/types";

async function createRunsRoot() {
  return mkdtemp(join(tmpdir(), "llm-visual-runs-"));
}

function createMetadata(runDirectory: string): RunMetadata {
  return {
    runId: "2026-05-06T01-02-03-004Z",
    benchmark: {
      id: "sakura",
      title: "Sakura Tree",
      description: "Dreamy cherry blossom animation.",
      prompt: "Animate a cherry blossom tree."
    },
    model: {
      id: "lmstudio-community/Qwen2.5 Coder:7B Instruct",
      slug: "lmstudio-community-qwen2-5-coder-7b-instruct-1234567890"
    },
    status: "prepared",
    createdAt: "2026-05-06T01:02:03.004Z",
    updatedAt: "2026-05-06T01:02:03.004Z",
    runDirectory,
    settings: {
      preview: {
        captureAtMs: 5000,
        viewport: {
          width: 1280,
          height: 720
        },
        video: false
      }
    },
    assets: {
      metadata: "metadata.json",
        prompt: "prompt.md",
        rawResponse: "response.raw.txt",
      html: "index.html",
      preview: "preview.png"
    }
  };
}

describe("run metadata helpers", () => {
  it("creates directories and writes stable pretty JSON metadata", async () => {
    const runsRoot = await createRunsRoot();
    const paths = buildRunPaths({
      runsRoot,
      benchmarkId: "sakura",
      modelId: "lmstudio-community/Qwen2.5 Coder:7B Instruct",
      runId: "2026-05-06T01-02-03-004Z"
    });
    const metadata = createMetadata(paths.runDirectory);

    await writeRunMetadata(paths, metadata);

    const raw = await readFile(paths.metadataPath, "utf8");
    expect(raw).toBe(`${JSON.stringify(metadata, null, 2)}\n`);
    expect(JSON.parse(raw)).toMatchObject({
      model: {
        id: "lmstudio-community/Qwen2.5 Coder:7B Instruct"
      },
      status: "prepared"
    });
  });

  it("updates metadata status without losing existing model identity", async () => {
    const runsRoot = await createRunsRoot();
    const paths = buildRunPaths({
      runsRoot,
      benchmarkId: "sakura",
      modelId: "lmstudio-community/Qwen2.5 Coder:7B Instruct",
      runId: "2026-05-06T01-02-03-004Z"
    });
    const metadata = createMetadata(paths.runDirectory);

    await writeRunMetadata(paths, metadata);
    const updated = await updateRunMetadata(paths, {
      status: "completed",
      updatedAt: "2026-05-06T01:02:05.004Z"
    });

    expect(updated.status).toBe("completed");
    expect(updated.model.id).toBe("lmstudio-community/Qwen2.5 Coder:7B Instruct");
    expect(updated.updatedAt).toBe("2026-05-06T01:02:05.004Z");

    const saved = JSON.parse(await readFile(paths.metadataPath, "utf8"));
    expect(saved).toMatchObject({
      status: "completed",
      model: {
        id: "lmstudio-community/Qwen2.5 Coder:7B Instruct"
      }
    });
  });

  it("writes raw model responses to the run raw response path", async () => {
    const runsRoot = await createRunsRoot();
    const paths = buildRunPaths({
      runsRoot,
      benchmarkId: "sakura",
      modelId: "lmstudio-community/Qwen2.5 Coder:7B Instruct",
      runId: "2026-05-06T01-02-03-004Z"
    });

    await writeRawResponse(paths, "raw response text");

    await expect(readFile(paths.rawResponsePath, "utf8")).resolves.toBe(
      "raw response text"
    );
  });

  it("writes prepared prompts to the run prompt path", async () => {
    const runsRoot = await createRunsRoot();
    const paths = buildRunPaths({
      runsRoot,
      benchmarkId: "sakura",
      modelId: "lmstudio-community/Qwen2.5 Coder:7B Instruct",
      runId: "2026-05-06T01-02-03-004Z"
    });

    await writePromptMarkdown(paths, "copy this prompt");

    await expect(readFile(paths.promptPath, "utf8")).resolves.toBe(
      "copy this prompt"
    );
  });

  it("writes extracted HTML to the run index path", async () => {
    const runsRoot = await createRunsRoot();
    const paths = buildRunPaths({
      runsRoot,
      benchmarkId: "sakura",
      modelId: "lmstudio-community/Qwen2.5 Coder:7B Instruct",
      runId: "2026-05-06T01-02-03-004Z"
    });
    const html = "<!doctype html><html><head></head><body></body></html>";

    await writeRunHtml(paths, html);

    await expect(readFile(paths.htmlPath, "utf8")).resolves.toBe(html);
  });

  it("hydrates prompt text from the run folder prompt file", async () => {
    const runsRoot = await createRunsRoot();
    const paths = buildRunPaths({
      runsRoot,
      benchmarkId: "sakura",
      modelId: "lmstudio-community/Qwen2.5 Coder:7B Instruct",
      runId: "2026-05-06T01-02-03-004Z"
    });
    const metadata = createMetadata(paths.runDirectory);

    await writeRunMetadata(paths, metadata);
    await writePromptMarkdown(paths, "filesystem prompt text");

    const [run] = await listRunMetadata(runsRoot);

    expect(run.promptText).toBe("filesystem prompt text");
  });

  it("ignores traversal asset paths when hydrating saved run metadata", async () => {
    const runsRoot = await createRunsRoot();
    const paths = buildRunPaths({
      runsRoot,
      benchmarkId: "sakura",
      modelId: "lmstudio-community/Qwen2.5 Coder:7B Instruct",
      runId: "2026-05-06T01-02-03-004Z"
    });
    const metadata: RunMetadata = {
      ...createMetadata(paths.runDirectory),
      assets: {
        metadata: "metadata.json",
        prompt: "../private-prompt.md",
        preview: "../private-preview.png"
      }
    };

    await mkdir(paths.runDirectory, { recursive: true });
    await writeFile(join(paths.runDirectory, "metadata.json"), JSON.stringify(metadata), "utf8");
    await writeFile(join(paths.runDirectory, "..", "private-prompt.md"), "do not hydrate this", "utf8");
    await writeFile(join(paths.runDirectory, "..", "private-preview.png"), "png", "utf8");

    const [run] = await listRunMetadata(runsRoot);

    expect(run.promptText).toBeUndefined();
    expect(run.assets.prompt).toBeUndefined();
    expect(run.assets.preview).toBeUndefined();
  });

  it("discovers future kind-based run folders and hydrates runner artifacts", async () => {
    const runsRoot = await createRunsRoot();
    const runDirectory = join(
      runsRoot,
      "visual",
      "sakura",
      "model-a",
      "2026-05-06T01-02-03-004Z"
    );
    const metadata: RunMetadata = {
      ...createMetadata(runDirectory),
      schemaVersion: 2,
      kind: "visual",
      runner: {
        mode: "openai-compatible",
        backendLabel: "llama.cpp",
        baseUrl: "http://127.0.0.1:8080/v1",
        launchCommand: "llama-server -m model.gguf --port 8080",
        requestAsset: "request.json",
        responseAsset: "response.txt",
        commandAsset: "command.txt",
        tokenMetrics: {
          reported: false
        }
      },
      assets: {
        metadata: "metadata.json",
        prompt: "prompt.md",
        request: "request.json",
        response: "response.txt",
        command: "command.txt",
        html: "index.html"
      }
    };
    await mkdir(runDirectory, { recursive: true });
    await writeFile(join(runDirectory, "metadata.json"), JSON.stringify(metadata), "utf8");
    await writeFile(join(runDirectory, "prompt.md"), "prompt", "utf8");
    await writeFile(join(runDirectory, "request.json"), "{}", "utf8");
    await writeFile(join(runDirectory, "response.txt"), "response", "utf8");
    await writeFile(join(runDirectory, "command.txt"), "llama-server", "utf8");
    await writeFile(join(runDirectory, "index.html"), "<!doctype html>", "utf8");

    const [run] = await listRunMetadata(runsRoot);

    expect(run).toMatchObject({
      schemaVersion: 2,
      kind: "visual",
      runner: {
        mode: "openai-compatible",
        backendLabel: "llama.cpp"
      },
      assets: {
        request: "request.json",
        response: "response.txt",
        command: "command.txt",
        html: "index.html"
      },
      promptText: "prompt"
    });
  });

  it("ignores unsupported non-visual run metadata without deleting folders", async () => {
    const runsRoot = await createRunsRoot();
    const visualDirectory = join(runsRoot, "sakura", "model-a", "run-visual");
    const unsupportedDirectory = join(runsRoot, "boolq", "model-a", "run-quant");
    await mkdir(visualDirectory, { recursive: true });
    await mkdir(unsupportedDirectory, { recursive: true });
    await writeFile(
      join(visualDirectory, "metadata.json"),
      JSON.stringify(createMetadata(visualDirectory)),
      "utf8"
    );
    await writeFile(
      join(unsupportedDirectory, "metadata.json"),
      JSON.stringify({
        ...createMetadata(unsupportedDirectory),
        kind: "lighteval",
        assets: {
          metadata: "metadata.json",
          command: "command.txt"
        }
      }),
      "utf8"
    );

    const runs = await listRunMetadata(runsRoot);

    expect(runs.map((run) => run.runDirectory)).toEqual([visualDirectory]);
    await expect(stat(unsupportedDirectory)).resolves.toBeTruthy();
  });

  it("deletes a run directory inside the configured runs root", async () => {
    const runsRoot = await createRunsRoot();
    const runDirectory = join(runsRoot, "sakura", "model-a", "run-1");
    await mkdir(runDirectory, { recursive: true });
    await writeFile(join(runDirectory, "metadata.json"), "{}", "utf8");

    await deleteRunDirectory({ runsRoot, runDirectory });

    await expect(stat(runDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(runsRoot, "sakura"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(runsRoot)).resolves.toBeTruthy();
  });

  it("keeps non-empty parent folders when deleting one run", async () => {
    const runsRoot = await createRunsRoot();
    const runDirectory = join(runsRoot, "sakura", "model-a", "run-1");
    const siblingDirectory = join(runsRoot, "sakura", "model-a", "run-2");
    await mkdir(runDirectory, { recursive: true });
    await mkdir(siblingDirectory, { recursive: true });
    await writeFile(join(runDirectory, "metadata.json"), "{}", "utf8");
    await writeFile(join(siblingDirectory, "metadata.json"), "{}", "utf8");

    await deleteRunDirectory({ runsRoot, runDirectory });

    await expect(stat(runDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(siblingDirectory)).resolves.toBeTruthy();
    await expect(stat(join(runsRoot, "sakura", "model-a"))).resolves.toBeTruthy();
  });

  it("rejects deleting outside the configured runs root", async () => {
    const runsRoot = await createRunsRoot();
    const outsideRoot = await createRunsRoot();
    const runDirectory = join(outsideRoot, "sakura", "model-a", "run-1");
    await mkdir(runDirectory, { recursive: true });

    await expect(deleteRunDirectory({ runsRoot, runDirectory })).rejects.toThrow(
      /outside the configured runs folder/
    );
  });

  it("marks failed metadata with error details while preserving model identity", async () => {
    const runsRoot = await createRunsRoot();
    const paths = buildRunPaths({
      runsRoot,
      benchmarkId: "sakura",
      modelId: "lmstudio-community/Qwen2.5 Coder:7B Instruct",
      runId: "2026-05-06T01-02-03-004Z"
    });
    const metadata = createMetadata(paths.runDirectory);

    await writeRunMetadata(paths, metadata);
    const updated = await markRunFailed(
      paths,
      new Error("HTML extraction failed"),
      new Date("2026-05-06T01:02:05.004Z")
    );

    expect(updated).toMatchObject({
      status: "failed",
      updatedAt: "2026-05-06T01:02:05.004Z",
      failedAt: "2026-05-06T01:02:05.004Z",
      model: {
        id: "lmstudio-community/Qwen2.5 Coder:7B Instruct"
      },
      error: {
        message: "HTML extraction failed"
      }
    });
  });
});

function createDsMetadata(runDirectory: string): RunMetadata {
  return {
    kind: "data-science",
    runId: "2026-05-26T01-02-03-004Z",
    benchmark: {
      id: "ab-test-analysis",
      title: "A/B Test Production Analysis",
      description: "Run a production A/B test analysis.",
      prompt: "Analyze the A/B test data."
    },
    model: {
      id: "qwen3-30b-a3b",
      slug: "qwen3-30b-a3b"
    },
    status: "prepared",
    createdAt: "2026-05-26T01:02:03.004Z",
    updatedAt: "2026-05-26T01:02:03.004Z",
    runDirectory,
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
  };
}

describe("data-science run kind", () => {
  it("discovers data-science runs alongside visual runs", async () => {
    const runsRoot = await createRunsRoot();
    const visualPaths = buildRunPaths({
      runsRoot,
      benchmarkId: "sakura",
      modelId: "qwen-coder",
      runId: "2026-05-06T01-02-03-004Z"
    });
    const dsPaths = buildRunPaths({
      runsRoot,
      benchmarkId: "ab-test-analysis",
      modelId: "qwen3-30b-a3b",
      runId: "2026-05-26T01-02-03-004Z"
    });

    await writeRunMetadata(visualPaths, createMetadata(visualPaths.runDirectory));
    await writeRunMetadata(dsPaths, createDsMetadata(dsPaths.runDirectory));

    const runs = await listRunMetadata(runsRoot);
    const kinds = runs.map((r) => r.kind ?? "visual");
    expect(kinds).toContain("visual");
    expect(kinds).toContain("data-science");
  });

  it("hydrates data-science asset availability from run folder", async () => {
    const runsRoot = await createRunsRoot();
    const paths = buildRunPaths({
      runsRoot,
      benchmarkId: "ab-test-analysis",
      modelId: "qwen3-30b-a3b",
      runId: "2026-05-26T01-02-03-004Z"
    });
    const metadata = createDsMetadata(paths.runDirectory);

    await writeRunMetadata(paths, metadata);
    await writeFile(join(paths.runDirectory, "summary.json"), JSON.stringify({ status: "significant" }));

    const runs = await listRunMetadata(runsRoot);
    const ds = runs.find((r) => r.kind === "data-science");
    expect(ds).toBeDefined();
    expect(ds?.assets?.ds?.summary).toBe("summary.json");
    // chart files don't exist yet, so they should not be hydrated
    expect(ds?.assets?.ds?.chartDistribution).toBeUndefined();
  });

  it("hydrates dsSummary from summary.json in data-science runs", async () => {
    const runsRoot = await createRunsRoot();
    const paths = buildRunPaths({
      runsRoot,
      benchmarkId: "ab-test-analysis",
      modelId: "qwen3-30b-a3b",
      runId: "2026-05-26T01-02-03-004Z"
    });
    const metadata = createDsMetadata(paths.runDirectory);

    await writeRunMetadata(paths, metadata);
    await writeFile(
      join(paths.runDirectory, "summary.json"),
      JSON.stringify({
        status: "significant",
        recommended_variant: "A",
        decision: "Variant B has significant guardrail drops; ship A.",
        metrics: [
          { label: "Completion Time", value: "+3.2s", delta: "+55.5%", delta_direction: "up", context: "p=0.001" },
          { label: "Effect Size", value: "d=0.40", context: "small" }
        ],
        warnings: ["Significant drop in completion rate"]
      })
    );

    const runs = await listRunMetadata(runsRoot);
    const ds = runs.find((r) => r.kind === "data-science");
    expect(ds?.dsSummary).toMatchObject({
      status: "significant",
      recommended_variant: "A",
      decision: "Variant B has significant guardrail drops; ship A.",
      metrics: [
        { label: "Completion Time", value: "+3.2s", delta_direction: "up" },
        { label: "Effect Size", value: "d=0.40" }
      ],
      warnings: ["Significant drop in completion rate"]
    });
  });

  it("hydrates dsScorecard from scorecard.json", async () => {
    const runsRoot = await createRunsRoot();
    const paths = buildRunPaths({
      runsRoot,
      benchmarkId: "ab-test-analysis",
      modelId: "qwen3-30b-a3b",
      runId: "2026-05-26T01-02-03-004Z"
    });
    const metadata: RunMetadata = {
      ...createDsMetadata(paths.runDirectory),
      assets: {
        ...createDsMetadata(paths.runDirectory).assets,
        ds: {
          ...createDsMetadata(paths.runDirectory).assets.ds!,
          scorecard: "scorecard.json"
        }
      }
    };

    await writeRunMetadata(paths, metadata);
    await writeFile(
      join(paths.runDirectory, "scorecard.json"),
      JSON.stringify({
        total: 100,
        earned: 85,
        pct: 85.0,
        checks: {
          summary_exists: { label: "summary.json exists and parses", max: 5, earned: 5, pass: true, detail: "ok" },
          recommended_variant: { label: "recommended_variant matches oracle", max: 15, earned: 0, pass: false, detail: "got B, expected A" }
        }
      })
    );

    const runs = await listRunMetadata(runsRoot);
    const ds = runs.find((r) => r.kind === "data-science");
    expect(ds?.dsScorecard).toMatchObject({
      total: 100,
      earned: 85,
      pct: 85.0
    });
    expect(ds?.dsScorecard?.checks?.recommended_variant.pass).toBe(false);
  });
});
