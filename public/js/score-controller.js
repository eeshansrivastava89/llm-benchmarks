import { els } from "./dom.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";
import { postJson } from "./api.js";
import { setButtonLabel } from "./icons.js";
import { findRunByDirectoryOrId } from "./runs.js";
import { canUseOperationalControls, updateWriteControls } from "./operational-controls.js";
import { renderHarnesses, renderModelSources, renderModels, renderRuns } from "./workbench-controller.js";
import { renderDetail } from "./detail-actions.js";
import { updateOnboarding } from "./ui.js";

export async function scoreDsRun(run) {
  if (!run?.runDirectory || !canUseOperationalControls() || state.scoreBusy) {
    return;
  }

  const wasSelected = state.selectedRun &&
    ((state.selectedRun.runDirectory && state.selectedRun.runDirectory === run.runDirectory) ||
      (state.selectedRun.runId && state.selectedRun.runId === run.runId));

  state.scoreBusy = true;
  state.scoreRunDirectory = run.runDirectory;
  updateWriteControls();
  renderRuns();
  if (wasSelected) {
    setButtonLabel(els.recaptureRun, "Scoring…", "check-circle");
  }

  try {
    const data = await postJson("/api/score-ds-run", {
      runDirectory: run.runDirectory
    });
    // Refresh runs from server — the scorecard is now on disk
    if (Array.isArray(data.runs)) {
      state.runs = data.runs;
    }
    const nextRun = findRunByDirectoryOrId(run) ?? data.run ?? run;
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
        '<span class="meta-label">Score</span><strong>' + escapeHtml(error.message) + "</strong>";
    } else {
      els.runSummary.textContent = "Score failed: " + error.message;
    }
  } finally {
    state.scoreBusy = false;
    state.scoreRunDirectory = "";
    renderRuns();
    if (wasSelected && state.selectedRun) {
      renderDetail(state.selectedRun);
    }
    updateWriteControls();
  }
}