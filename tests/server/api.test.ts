import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assertTrustedWriteRequest, createLocalApi } from "../../src/server/api";
import type { BenchmarkRecord, RunMetadata } from "../../src/lib/types";

const benchmarks: BenchmarkRecord[] = [
  {
    id: "sakura",
    title: "Sakura",
    description: "Cherry blossom animation.",
    prompt: "Draw sakura."
  },
  {
    id: "solar-system",
    title: "Solar System",
    description: "Orbital animation.",
    prompt: "Draw planets."
  }
];



describe("createLocalApi", () => {
  it("loads benchmark definitions through the benchmark loader", async () => {
    const loadBenchmarks = vi.fn(async () => benchmarks);
    const api = createLocalApi({
      benchmarkDirectory: "/benchmarks",
      loadBenchmarks
    });

    await expect(api.getBenchmarks()).resolves.toEqual({
      benchmarks
    });
    expect(loadBenchmarks).toHaveBeenCalledWith("/benchmarks");
  });

  it("returns an empty saved run list when the runs directory is missing", async () => {
    const api = createLocalApi({
      runsRoot: join(tmpdir(), "missing-local-visual-runs")
    });

    await expect(api.getSavedRuns()).resolves.toEqual({
      runs: []
    });
  });

  it("lists saved run metadata newest first", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "local-visual-runs-"));
    const older = join(runsRoot, "sakura", "model-a", "run-old");
    const newer = join(runsRoot, "sakura", "model-b", "run-new");
    await mkdir(older, { recursive: true });
    await mkdir(newer, { recursive: true });
    await writeFile(
      join(older, "metadata.json"),
      JSON.stringify({
        runId: "run-old",
        createdAt: "2026-05-06T01:00:00.000Z",
        updatedAt: "2026-05-06T01:00:00.000Z",
        status: "completed"
      })
    );
    await writeFile(
      join(newer, "metadata.json"),
      JSON.stringify({
        runId: "run-new",
        createdAt: "2026-05-06T02:00:00.000Z",
        updatedAt: "2026-05-06T02:00:00.000Z",
        status: "failed"
      })
    );
    const api = createLocalApi({ runsRoot });

    const response = await api.getSavedRuns();

    expect(response.runs.map((run) => run.runId)).toEqual(["run-new", "run-old"]);
  });

  it("captures missing run media through the configured dependency", async () => {
    const runs: RunMetadata[] = [];
    const captureMissingRunMedia = vi.fn(async () => ({
      captured: 2,
      skipped: 1,
      failed: 0,
      runs
    }));
    const api = createLocalApi({
      runsRoot: "/runs",
      captureMissingRunMedia
    });

    await expect(api.captureMissingMedia({})).resolves.toEqual({
      captured: 2,
      skipped: 1,
      failed: 0,
      runs
    });
    expect(captureMissingRunMedia).toHaveBeenCalledWith({ runsRoot: "/runs" });
  });

  it("captures one requested run when a run directory is provided", async () => {
    const runs: RunMetadata[] = [];
    const captureSingleRunMedia = vi.fn(async () => ({
      captured: 1,
      skipped: 0,
      failed: 0,
      runs
    }));
    const api = createLocalApi({
      runsRoot: "/runs",
      captureSingleRunMedia
    });

    await expect(
      api.captureMissingMedia({ runDirectory: "/runs/sakura/model-a/run-1" })
    ).resolves.toEqual({
      captured: 1,
      skipped: 0,
      failed: 0,
      runs
    });
    expect(captureSingleRunMedia).toHaveBeenCalledWith({
      runsRoot: "/runs",
      runDirectory: "/runs/sakura/model-a/run-1",
      force: false
    });
  });

  it("forwards forced recapture only for one requested run", async () => {
    const runs: RunMetadata[] = [];
    const captureSingleRunMedia = vi.fn(async () => ({
      captured: 1,
      skipped: 0,
      failed: 0,
      runs
    }));
    const captureMissingRunMedia = vi.fn();
    const api = createLocalApi({
      runsRoot: "/runs",
      captureSingleRunMedia,
      captureMissingRunMedia
    });

    await expect(
      api.captureMissingMedia({
        runDirectory: "/runs/sakura/model-a/run-1",
        force: true
      })
    ).resolves.toMatchObject({
      captured: 1,
      skipped: 0,
      failed: 0
    });
    expect(captureSingleRunMedia).toHaveBeenCalledWith({
      runsRoot: "/runs",
      runDirectory: "/runs/sakura/model-a/run-1",
      force: true
    });
    expect(captureMissingRunMedia).not.toHaveBeenCalled();
  });

  it("rejects forced bulk capture", async () => {
    const api = createLocalApi();

    await expect(api.captureMissingMedia({ force: true })).rejects.toThrow(
      /force recapture requires a runDirectory/
    );
  });

  it("exports selected run videos through the comparison video dependency", async () => {
    const exportComparisonVideo = vi.fn(async () => ({
      path: "/exports/sakura/comparison.mp4",
      runCount: 2,
      layout: "2x2"
    }));
    const api = createLocalApi({
      runsRoot: "/runs",
      exportComparisonVideo
    });

    await expect(
      api.exportComparisonVideo({
        runDirectories: ["/runs/sakura/model-a/run-1", "/runs/sakura/model-b/run-2"]
      })
    ).resolves.toEqual({
      path: "/exports/sakura/comparison.mp4",
      runCount: 2,
      layout: "2x2"
    });
    expect(exportComparisonVideo).toHaveBeenCalledWith({
      runsRoot: "/runs",
      runDirectories: ["/runs/sakura/model-a/run-1", "/runs/sakura/model-b/run-2"]
    });
  });

  it("rejects comparison video export when writes are disabled", async () => {
    const api = createLocalApi({ enableWrites: false });

    await expect(
      api.exportComparisonVideo({ runDirectories: ["/runs/a", "/runs/b"] })
    ).rejects.toThrow(/Write actions are only available in dev server mode/);
  });

  it("rejects capture when writes are disabled", async () => {
    const api = createLocalApi({ enableWrites: false });

    await expect(api.captureMissingMedia({})).rejects.toThrow(
      /Write actions are only available in dev server mode/
    );
  });

  it("deletes a saved run folder from the configured runs root", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "local-visual-runs-delete-"));
    const runDirectory = join(runsRoot, "sakura", "model-a", "run-1");
    await mkdir(runDirectory, { recursive: true });
    await writeFile(join(runDirectory, "metadata.json"), "{}", "utf8");
    const api = createLocalApi({ runsRoot });

    await expect(api.deleteSavedRun({ runDirectory })).resolves.toEqual({
      deleted: true,
      runDirectory
    });
    await expect(stat(runDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("updates editable saved run metadata inside the configured runs root", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "local-visual-runs-update-"));
    const runDirectory = join(runsRoot, "sakura", "model-a", "run-1");
    await mkdir(runDirectory, { recursive: true });
    await writeFile(
      join(runDirectory, "metadata.json"),
      JSON.stringify({
        runId: "run-1",
        benchmark: benchmarks[0],
        model: { id: "model-a", slug: "model-a" },
        status: "completed",
        createdAt: "2026-05-06T01:00:00.000Z",
        updatedAt: "2026-05-06T01:00:00.000Z",
        runDirectory,
        assets: { metadata: "metadata.json" },
        runner: {
          mode: "manual",
          intendedRunner: "manual"
        }
      }),
      "utf8"
    );
    const api = createLocalApi({ runsRoot });

    const response = await api.updateSavedRunMetadata({
      runDirectory,
      backend: "omlx",
      harness: "pi"
    });

    expect(response.run.runner).toMatchObject({
      mode: "external",
      modelSource: "omlx",
      backendLabel: "oMLX",
      intendedRunner: "Pi"
    });
    expect(response.run.updatedAt).not.toBe("2026-05-06T01:00:00.000Z");
    await expect(readFile(join(runDirectory, "metadata.json"), "utf8"))
      .resolves.toContain('"backendLabel": "oMLX"');
  });

  it("updates custom backend and model labels in saved run metadata", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "local-visual-runs-custom-update-"));
    const runDirectory = join(runsRoot, "sakura", "model-a", "run-1");
    await mkdir(runDirectory, { recursive: true });
    await writeFile(
      join(runDirectory, "metadata.json"),
      JSON.stringify({
        runId: "run-1",
        benchmark: benchmarks[0],
        model: { id: "model-a", slug: "model-a" },
        status: "completed",
        createdAt: "2026-05-06T01:00:00.000Z",
        updatedAt: "2026-05-06T01:00:00.000Z",
        runDirectory,
        assets: { metadata: "metadata.json" },
        runner: {
          mode: "manual",
          intendedRunner: "manual",
          model: "model-a"
        }
      }),
      "utf8"
    );
    const api = createLocalApi({ runsRoot });

    const response = await api.updateSavedRunMetadata({
      runDirectory,
      backend: "custom",
      customBackend: "Cloud",
      harness: "manual",
      modelId: "ChatGPT"
    });

    expect(response.run.model).toMatchObject({ id: "ChatGPT", slug: "model-a" });
    expect(response.run.runner).toMatchObject({
      mode: "manual",
      modelSource: "cloud",
      backendLabel: "Cloud",
      intendedRunner: "manual",
      model: "ChatGPT"
    });
  });

  it("rejects updating saved run metadata when writes are disabled", async () => {
    const api = createLocalApi({ enableWrites: false });

    await expect(
      api.updateSavedRunMetadata({
        runDirectory: "/runs/sakura/model-a/run-1",
        backend: "omlx",
        harness: "pi"
      })
    ).rejects.toThrow(/Write actions are only available in dev server mode/);
  });

  it("rejects deleting saved runs when writes are disabled", async () => {
    const api = createLocalApi({ enableWrites: false });

    await expect(
      api.deleteSavedRun({ runDirectory: "/runs/sakura/model-a/run-1" })
    ).rejects.toThrow(/Write actions are only available in dev server mode/);
  });

  it("opens generated HTML from an absolute run path", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "local-visual-runs-open-"));
    const runDirectory = join(runsRoot, "sakura", "model-a", "run-1");
    const htmlPath = join(runDirectory, "index.html");
    const openFile = vi.fn(async () => {});
    await mkdir(runDirectory, { recursive: true });
    await writeFile(htmlPath, "<!doctype html>", "utf8");
    const api = createLocalApi({ runsRoot, openFile });

    await expect(
      api.openRunHtml({ runDirectory, asset: "index.html" })
    ).resolves.toEqual({
      opened: true,
      path: htmlPath
    });
    expect(openFile).toHaveBeenCalledWith(htmlPath);
  });

  it("opens a run folder from an absolute run path", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "local-visual-runs-open-folder-"));
    const runDirectory = join(runsRoot, "sakura", "model-a", "run-1");
    const openFile = vi.fn(async () => {});
    await mkdir(runDirectory, { recursive: true });
    const api = createLocalApi({ runsRoot, openFile });

    await expect(api.openRunFolder({ runDirectory })).resolves.toEqual({
      opened: true,
      path: runDirectory
    });
    expect(openFile).toHaveBeenCalledWith(runDirectory);
  });

  it("rejects opening run folders outside the configured runs root", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "local-visual-runs-open-folder-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "local-visual-runs-outside-"));
    const runDirectory = join(outsideRoot, "run-1");
    await mkdir(runDirectory, { recursive: true });
    const api = createLocalApi({
      runsRoot,
      openFile: vi.fn(async () => {})
    });

    await expect(api.openRunFolder({ runDirectory })).rejects.toThrow(
      /outside the configured runs folder/
    );
  });

  it("rejects opening generated HTML when writes are disabled", async () => {
    const api = createLocalApi({ enableWrites: false });

    await expect(
      api.openRunHtml({ runDirectory: "/runs/sakura/model-a/run-1", asset: "index.html" })
    ).rejects.toThrow(/Write actions are only available in dev server mode/);
  });

  it("rejects opening non-HTML run assets", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "local-visual-runs-open-"));
    const runDirectory = join(runsRoot, "sakura", "model-a", "run-1");
    await mkdir(runDirectory, { recursive: true });
    await writeFile(join(runDirectory, "preview.png"), "png", "utf8");
    const api = createLocalApi({
      runsRoot,
      openFile: vi.fn(async () => {})
    });

    await expect(
      api.openRunHtml({ runDirectory, asset: "preview.png" })
    ).rejects.toThrow(/Only generated HTML files can be opened/);
  });
});

describe("assertTrustedWriteRequest", () => {
  it("allows same-origin browser write requests", () => {
    const request = new Request("http://localhost:4321/api/runs", {
      method: "POST",
      headers: {
        origin: "http://localhost:4321",
        "sec-fetch-site": "same-origin",
        "content-type": "application/json"
      },
      body: "{}"
    });

    expect(() => assertTrustedWriteRequest(request)).not.toThrow();
  });

  it("rejects cross-origin browser write requests", () => {
    const request = new Request("http://localhost:4321/api/runs", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
        "content-type": "application/json"
      },
      body: "{}"
    });

    expect(() => assertTrustedWriteRequest(request)).toThrow(
      /Write requests must come from the local app origin/
    );
  });

  it("rejects write requests without JSON content type", () => {
    const request = new Request("http://localhost:4321/api/runs", {
      method: "POST",
      headers: {
        origin: "http://localhost:4321",
        "content-type": "text/plain"
      },
      body: "{}"
    });

    expect(() => assertTrustedWriteRequest(request)).toThrow(
      /Write requests must use application\/json/
    );
  });
});