import { state } from "./state.js";
import { hasCapturedVideo, runKind } from "./runs.js";

export function startHtmlPolling(options = {}) {
  if (state.htmlPollInterval) return;
  const knownReadyRunIds = new Set(readyVisualRuns().map(runKey));

  state.htmlPollInterval = setInterval(async () => {
    if (state.staticMode || state.captureBusy) return;

    try {
      await options.onRefresh?.();
    } catch {
      return;
    }

    const pending = readyVisualRuns();
    const newlyReady = pending.filter((run) => !knownReadyRunIds.has(runKey(run)));
    pending.forEach((run) => knownReadyRunIds.add(runKey(run)));

    if (newlyReady.length > 0) {
      options.onDetect?.(newlyReady.length);
    }
  }, 8000);
}

function readyVisualRuns() {
  return state.runs.filter((run) =>
    runKind(run) === "visual" &&
    run.status === "prepared" &&
    run.assets?.html &&
    !hasCapturedVideo(run)
  );
}

function runKey(run) {
  return run.runDirectory || run.runId;
}
