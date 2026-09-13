import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateStaticExport } from "../../src/lib/export";
import type { RunMetadata } from "../../src/lib/types";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const execFileAsync = promisify(execFile);

async function createTempRoot(prefix: string) {
  return mkdtemp(join(tmpdir(), prefix));
}

async function writeBenchmark(directory: string) {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "sakura.md"),
    `---
id: sakura
title: Sakura Particle Field
description: Animated sakura scene.
---

Create a sakura animation with layered petals.
`,
    "utf8"
  );
}

async function writeRun(runsRoot: string) {
  const runDirectory = join(
    runsRoot,
    "sakura",
    "local-qwen2-5-vl",
    "2026-05-06T19-12-00-000Z"
  );
  await mkdir(runDirectory, { recursive: true });
  const metadata: RunMetadata = {
    runId: "2026-05-06T19-12-00-000Z",
    benchmark: {
      id: "sakura",
      title: "Sakura Particle Field",
      description: "Animated sakura scene.",
      prompt: "Create a sakura animation with layered petals."
    },
    model: {
      id: "local/qwen2.5-vl",
      slug: "local-qwen2-5-vl"
    },
    status: "completed",
    createdAt: "2026-05-06T19:12:00.000Z",
    updatedAt: "2026-05-06T19:13:00.000Z",
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
      preview: "preview.png",
      video: "preview.webm",
      videoMp4: "preview.mp4"
    },
    capture: {
      preview: {
        status: "ready",
        path: "preview.png",
        capturedAt: "2026-05-06T19:13:00.000Z"
      }
    },
    runner: {
      mode: "manual",
      modelSource: "llama-cpp",
      intendedRunner: "manual",
      backendLabel: "LM Studio",
      baseUrl: "http://localhost:1234/v1",
      model: "local/qwen2.5-vl",
      launchCommand: "llama-server --model /Users/test/model.gguf",
      commandAsset: "command.txt",
      requestAsset: "request.json",
      streamAsset: "stream.ndjson",
      responseAsset: "response.txt",
      retries: 0,
      tokenMetrics: {
        reported: false
      }
    }
  };

  await writeFile(join(runDirectory, "metadata.json"), JSON.stringify(metadata), "utf8");
  await writeFile(join(runDirectory, "prompt.md"), "prepared prompt", "utf8");
  await writeFile(join(runDirectory, "response.raw.txt"), "raw response", "utf8");
  await writeFile(join(runDirectory, "index.html"), "<!doctype html><html></html>", "utf8");
  await writeFile(join(runDirectory, "preview.png"), "png bytes", "utf8");
  await writeFile(join(runDirectory, "preview.webm"), "webm bytes", "utf8");
  await writeFile(join(runDirectory, "preview.mp4"), "mp4 bytes", "utf8");
  return { runDirectory, metadata };
}

