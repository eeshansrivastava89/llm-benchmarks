import { postJson } from "./api.js";
import { state } from "./state.js";
import { selectedCompareRuns } from "./compare.js";
import { canUseOperationalControls } from "./operational-controls.js";
import { renderRuns } from "./workbench-controller.js";
import { els } from "./dom.js";

export async function exportSelectedComparisonVideo(button) {
  if (!canUseOperationalControls() || state.comparisonExportBusy) return;
  const selectedRuns = selectedCompareRuns(state.runs, state.compareSelection);
  if (selectedRuns.length < 2) return;

  state.comparisonExportBusy = true;
  if (button) button.disabled = true;
  renderRuns();
  els.runSummary.textContent = "Exporting comparison video…";
  let summary = "";
  try {
    const data = await postJson("/api/export-comparison-video", {
      runDirectories: selectedRuns.map((run) => run.runDirectory)
    });
    summary = "Comparison video exported: " + data.path;
  } catch (error) {
    summary = "Comparison export failed: " + error.message;
  } finally {
    state.comparisonExportBusy = false;
    renderRuns();
    if (summary) els.runSummary.textContent = summary;
  }
}
