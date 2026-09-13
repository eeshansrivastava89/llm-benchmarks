import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  captureMissingRunMedia,
  captureSingleRunMedia,
  isAnimationFrameRateAcceptable,
  isVideoMostlyBlack
} from "../../src/lib/capture-media";
import type { RunMetadata } from "../../src/lib/types";

const execFileAsync = promisify(execFile);

async function hasFfmpeg(): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

describe("capture media video validation", () => {
  it("rejects animation capture when measured render FPS is too low", () => {
    expect(
      isAnimationFrameRateAcceptable({
        frames: 6,
        durationMs: 2000,
        fps: 3,
        minFps: 12
      })
    ).toBe(false);
    expect(
      isAnimationFrameRateAcceptable({
        frames: 34,
        durationMs: 2000,
        fps: 17,
        minFps: 12
      })
    ).toBe(true);
  });

  it("detects all-black videos and accepts visible videos", async () => {
    if (!(await hasFfmpeg())) {
      return;
    }

    const root = await mkdtemp(join(tmpdir(), "visual-capture-validation-"));
    const blackVideo = join(root, "black.mp4");
    const visibleVideo = join(root, "visible.mp4");

    await execFileAsync("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=64x64:d=1",
      "-pix_fmt",
      "yuv420p",
      blackVideo
    ]);
    await execFileAsync("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=64x64:d=1",
      "-pix_fmt",
      "yuv420p",
      visibleVideo
    ]);

    await expect(isVideoMostlyBlack(blackVideo)).resolves.toBe(true);
    await expect(isVideoMostlyBlack(visibleVideo)).resolves.toBe(false);
  });

  it("accepts sparse dark scenes with small visible objects", async () => {
    if (!(await hasFfmpeg())) {
      return;
    }

    const root = await mkdtemp(join(tmpdir(), "visual-capture-validation-"));
    const sparseDarkVideo = join(root, "sparse-dark.mp4");

    await execFileAsync("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=128x72:d=1",
      "-vf",
      "drawbox=x=62:y=34:w=4:h=4:color=orange:t=fill",
      "-pix_fmt",
      "yuv420p",
      sparseDarkVideo
    ]);

    await expect(isVideoMostlyBlack(sparseDarkVideo)).resolves.toBe(false);
  });
});

describe("capture media metadata updates", () => {
  it("marks a run completed after a successful media capture", async () => {
    const { runsRoot, run } = await writePreparedRun();
    await writeFile(
      join(run.runDirectory, "metadata.json"),
      JSON.stringify({
        ...run,
        status: "failed",
        failedAt: "2026-05-08T11:30:00.000Z",
        error: {
          message: "Previous capture failed."
        }
      }),
      "utf8"
    );

    await expect(
      captureMissingRunMedia({
        runsRoot,
        now: new Date("2026-05-08T12:00:00.000Z"),
        captureRunMedia: async (capturedRun) => ({
          captured: true,
          run: capturedRun
        })
      })
    ).resolves.toMatchObject({
      captured: 1,
      failed: 0
    });

    const metadata = JSON.parse(
      await readFile(join(run.runDirectory, "metadata.json"), "utf8")
    ) as RunMetadata;
    expect(metadata.status).toBe("completed");
    expect(metadata.completedAt).toBe("2026-05-08T12:00:00.000Z");
    expect(metadata.failedAt).toBeUndefined();
    expect(metadata.error).toBeUndefined();
  });

  it("preserves a written preview when video capture fails later", async () => {
    const { runsRoot, run } = await writePreparedRun();
    await writeFile(
      join(run.runDirectory, "metadata.json"),
      JSON.stringify({
        ...run,
        status: "completed",
        completedAt: "2026-05-08T11:30:00.000Z"
      }),
      "utf8"
    );

    await expect(
      captureMissingRunMedia({
        runsRoot,
        now: new Date("2026-05-08T12:00:00.000Z"),
        captureRunMedia: async (capturedRun) => {
          await writeFile(join(capturedRun.runDirectory, "preview.png"), "png");
          throw new Error("Captured video appears to be black.");
        }
      })
    ).resolves.toMatchObject({
      captured: 0,
      failed: 1
    });

    const metadata = JSON.parse(
      await readFile(join(run.runDirectory, "metadata.json"), "utf8")
    ) as RunMetadata;
    expect(metadata.capture?.preview).toMatchObject({
      status: "ready",
      path: "preview.png",
      capturedAt: "2026-05-08T12:00:00.000Z"
    });
    expect(metadata.capture?.video).toMatchObject({
      status: "failed",
      path: "preview.webm",
      error: {
        message: "Captured video appears to be black."
      }
    });
    expect(metadata.error).toMatchObject({
      message: "Captured video appears to be black."
    });
    expect(metadata.completedAt).toBeUndefined();
    expect(metadata.assets.video).toBeUndefined();
    expect(metadata.assets.videoMp4).toBeUndefined();
  });

  it("defaults video capture duration to 20 seconds", async () => {
    const { runsRoot } = await writePreparedRun();
    let videoDurationMs: number | undefined;

    await captureMissingRunMedia({
      runsRoot,
      captureRunMedia: async (capturedRun, options) => {
        videoDurationMs = options.videoDurationMs;
        return {
          captured: true,
          run: capturedRun
        };
      }
    });

    expect(videoDurationMs).toBe(20_000);
  });

  it("recaptures one run when forced even if preview media already exists", async () => {
    const { runsRoot, run } = await writePreparedRun();
    let forcedOption: boolean | undefined;

    await expect(
      captureSingleRunMedia({
        runsRoot,
        runDirectory: run.runDirectory,
        force: true,
        now: new Date("2026-05-08T12:00:00.000Z"),
        captureRunMedia: async (capturedRun, options) => {
          forcedOption = options.force;
          return {
            captured: true,
            run: capturedRun
          };
        }
      })
    ).resolves.toMatchObject({
      captured: 1,
      skipped: 0,
      failed: 0
    });

    expect(forcedOption).toBe(true);
  });
});

async function writePreparedRun() {
  const runsRoot = await mkdtemp(join(tmpdir(), "visual-capture-metadata-"));
  const runDirectory = join(runsRoot, "sakura", "model-a", "run-1");
  const run: RunMetadata = {
    runId: "run-1",
    benchmark: {
      id: "sakura",
      title: "Sakura",
      description: "Cherry blossom animation.",
      prompt: "Draw sakura."
    },
    model: {
      id: "model-a",
      slug: "model-a"
    },
    status: "prepared",
    createdAt: "2026-05-08T11:00:00.000Z",
    updatedAt: "2026-05-08T11:00:00.000Z",
    runDirectory,
    assets: {
      metadata: "metadata.json",
      html: "index.html",
      preview: "preview.png",
      video: "preview.webm"
    }
  };

  await mkdir(runDirectory, { recursive: true });
  await writeFile(join(runDirectory, "metadata.json"), JSON.stringify(run), "utf8");
  await writeFile(join(runDirectory, "index.html"), "<!doctype html><html></html>", "utf8");
  return { runsRoot, run };
}