describe("generateStaticExport", () => {
  it("writes a manifest from benchmarks and saved runs with copied static assets", async () => {
    const root = await createTempRoot("llm-visual-export-");
    const benchmarkDirectory = join(root, "benchmarks");
    const runsRoot = join(root, "runs");
    const publicExportDirectory = join(root, "public", "export");
    await writeBenchmark(benchmarkDirectory);
    await writeRun(runsRoot);

    const manifest = await generateStaticExport({
      benchmarkDirectory,
      runsRoot,
      publicExportDirectory,
      generatedAt: new Date("2026-05-06T20:00:00.000Z")
    });

    expect(manifest).toMatchObject({
      version: 1,
      generatedAt: "2026-05-06T20:00:00.000Z",
      benchmarks: [
        {
          id: "sakura",
          title: "Sakura Particle Field",
          description: "Animated sakura scene.",
          prompt: "Create a sakura animation with layered petals."
        }
      ],
      runs: [
        {
          runId: "2026-05-06T19-12-00-000Z",
          runDirectory:
            "export/runs/sakura/local-qwen2-5-vl/2026-05-06T19-12-00-000Z",
          assets: {
            metadata: "metadata.json",
            preview: "preview.png",
            videoMp4: "preview.mp4"
          }
        }
      ]
    });

    const rawManifest = await readFile(
      join(publicExportDirectory, "manifest.json"),
      "utf8"
    );
    expect(JSON.parse(rawManifest)).toEqual(manifest);
    const exportedRunDirectory = join(
      publicExportDirectory,
      "runs",
      "sakura",
      "local-qwen2-5-vl",
      "2026-05-06T19-12-00-000Z"
    );
    await expect(readFile(join(exportedRunDirectory, "preview.png"), "utf8"))
      .resolves.toBe("png bytes");
    await expect(readFile(join(exportedRunDirectory, "preview.mp4"), "utf8"))
      .resolves.toBe("mp4 bytes");
    await expect(stat(join(exportedRunDirectory, "preview.webm")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(exportedRunDirectory, "index.html")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(exportedRunDirectory, "response.raw.txt")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(exportedRunDirectory, "prompt.md")))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.stringify(manifest)).not.toContain("preview.webm");
    expect(JSON.stringify(manifest)).not.toContain("localhost");
    expect(JSON.stringify(manifest)).not.toContain("llama-server");
    expect(JSON.stringify(manifest)).not.toContain("/Users/test");
    expect(JSON.stringify(manifest)).not.toContain("promptText");
    expect(manifest.runs[0].runner).toEqual({
      mode: "manual",
      modelSource: "llama-cpp",
      intendedRunner: "manual",
      backendLabel: "LM Studio",
      model: "local/qwen2.5-vl",
      retries: 0
    });
  });

  it("keeps source benchmark prompts but omits per-run prepared prompts from public export", async () => {
    const root = await createTempRoot("llm-visual-export-sanitize-");
    const benchmarkDirectory = join(root, "benchmarks");
    const runsRoot = join(root, "runs");
    const publicExportDirectory = join(root, "public", "export");
    await writeBenchmark(benchmarkDirectory);
    const { runDirectory } = await writeRun(runsRoot);

    await writeFile(
      join(runDirectory, "prompt.md"),
      [
        `Run folder: ${runDirectory}`,
        `Save to: ${join(runDirectory, "index.html")}`,
        `Preview: ${join(runDirectory, "preview.png")}`
      ].join("\n"),
      "utf8"
    );

    const manifest = await generateStaticExport({
      benchmarkDirectory,
      runsRoot,
      publicExportDirectory,
      generatedAt: new Date("2026-05-06T20:00:00.000Z")
    });
    const [run] = manifest.runs;

    expect(manifest.benchmarks[0].prompt).toBe("Create a sakura animation with layered petals.");
    expect(run.promptText).toBeUndefined();
    expect(run.assets.prompt).toBeUndefined();
    await expect(
      stat(
        join(
          publicExportDirectory,
          "runs",
          "sakura",
          "local-qwen2-5-vl",
          "2026-05-06T19-12-00-000Z",
          "prompt.md"
        )
      )
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.stringify(manifest)).not.toContain(runDirectory);
  });

  it("omits traversal asset names while exporting run assets", async () => {
    const root = await createTempRoot("llm-visual-export-traversal-");
    const benchmarkDirectory = join(root, "benchmarks");
    const runsRoot = join(root, "runs");
    const publicExportDirectory = join(root, "public", "export");
    await writeBenchmark(benchmarkDirectory);
    const { runDirectory, metadata } = await writeRun(runsRoot);
    const maliciousMetadata: RunMetadata = {
      ...metadata,
      assets: {
        ...metadata.assets,
        preview: "../leaked.png"
      }
    };
    await writeFile(join(runDirectory, "metadata.json"), JSON.stringify(maliciousMetadata), "utf8");
    await writeFile(join(runDirectory, "..", "leaked.png"), "leaked", "utf8");

    const manifest = await generateStaticExport({
      benchmarkDirectory,
      runsRoot,
      publicExportDirectory
    });

    expect(manifest.runs[0].assets.preview).toBeUndefined();
    await expect(stat(join(publicExportDirectory, "runs", "sakura", "local-qwen2-5-vl", "leaked.png")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects traversal path segments in exported run identifiers", async () => {
    const root = await createTempRoot("llm-visual-export-id-traversal-");
    const benchmarkDirectory = join(root, "benchmarks");
    const runsRoot = join(root, "runs");
    const publicExportDirectory = join(root, "public", "export");
    await writeBenchmark(benchmarkDirectory);
    const { runDirectory, metadata } = await writeRun(runsRoot);
    const maliciousMetadata: RunMetadata = {
      ...metadata,
      model: {
        ...metadata.model,
        slug: "../../outside"
      }
    };
    await writeFile(join(runDirectory, "metadata.json"), JSON.stringify(maliciousMetadata), "utf8");

    await expect(
      generateStaticExport({
        benchmarkDirectory,
        runsRoot,
        publicExportDirectory
      })
    ).rejects.toThrow(/Export path segment must be a safe filename segment/);
    await expect(stat(join(publicExportDirectory, "..", "outside")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("redacts local paths from public runner and capture metadata", async () => {
    const root = await createTempRoot("llm-visual-export-redact-");
    const benchmarkDirectory = join(root, "benchmarks");
    const runsRoot = join(root, "runs");
    const publicExportDirectory = join(root, "public", "export");
    await writeBenchmark(benchmarkDirectory);
    const { runDirectory, metadata } = await writeRun(runsRoot);
    const localPath = join(root, "models", "private-model.gguf");
    const localErrorPath = join(runDirectory, "index.html");
    const metadataWithLocalStrings: RunMetadata = {
      ...metadata,
      runner: {
        ...metadata.runner!,
        model: localPath
      },
      capture: {
        video: {
          status: "failed",
          error: {
            message: `Failed to open file://${localErrorPath}`
          }
        }
      }
    };
    await writeFile(join(runDirectory, "metadata.json"), JSON.stringify(metadataWithLocalStrings), "utf8");

    const manifest = await generateStaticExport({
      benchmarkDirectory,
      runsRoot,
      publicExportDirectory
    });
    const serialized = JSON.stringify(manifest);

    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain(runDirectory);
    expect(serialized).not.toContain("file://");
    expect(manifest.runs[0].runner?.model).toBeUndefined();
    expect(manifest.runs[0].capture?.video?.error?.message).toBe("Capture failed. See local run evidence for details.");
  });

  it("handles an empty saved runs directory", async () => {
    const root = await createTempRoot("llm-visual-export-empty-");
    const benchmarkDirectory = join(root, "benchmarks");
    const publicExportDirectory = join(root, "public", "export");
    await writeBenchmark(benchmarkDirectory);

    const manifest = await generateStaticExport({
      benchmarkDirectory,
      runsRoot: join(root, "missing-runs"),
      publicExportDirectory,
      generatedAt: new Date("2026-05-06T20:00:00.000Z")
    });

    expect(manifest.runs).toEqual([]);
    await expect(stat(join(publicExportDirectory, "manifest.json"))).resolves.toBeTruthy();
  });

  it("exports data-science runs with chart and summary assets", async () => {
    const root = await createTempRoot("llm-visual-export-ds-");
    const benchmarkDirectory = join(root, "benchmarks");
    const runsRoot = join(root, "runs");
    const publicExportDirectory = join(root, "public", "export");
    await writeBenchmark(benchmarkDirectory);

    const dsRunDir = join(runsRoot, "ab-test-analysis", "qwen3-30b", "2026-05-26T01-02-03-004Z");
    await mkdir(dsRunDir, { recursive: true });
    const dsMetadata: RunMetadata = {
      kind: "data-science",
      runId: "2026-05-26T01-02-03-004Z",
      benchmark: { id: "ab-test-analysis", title: "A/B Test", description: "Analysis", prompt: "Analyze." },
      model: { id: "qwen3-30b", slug: "qwen3-30b" },
      status: "completed",
      createdAt: "2026-05-26T01:02:03.004Z",
      updatedAt: "2026-05-26T01:02:03.004Z",
      runDirectory: dsRunDir,
      assets: {
        metadata: "metadata.json",
        ds: {
          summary: "summary.json",
          chartTreatmentEffect: "chart-treatment-effect.png"
        }
      }
    };
    await writeFile(join(dsRunDir, "metadata.json"), JSON.stringify(dsMetadata), "utf8");
    await writeFile(join(dsRunDir, "summary.json"), JSON.stringify({ status: "significant" }), "utf8");
    await writeFile(join(dsRunDir, "chart-treatment-effect.png"), "png bytes", "utf8");

    const manifest = await generateStaticExport({
      benchmarkDirectory,
      runsRoot,
      publicExportDirectory,
      generatedAt: new Date("2026-05-26T20:00:00.000Z")
    });

    const dsRun = manifest.runs.find((r) => r.kind === "data-science");
    expect(dsRun).toBeDefined();
    expect(dsRun?.kind).toBe("data-science");
    expect(dsRun?.assets?.ds?.summary).toBe("summary.json");
    expect(dsRun?.assets?.ds?.chartTreatmentEffect).toBe("chart-treatment-effect.png");
    expect(dsRun?.assets?.preview).toBeUndefined();
    expect(dsRun?.assets?.videoMp4).toBeUndefined();

    const exportedDir = join(publicExportDirectory, "runs", "ab-test-analysis", "qwen3-30b", "2026-05-26T01-02-03-004Z");
    await expect(readFile(join(exportedDir, "summary.json"), "utf8")).resolves.toBe(JSON.stringify({ status: "significant" }));
    await expect(readFile(join(exportedDir, "chart-treatment-effect.png"), "utf8")).resolves.toBe("png bytes");
  });
});

describe("static build script", () => {
  it("simulates exported runs and produces a dist-static output", async () => {
    const root = await createTempRoot("llm-visual-static-build-");
    const benchmarkDirectory = join(root, "benchmarks");
    const runsRoot = join(root, "runs");
    const publicExportDirectory = join(root, "public-export");
    const staticOutputDirectory = join(root, "dist-static");
    await writeBenchmark(benchmarkDirectory);
    await writeRun(runsRoot);

    await execFileAsync("node", ["scripts/build-static.mjs"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        STATIC_BENCHMARK_DIR: benchmarkDirectory,
        STATIC_RUNS_ROOT: runsRoot,
        STATIC_EXPORT_DIR: publicExportDirectory,
        STATIC_OUTPUT_DIR: staticOutputDirectory
      }
    });

    await expect(stat(join(staticOutputDirectory, "index.html"))).resolves.toBeTruthy();
    await expect(stat(join(staticOutputDirectory, "prompt", "sakura", "index.html")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(staticOutputDirectory, "model", "local-qwen2-5-vl", "index.html")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(staticOutputDirectory, "export", "manifest.json"), "utf8")
    ).resolves.toContain("2026-05-06T19-12-00-000Z");
    await expect(
      readFile(join(staticOutputDirectory, "index.html"), "utf8")
    ).resolves.toContain("a side quest by eeshans.com");
    await expect(
      readFile(join(staticOutputDirectory, "index.html"), "utf8")
    ).resolves.toContain('data-static-build="true"');
    await expect(
      readFile(join(staticOutputDirectory, "index.html"), "utf8")
    ).resolves.not.toContain("Daily-driver stack evidence");
  });

  it("can build from an existing committed export without reading local runs", async () => {
    const root = await createTempRoot("llm-visual-static-existing-export-");
    const benchmarkDirectory = join(root, "benchmarks");
    const runsRoot = join(root, "runs");
    const publicExportDirectory = join(root, "public-export");
    const staticOutputDirectory = join(root, "dist-static");
    await writeBenchmark(benchmarkDirectory);
    await writeRun(runsRoot);
    await generateStaticExport({
      benchmarkDirectory,
      runsRoot,
      publicExportDirectory,
      generatedAt: new Date("2026-05-06T20:00:00.000Z")
    });

    await execFileAsync("node", ["scripts/build-static.mjs"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        STATIC_USE_EXISTING_EXPORT: "true",
        STATIC_BENCHMARK_DIR: join(root, "missing-benchmarks"),
        STATIC_RUNS_ROOT: join(root, "missing-runs"),
        STATIC_EXPORT_DIR: publicExportDirectory,
        STATIC_OUTPUT_DIR: staticOutputDirectory
      }
    });

    await expect(
      readFile(join(staticOutputDirectory, "export", "manifest.json"), "utf8")
    ).resolves.toContain("2026-05-06T20:00:00.000Z");
    await expect(
      readFile(join(staticOutputDirectory, "export", "manifest.json"), "utf8")
    ).resolves.toContain("2026-05-06T19-12-00-000Z");
  });
});
