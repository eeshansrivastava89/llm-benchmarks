import { els } from "./dom.js";
import { state } from "./state.js";
import { escapeAttribute, escapeHtml, uniqueBy } from "./utils.js";
import { compareRunKey, toggleCompareSelection } from "./compare.js";
import { exportSelectedComparisonVideo } from "./comparison-export-controller.js";
import { syncManagedCompareVideos } from "./compare-ui.js";
import { filteredRuns, groupRuns, harnessesFromRuns, modelsFromRuns, benchmarkMatchesKind, runKind, runSummaryText } from "./runs.js";
import { renderGroupedRuns as renderGroupedRunsMarkup, renderRunsTable as renderRunsTableMarkup } from "./workbench-ui.js";
import { openModal } from "./modals.js";

let captureRunMediaHandler = () => {};
let scoreDsRunHandler = () => {};
let openDetailHandler = () => {};
let canUseOperationalControlsHandler = () => false;

export function configureWorkbenchController(options = {}) {
  captureRunMediaHandler = options.onCaptureRunMedia ?? captureRunMediaHandler;
  scoreDsRunHandler = options.onScoreDsRun ?? scoreDsRunHandler;
  openDetailHandler = options.onOpenDetail ?? openDetailHandler;
  canUseOperationalControlsHandler = options.canUseOperationalControls ?? canUseOperationalControlsHandler;
}

export function runsForCurrentWorkspace() {
  return state.runs.filter((run) => {
    const kind = runKind(run);
    return kind === state.selectedKind;
  });
}

export function renderBenchmarks() {
  const allLabel = "All prompts";
  const optionRuns = runsForCurrentWorkspace();
  const runOptions = optionRuns
    .map((run) => ({
      id: run.benchmark?.id,
      label: run.benchmark?.title ?? run.benchmark?.id
    }))
    .filter((item) => item.id && item.label);
  const kindBenchmarks = state.benchmarks.filter((b) => benchmarkMatchesKind(b.id, state.selectedKind));
  const benchmarkOptions = kindBenchmarks.map((benchmark) => ({ id: benchmark.id, label: benchmark.title }));
  const options = uniqueBy([...benchmarkOptions, ...runOptions], (item) => item.id);
  if (state.selectedBenchmark !== "all" && !options.some((option) => option.id === state.selectedBenchmark)) {
    state.selectedBenchmark = "all";
  }
  els.benchmarkFilter.innerHTML = [
    '<option value="all">' + escapeHtml(allLabel) + "</option>",
    ...options.map((option) =>
      '<option value="' + escapeAttribute(option.id) + '">' + escapeHtml(option.label) + "</option>"
    )
  ].join("");
  els.benchmarkFilter.value = state.selectedBenchmark;
  els.benchmarkFilter.disabled = false;
  els.benchmarkFilter.removeAttribute("data-loading");
}

export function renderKindTabs() {
  els.kindTabs.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.kind === state.selectedKind));
  });
}

export function renderModels() {
  const runModels = modelsFromRuns(runsForCurrentWorkspace());
  if (state.selectedModel !== "all" && !runModels.some((m) => m.id === state.selectedModel)) {
    state.selectedModel = "all";
    els.modelFilter.value = "all";
  }
  els.modelFilter.innerHTML = [
    '<option value="all">All run models</option>',
    ...runModels.map((m) =>
      '<option value="' + escapeAttribute(m.id) + '">' + escapeHtml(m.id) + "</option>"
    )
  ].join("");
  els.modelFilter.value = state.selectedModel;
  els.modelFilter.disabled = false;
  els.modelFilter.removeAttribute("data-loading");
}

export function renderHarnesses() {
  const runHarnesses = harnessesFromRuns(runsForCurrentWorkspace());
  if (state.selectedHarness !== "all" && !runHarnesses.some((harness) => harness.id === state.selectedHarness)) {
    state.selectedHarness = "all";
    els.harnessFilter.value = "all";
  }
  els.harnessFilter.innerHTML = [
    '<option value="all">All harnesses</option>',
    ...runHarnesses.map((harness) =>
      '<option value="' + escapeAttribute(harness.id) + '">' + escapeHtml(harness.id) + "</option>"
    )
  ].join("");
  els.harnessFilter.value = state.selectedHarness;
  els.harnessFilter.disabled = false;
  els.harnessFilter.removeAttribute("data-loading");
}

export function renderModelSources() {
  // Model inventory is now handled by the CLI; no longer rendered in web UI.
}

export function resetRunPage() {
  state.runPage = 1;
}

export function renderRuns() {
  const runs = filteredRuns();
  els.runCount.textContent = String(runs.length);
  els.runSummary.textContent = runSummaryText(runs);
  els.viewTitle.textContent = state.mode === "model"
    ? "Model comparison"
    : state.mode === "compare"
    ? "Compare"
    : state.mode === "benchmark"
      ? "Prompt comparison"
      : "Model comparison";
  els.viewSubtitle.textContent = state.mode === "model"
    ? "Group attempts by model and prompt."
    : state.mode === "compare"
    ? "Select rows to compare outputs."
    : state.mode === "benchmark"
      ? "Compare one prompt across models."
      : "Group attempts by model and prompt.";
  updateClearWorkbenchStateButton();
  updateFiltersToggleCount();

  if (runs.length === 0) {
    const emptyBase = '<div class="empty">No runs match the current filters.</div>';
    const emptyWithAction = !canUseOperationalControlsHandler()
      ? emptyBase
      : '<div class="empty">No runs match the current filters.<div class="empty-state-action"><button type="button" class="btn-sm-ghost" id="emptyPrepRun">Prepare a run</button></div></div>';
    els.runsSurface.innerHTML = emptyWithAction;
    const emptyPrep = document.querySelector("#emptyPrepRun");
    if (emptyPrep) {
      emptyPrep.addEventListener("click", () => openModal("prep"));
    }
    return;
  }

  if (state.mode === "compare") {
    renderRunsTable(runs);
    return;
  }

  if (state.mode === "model") {
    renderGroupedRuns(
      groupRuns(runs, (r) => r.model?.id ?? "Unknown model", (r) => r.benchmark?.title ?? r.benchmark?.id ?? "Unknown prompt"),
      "model"
    );
    return;
  }

  if (state.mode === "benchmark") {
    renderGroupedRuns(
      groupRuns(runs, (r) => r.benchmark?.title ?? r.benchmark?.id ?? "Unknown prompt", (r) => r.model?.id ?? "Unknown model"),
      "benchmark"
    );
    return;
  }
  renderGroupedRuns(
    groupRuns(runs, (r) => r.benchmark?.title ?? r.benchmark?.id ?? "Unknown prompt", (r) => r.model?.id ?? "Unknown model"),
    "benchmark"
  );
}

