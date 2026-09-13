import { els } from "./dom.js";
import { state } from "./state.js";
import { loadLocalData, refreshAndCaptureMissing, refreshRunsForPolling } from "./data-controller.js";
import { captureMissingMedia, captureRunMedia, captureSelectedRunMedia } from "./capture-controller.js";
import { initChartLightbox } from "./chart-lightbox.js";
import { scoreDsRun } from "./score-controller.js";
import {
  configureWorkbenchController,
  renderBenchmarks,
  renderHarnesses,
  renderKindTabs,
  renderModels,
  renderRuns,
  resetRunPage
} from "./workbench-controller.js";
import {
  confirmDeleteSelectedRun,
  copyDetailPrompt,
  copySelectedRunPath,
  openDetail,
  openSelectedRunFolder,
  openSelectedRunHtml,
  requestDeleteSelectedRun,
  updateDetailActions
} from "./detail-actions.js";
import { closeModal, handleModalKeydown, openModal } from "./modals.js";
import { applyStoredTheme, toggleTheme } from "./theme.js";
import { wireHelpTooltips } from "./tooltips.js";
import { renderViewTabs, updateOnboarding } from "./ui.js";
import { canUseOperationalControls, configureOperationalControls } from "./operational-controls.js";
import { runKind } from "./runs.js";
import { loadMachineProfile } from "./machine-profile.js";
import { copyTextToClipboard } from "./clipboard.js";

init();

function init() {
  initWorkspaceState();
  configureControllers();
  applyStoredTheme();
  wireEvents();
  initChartLightbox();
  renderViewTabs();
  updateOnboarding();
  void loadLocalData();
  void loadMachineProfile();
}

function initWorkspaceState() {
  state.workspace = "visual";
  state.mode = "benchmark";
  state.staticMode = document.body?.dataset.staticBuild === "true";

  // Restore persisted kind tab selection
  try {
    const savedKind = localStorage.getItem("selectedKind");
    if (savedKind === "visual" || savedKind === "data-science") {
      state.selectedKind = savedKind;
      document.body.dataset.workspace = savedKind;
    }
  } catch { /* localStorage unavailable */ }
  // Restore persisted cloud models toggle
  try {
    const savedCloud = localStorage.getItem("showCloudModels");
    if (savedCloud === "true") {
      state.showCloudModels = true;
      if (els.cloudModelsToggle) els.cloudModelsToggle.checked = true;
    }
  } catch { /* localStorage unavailable */ }
}

function configureControllers() {
  configureOperationalControls({
    onSelectedRunControlsUpdate: updateDetailActions
  });
  configureWorkbenchController({
    canUseOperationalControls,
    onCaptureRunMedia: captureRunMedia,
    onScoreDsRun: scoreDsRun,
    onOpenDetail: openDetail
  });
}

function wireEvents() {
  els.refreshRuns.addEventListener("click", () => refreshAndCaptureMissing());

  els.themeToggle.addEventListener("click", () => toggleTheme());
  els.runToggle.addEventListener("click", () => {
    openModal("prep");
  });

  els.closeDetail.addEventListener("click", () => closeModal("detail"));
  els.closePrep?.addEventListener("click", () => closeModal("prep"));
  els.closeDeleteConfirm.addEventListener("click", () => closeModal("deleteConfirm"));
  els.cancelDeleteRun.addEventListener("click", () => closeModal("deleteConfirm"));
  els.confirmDeleteRun.addEventListener("click", () => confirmDeleteSelectedRun());
  document.addEventListener("keydown", handleModalKeydown);
  wireHelpTooltips();
  document.querySelectorAll(".cli-copy-btn").forEach((btn) => {
    btn.addEventListener("click", () => copyTextToClipboard(btn.dataset.copy, btn, "Copy"));
  });

  els.detailBackdrop.addEventListener("click", (event) => {
    if (event.target === els.detailBackdrop) closeModal("detail");
  });
  els.prepBackdrop?.addEventListener("click", (event) => {
    if (event.target === els.prepBackdrop) closeModal("prep");
  });
  els.deleteConfirmBackdrop.addEventListener("click", (event) => {
    if (event.target === els.deleteConfirmBackdrop) closeModal("deleteConfirm");
  });

  els.deleteRun.addEventListener("click", () => requestDeleteSelectedRun());
  els.openHtml.addEventListener("click", () => openSelectedRunHtml());
  els.copyDetailPath.addEventListener("click", () => copySelectedRunPath());
  els.openRunFolder.addEventListener("click", () => openSelectedRunFolder(els.openRunFolder, els.detailMeta));
  els.recaptureRun.addEventListener("click", () => {
    const run = state.selectedRun;
    if (run && runKind(run) === "data-science") {
      void scoreDsRun(run);
    } else {
      captureSelectedRunMedia({ force: true });
    }
  });
  els.copyDetailPrompt.addEventListener("click", () => copyDetailPrompt());

  els.modelFilter.addEventListener("change", () => {
    state.selectedModel = els.modelFilter.value;
    resetRunPage();
    renderRuns();
  });
  els.benchmarkFilter.addEventListener("change", () => {
    state.selectedBenchmark = els.benchmarkFilter.value;
    resetRunPage();
    renderRuns();
  });
  els.harnessFilter.addEventListener("change", () => {
    state.selectedHarness = els.harnessFilter.value;
    resetRunPage();
    renderRuns();
  });
  els.runsSearch.addEventListener("input", () => {
    state.runsSearch = els.runsSearch.value;
    resetRunPage();
    renderRuns();
  });
  els.filtersToggle?.addEventListener("click", () => {
    const isOpen = els.toolbarFilterGroup.classList.toggle("is-open");
    els.filtersToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });
  els.clearWorkbenchState.addEventListener("click", () => {
    state.selectedModel = "all";
    state.selectedBenchmark = "all";
    state.selectedHarness = "all";
    state.selectedKind = "visual";
    state.runsSearch = "";
    state.compareSelection = [];
    els.runsSearch.value = "";
    document.body.dataset.workspace = "visual";
    try { localStorage.removeItem("selectedKind"); } catch {}
    resetRunPage();
    renderKindTabs();
    renderBenchmarks();
    renderModels();
    renderHarnesses();
    renderRuns();
  });
  els.cloudModelsToggle?.addEventListener("change", () => {
    state.showCloudModels = els.cloudModelsToggle.checked;
    try { localStorage.setItem("showCloudModels", String(state.showCloudModels)); } catch {}
    resetRunPage();
    renderModels();
    renderRuns();
  });
  els.viewTabs.forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      resetRunPage();
      renderViewTabs();
      renderRuns();
    });
  });

  els.kindTabs.forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedKind = button.dataset.kind;
      state.selectedBenchmark = "all";
      state.selectedModel = "all";
      state.selectedHarness = "all";
      document.body.dataset.workspace = state.selectedKind;
      try { localStorage.setItem("selectedKind", state.selectedKind); } catch {}
      resetRunPage();
      renderKindTabs();
      renderBenchmarks();
      renderModels();
      renderHarnesses();
      renderRuns();
    });
  });

  if (els.dismissOnboarding) {
    els.dismissOnboarding.addEventListener("click", () => {
      state.onboardingDismissed = true;
      try { localStorage.setItem("onboardingDismissed", "1"); } catch {}
      if (els.onboardingPanel) els.onboardingPanel.hidden = true;
    });
  }

  document.addEventListener("capture-pending", () => {
    void captureMissingMedia();
  });
}
