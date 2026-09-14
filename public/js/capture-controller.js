import { els } from "./dom.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";
import { postJson } from "./api.js";
import { findRunByDirectoryOrId, needsMediaCapture } from "./runs.js";
import { canUseOperationalControls, updateWriteControls } from "./operational-controls.js";
import { renderHarnesses, renderModelSources, renderModels, renderRuns } from "./workbench-controller.js";
import { renderDetail } from "./detail-actions.js";
import { updateOnboarding } from "./ui.js";

let captureProgressInterval = null;

export async function captureMissingMedia(options = {}) {
  if (!canUseOperationalControls() || state.captureBusy) {
    els.runSummary.textContent = "Capture requires the local dev server.";
    return;
  }

  const queue = state.runs.filter((run) => needsMediaCapture(run));
  if (queue.length === 0) {
    els.runSummary.textContent = options.afterRefresh
      ? "Refreshed. No runs need media capture."
      : "No runs need media capture.";
    return;
  }

  state.captureBusy = true;
  updateWriteControls();

  let captured = 0;
  let skipped = 0;
  let failed = 0;

  try {
    for (const [index, run] of queue.entries()) {
      state.captureRunDirectory = run.runDirectory ?? "";
      renderRuns();
      els.runSummary.textContent =
        "Capturing " + String(index + 1) + "/" + String(queue.length) + ": " +
        (run.benchmark?.title ?? run.benchmark?.id ?? "Untitled run");

      const data = await postJson("/api/capture-media", {
        runDirectory: run.runDirectory
      });
      captured += Number(data.captured ?? 0);
      skipped += Number(data.skipped ?? 0);
      failed += Number(data.failed ?? 0);
      state.runs = data.runs ?? state.runs;
    }

    state.captureRunDirectory = "";
    renderModels();
    renderHarnesses();
    renderModelSources();
    renderRuns();
    els.runSummary.textContent =
      "Captured " + String(captured) +
      ", skipped " + String(skipped) +
      ", failed " + String(failed) + ".";
  } catch (error) {
    state.captureRunDirectory = "";
    renderRuns();
    els.runSummary.textContent = "Capture failed: " + error.message;
  } finally {
    state.captureBusy = false;
    updateWriteControls();
  }
}

export async function captureSelectedRunMedia(options = {}) {
  const run = state.selectedRun;
  if (!run) {
    return;
  }

  await captureRunMedia(run, options);
}

export async function captureRunMedia(run, options = {}) {
  if (!run?.runDirectory || !canUseOperationalControls() || state.captureBusy) {
    return;
  }

  const wasSelected = state.selectedRun &&
    ((state.selectedRun.runDirectory && state.selectedRun.runDirectory === run.runDirectory) ||
      (state.selectedRun.runId && state.selectedRun.runId === run.runId));

  state.captureBusy = true;
  state.captureRunDirectory = run.runDirectory;
  updateWriteControls();
  renderRuns();
  if (wasSelected) {
    renderDetail(run);
    startCaptureProgress();
  }

  try {
    const data = await postJson("/api/capture-media", {
      runDirectory: run.runDirectory,
      force: Boolean(options.force)
    });
    state.runs = data.runs ?? state.runs;
    const nextRun = findRunByDirectoryOrId(run) ?? run;
    if (wasSelected) {
      state.selectedRun = nextRun;
    }
    renderModels();
    renderHarnesses();
    renderModelSources();
    renderRuns();
    updateOnboarding();
    if (wasSelected) {
      renderDetail(nextRun);
    }
  } catch (error) {
    if (wasSelected) {
      els.detailMeta.innerHTML +=
        '<span class="meta-label">Capture</span><strong>' + escapeHtml(error.message) + "</strong>";
    } else {
      els.runSummary.textContent = "Capture failed: " + error.message;
    }
  } finally {
    stopCaptureProgress();
    state.captureBusy = false;
    state.captureRunDirectory = "";
    renderRuns();
    if (wasSelected && state.selectedRun) {
      renderDetail(state.selectedRun);
    }
    updateWriteControls();
  }
}

function startCaptureProgress() {
  stopCaptureProgress();
  const durationMs = Number(state.captureVideoDurationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return;
  }

  const startedAt = Date.now();
  updateCaptureProgress(startedAt, durationMs);
  captureProgressInterval = window.setInterval(() => {
    updateCaptureProgress(startedAt, durationMs);
  }, 100);
}

function stopCaptureProgress() {
  if (captureProgressInterval !== null) {
    window.clearInterval(captureProgressInterval);
    captureProgressInterval = null;
  }
}

function updateCaptureProgress(startedAt, durationMs) {
  const progress = document.querySelector("[data-capture-progress]");
  if (!progress) {
    return;
  }

  const elapsedMs = Math.min(Math.max(Date.now() - startedAt, 0), durationMs);
  const ratio = elapsedMs / durationMs;
  const elapsedSeconds = Math.min(Math.floor(elapsedMs / 1000), Math.ceil(durationMs / 1000));
  const totalSeconds = Math.ceil(durationMs / 1000);
  const percent = Math.round(ratio * 100);
  const elapsed = progress.querySelector("[data-capture-elapsed]");
  const bar = progress.querySelector("[data-capture-progress-bar]");
  const status = progress.querySelector("[data-capture-status]");

  if (elapsed) elapsed.textContent = String(elapsedSeconds) + "s";
  if (bar) bar.style.transform = "scaleX(" + String(ratio) + ")";
  progress.setAttribute("aria-valuenow", String(percent));
  progress.setAttribute("aria-valuetext", String(elapsedSeconds) + " of " + String(totalSeconds) + " seconds");
  if (status && ratio >= 1) status.textContent = "Finalizing captured media…";
}
