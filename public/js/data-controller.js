import { els } from "./dom.js";
import { state } from "./state.js";
import { fetchJson, fetchStaticManifest } from "./api.js";
import { setButtonLabel } from "./icons.js";
import { startHtmlPolling } from "./polling.js";
import { currentModal } from "./modals.js";
import { findRunByDirectoryOrId } from "./runs.js";
import { updateOnboarding, showHtmlDetectToast } from "./ui.js";
import { renderMachineProfile } from "./machine-profile.js";
import { renderBenchmarks, renderHarnesses, renderKindTabs, renderModelSources, renderModels, renderRuns } from "./workbench-controller.js";

import { captureMissingMedia } from "./capture-controller.js";
import { renderDetail, updateDetailActions } from "./detail-actions.js";
import { updateWriteControls } from "./operational-controls.js";

export async function loadLocalData() {
  if (state.staticMode) {
    await enterStaticMode(new Error("Static build"));
    return;
  }

  try {
    const [benchmarks, runs] = await Promise.all([
      fetchJson("/api/benchmarks"),
      fetchJson("/api/runs")
    ]);
    state.staticMode = false;
    state.benchmarks = benchmarks.benchmarks ?? [];
    state.runs = runs.runs ?? [];
    renderKindTabs();
    renderBenchmarks();
    renderModels();
    renderHarnesses();
    renderModelSources();
    renderRuns();
    startHtmlPolling({
      onRefresh: refreshRunsForPolling,
      onDetect: showHtmlDetectToast
    });

  } catch (error) {
    await enterStaticMode(error);
  }
}

export async function enterStaticMode(reason) {
  try {
    const manifest = await fetchStaticManifest();
    state.staticMode = true;
    state.benchmarks = manifest.benchmarks ?? [];
    state.runs = manifest.runs ?? [];
    state.machineProfile = manifest.machineProfile ?? null;
    state.writesEnabled = false;
    renderMachineProfile(state.machineProfile);
    renderKindTabs();
    renderBenchmarks();
    renderModels();
    renderHarnesses();
    renderModelSources();
    renderRuns();
    updateOnboarding();
    updateWriteControls();
  } catch (staticError) {
    els.statsDot.dataset.state = "offline";
    els.statsCompact.textContent = "Unavailable";
    els.runsSurface.innerHTML = '<div class="empty">No local API or static export was found.</div>';
  }
}

export async function refreshAndCaptureMissing() {
  const refreshed = await refreshRuns();
  if (refreshed) {
    await captureMissingMedia({ afterRefresh: true });
  }
}

export async function refreshRuns() {
  if (state.staticMode) {
    await enterStaticMode(new Error("Static refresh"));
    return false;
  }

  state.refreshBusy = true;
  updateWriteControls();
  setButtonLabel(els.refreshRuns, "Refreshing…", "refresh-cw");
  els.runSummary.textContent = "Refreshing saved runs…";

  try {
    const [benchmarks, runs] = await Promise.all([
      fetchJson("/api/benchmarks"),
      fetchJson("/api/runs")
    ]);
    state.benchmarks = benchmarks.benchmarks ?? [];
    state.runs = runs.runs ?? [];
    syncSelectedRunFromState({ rerenderDetail: true });
    renderKindTabs();
    renderBenchmarks();
    renderModels();
    renderHarnesses();
    renderModelSources();
    renderRuns();
    return true;
  } catch (error) {
    els.runSummary.textContent = "Refresh failed: " + error.message;
    return false;
  } finally {
    state.refreshBusy = false;
    setButtonLabel(els.refreshRuns, "Refresh", "refresh-cw");
    updateWriteControls();
  }
}

export async function refreshRunsForPolling() {
  if (state.staticMode || state.captureBusy) {
    return;
  }

  const runs = await fetchJson("/api/runs");
  const nextRuns = runs.runs ?? [];
  if (runsRenderSignature(nextRuns) === runsRenderSignature(state.runs)) {
    return;
  }

  state.runs = nextRuns;
  syncSelectedRunFromState({ rerenderDetail: currentModal() === "detail" });
  renderModels();
  renderHarnesses();
  renderModelSources();
  renderRuns();
  updateOnboarding();
}

function runsRenderSignature(runs) {
  return runs.map((run) => [
    run.runDirectory ?? run.runId ?? "",
    run.updatedAt ?? "",
    run.status ?? "",
    run.assets?.html ?? "",
    run.assets?.preview ?? "",
    run.assets?.video ?? "",
    run.assets?.videoMp4 ?? "",
    run.capture?.video?.status ?? "",
    run.capture?.video?.quality?.measuredFps ?? ""
  ].join("|")).join("\n");
}

function syncSelectedRunFromState(options = {}) {
  if (!state.selectedRun) {
    return;
  }

  const nextRun = findRunByDirectoryOrId(state.selectedRun);
  if (!nextRun) {
    return;
  }

  state.selectedRun = nextRun;
  if (options.rerenderDetail) {
    renderDetail(nextRun);
  } else {
    updateDetailActions(nextRun);
  }
}