function wireCompareSelection(runs) {
  document.querySelectorAll("[data-compare-select]").forEach((input) => {
    input.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
    });
    input.addEventListener("change", (event) => {
      event.stopPropagation();
      const run = runs.find((candidate) => compareRunKey(candidate) === input.dataset.compareSelect);
      state.compareSelection = toggleCompareSelection(state.compareSelection, run);
      renderRuns();
    });
  });
}

function renderRunsTable(runs) {
  const rendered = renderRunsTableMarkup(runs, workbenchRenderContext());
  state.runPage = rendered.runPage;
  els.runsSurface.innerHTML = rendered.html;
  syncManagedCompareVideos(els.runsSurface);
  wireCompareSelection(runs);
  wireComparisonExport();
  wireRunCards();
  wireRunsPagination(rendered.totalPages);
}

function renderGroupedRuns(groups, mode) {
  els.runsSurface.innerHTML = renderGroupedRunsMarkup(groups, mode, workbenchRenderContext());
  wireRunCards();
}

function updateFiltersToggleCount() {
  if (!els.filtersToggleCount) return;
  let count = 0;
  if (state.selectedModel !== "all") count += 1;
  if (state.selectedBenchmark !== "all") count += 1;
  if (state.selectedHarness !== "all") count += 1;
  if (state.runsSearch.trim().length > 0) count += 1;
  if (count > 0) {
    els.filtersToggleCount.textContent = String(count);
    els.filtersToggleCount.hidden = false;
  } else {
    els.filtersToggleCount.hidden = true;
  }
}

function updateClearWorkbenchStateButton() {
  if (!els.clearWorkbenchState || !els.clearWorkbenchStateLabel) return;
  const hasFilters = state.selectedModel !== "all" ||
    state.selectedBenchmark !== "all" ||
    state.selectedHarness !== "all" ||
    state.runsSearch.trim().length > 0;
  const hasSelection = state.compareSelection.length > 0;
  els.clearWorkbenchState.hidden = !(hasFilters || hasSelection);
  els.clearWorkbenchStateLabel.textContent = hasFilters && hasSelection
    ? "Reset view"
    : hasSelection
      ? "Clear selection"
      : "Clear filters";
  els.clearWorkbenchState.title = hasFilters && hasSelection
    ? "Clear filters, search, and selected compare runs."
    : hasSelection
      ? "Clear selected compare runs."
      : "Clear filters and search.";
}

function workbenchRenderContext() {
  return {
    canOperate: canUseOperationalControlsHandler(),
    captureBusy: state.captureBusy,
    captureRunDirectory: state.captureRunDirectory,
    scoreBusy: state.scoreBusy,
    scoreRunDirectory: state.scoreRunDirectory,
    compareSelection: state.compareSelection,
    comparisonExportBusy: state.comparisonExportBusy,
    runPage: state.runPage,
    runsPerPage: state.runsPerPage
  };
}

function wireRunsPagination(totalPages) {
  const previous = document.querySelector("#runsPrevPage");
  const next = document.querySelector("#runsNextPage");
  previous?.addEventListener("click", () => {
    state.runPage = Math.max(1, state.runPage - 1);
    renderRuns();
  });
  next?.addEventListener("click", () => {
    state.runPage = Math.min(totalPages, state.runPage + 1);
    renderRuns();
  });
}

function wireComparisonExport() {
  const button = document.querySelector("[data-export-compare-video]");
  button?.addEventListener("click", (event) => {
    event.stopPropagation();
    void exportSelectedComparisonVideo(button);
  });
}

function wireRunCards() {
  els.runsSurface.querySelectorAll("[data-capture-run-id]").forEach((button) => {
    button.addEventListener("keydown", (event) => {
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const runId = button.dataset.captureRunId;
      const run = state.runs.find((r) => r.runId === runId);
      if (run) {
        void captureRunMediaHandler(run);
      }
    });
  });

  els.runsSurface.querySelectorAll("[data-score-run-id]").forEach((button) => {
    button.addEventListener("keydown", (event) => {
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const runId = button.dataset.scoreRunId;
      const run = state.runs.find((r) => r.runId === runId);
      if (run) {
        void scoreDsRunHandler(run);
      }
    });
  });

  els.runsSurface.querySelectorAll("[data-open-run]").forEach((card) => {
    card.addEventListener("click", () => {
      const runId = card.dataset.runId;
      const run = state.runs.find((r) => r.runId === runId);
      if (run) {
        openRunFromCurrentView(run);
      }
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const runId = card.dataset.runId;
        const run = state.runs.find((r) => r.runId === runId);
        if (run) {
          openRunFromCurrentView(run);
        }
      }
    });
  });
}

function openRunFromCurrentView(run) {
  openDetailHandler(run);
}
