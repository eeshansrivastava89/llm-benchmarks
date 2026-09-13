import { els } from "./dom.js";
import { state } from "./state.js";

let updateSelectedRunActions = () => {};

export function configureOperationalControls(options = {}) {
  updateSelectedRunActions = options.onSelectedRunControlsUpdate ?? updateSelectedRunActions;
}

export function canUseOperationalControls() {
  return !state.staticMode && state.writesEnabled;
}

export function updateWriteControls() {
  const canWrite = canUseOperationalControls();
  syncOperationalControls();
  els.refreshRuns.disabled = !canWrite || state.refreshBusy || state.captureBusy || state.scoreBusy;
  els.refreshRuns.title = "Reload saved runs from disk, then capture preview/video for runs missing media.";
  if (state.selectedRun) {
    updateSelectedRunActions(state.selectedRun);
  }
}

export function syncOperationalControls() {
  const canShow = canUseOperationalControls();
  document.querySelectorAll(".operational-control").forEach((control) => {
    const available = control.dataset.operationalAvailable !== "false";
    control.hidden = !(canShow && available);
  });
}

export function setOperationalAvailability(control, available) {
  if (control) {
    control.dataset.operationalAvailable = available ? "true" : "false";
  }
}
