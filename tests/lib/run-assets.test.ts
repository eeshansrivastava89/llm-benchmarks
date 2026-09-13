import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readRunAsset } from "../../src/lib/run-assets";

describe("run asset reader", () => {
  it("reads files inside the configured runs root", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "visual-runs-assets-"));
    const runDirectory = join(runsRoot, "sakura", "model-a", "run-1");
    await mkdir(runDirectory, { recursive: true });
    await writeFile(join(runDirectory, "preview.png"), "png");

    const file = await readRunAsset({
      runsRoot,
      runDirectory,
      asset: "preview.png"
    });

    expect(file.contentType).toBe("image/png");
    expect(Buffer.from(file.body).toString("utf8")).toBe("png");
  });

  it("rejects run directories outside the runs root", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "visual-runs-assets-"));
    const outside = await mkdtemp(join(tmpdir(), "visual-runs-outside-"));

    await expect(
      readRunAsset({
        runsRoot,
        runDirectory: outside,
        asset: "preview.png"
      })
    ).rejects.toThrow(/outside the configured runs folder/);
  });

  it("rejects asset traversal", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "visual-runs-assets-"));
    const runDirectory = join(runsRoot, "sakura", "model-a", "run-1");
    await mkdir(runDirectory, { recursive: true });

    await expect(
      readRunAsset({
        runsRoot,
        runDirectory,
        asset: "../metadata.json"
      })
    ).rejects.toThrow(/inside a run folder/);
  });

  it("rejects generated HTML and raw response assets", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "visual-runs-assets-"));
    const runDirectory = join(runsRoot, "sakura", "model-a", "run-1");
    await mkdir(runDirectory, { recursive: true });
    await writeFile(join(runDirectory, "index.html"), "<!doctype html>");
    await writeFile(join(runDirectory, "response.raw.txt"), "raw");

    await expect(
      readRunAsset({ runsRoot, runDirectory, asset: "index.html" })
    ).rejects.toThrow(/Only captured media and data-science assets/);
    await expect(
      readRunAsset({ runsRoot, runDirectory, asset: "response.raw.txt" })
    ).rejects.toThrow(/Only captured media and data-science assets/);
  });
});
