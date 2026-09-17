import { BenchError, errorMessage, SelectionCancelled } from "./errors.mjs";
import { BACK, BenchUI, selectedOrCancel } from "./ui/bench-ui.mjs";
import { createViewerManager, VIEWER_IDS } from "./viewers.mjs";

export function parseViewCommand(argv) {
  if (argv[0] !== "view") return null;
  if (argv.length === 1) return { action: "select" };
  if (argv[1] === "status" && argv.length === 2) return { action: "status", target: "both" };
  if (argv[1] === "stop" && argv.length <= 3) {
    const target = argv[2] ?? "both";
    if ([VIEWER_IDS.inspect, VIEWER_IDS.visual, "both"].includes(target)) {
      return { action: "stop", target };
    }
  }
  if ([VIEWER_IDS.inspect, VIEWER_IDS.visual, "both"].includes(argv[1]) && argv.length === 2) {
    return { action: "start", target: argv[1] };
  }
  throw new BenchError("Usage: bench view [inspect|visual|both|status|stop [inspect|visual|both]]");
}

export function viewerStatusLine(result) {
  const detail = result.health === "healthy"
    ? result.owned ? `Bench-owned${result.pid ? ` · PID ${result.pid}` : ""}` : "external"
    : result.health === "occupied" ? "unknown application on configured port"
      : result.health === "stale" ? `stale ownership${result.pid ? ` · PID ${result.pid}` : ""}`
        : "not running";
  return `${result.label}: ${result.health} · ${detail} · ${result.url}`;
}

export function viewerActionLine(result) {
  let action = result.action;
  if (action === "reused" && !result.owned) {
    action = "opened existing viewer (not managed by Bench; bench view stop will leave it running)";
  } else if (action === "not-owned") {
    action = result.health === "healthy"
      ? "left running: existing viewer is not managed by Bench"
      : "not stopped: unknown application on configured port";
  } else if (action === "already-stopped") {
    action = "already stopped";
  } else if (action === "stale-state-removed") {
    action = "cleared stale ownership; no process was stopped";
  }
  return `${result.label}: ${action} · ${result.url}${result.owned && result.pid ? ` · PID ${result.pid}` : ""}`;
}

async function startAndOpenViewers(manager, target) {
  const results = await manager.start(target);
  results.forEach((result) => console.log(viewerActionLine(result)));
  await manager.open(target === "both" ? VIEWER_IDS.visual : target);
  return results;
}

async function runViewerSelector(cwd) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new BenchError("`bench view` without a target requires an interactive terminal");
  }
  const manager = createViewerManager({ repositoryRoot: cwd });
  const ui = new BenchUI();
  ui.start();
  try {
    while (true) {
      const selected = selectedOrCancel(await ui.select([
        { action: "start", target: VIEWER_IDS.inspect, label: "Inspect results", detail: "Start or reuse Inspect, then open it" },
        { action: "start", target: VIEWER_IDS.visual, label: "Visual results", detail: "Start or reuse the visual and Data Science viewer" },
        { action: "start", target: "both", label: "Both viewers", detail: "Start both and open Visual as the hub" },
        { action: "status", target: "both", label: "Viewer status", detail: "Check URLs, health, and Bench ownership" },
        { action: "stop-select", label: "Stop viewers", detail: "Stop only validated Bench-owned processes" },
      ], {
        step: "Viewers",
        title: "Results viewers",
        message: "Bench reuses matching viewers and refuses unknown applications on configured ports.",
        label: (item) => item.label,
        summary: (item) => item.detail,
        details: (item) => [item.detail],
        compact: true,
      }));

      if (selected.action === "stop-select") {
        const target = selectedOrCancel(await ui.select([
          { target: VIEWER_IDS.inspect, label: "Stop Inspect", detail: "Stop the Bench-owned Inspect viewer" },
          { target: VIEWER_IDS.visual, label: "Stop Visual", detail: "Stop the Bench-owned visual viewer" },
          { target: "both", label: "Stop both", detail: "Stop both validated process groups" },
        ], {
          step: "Viewers",
          title: "Stop viewers",
          message: "External and unknown processes will not be stopped.",
          label: (item) => item.label,
          summary: (item) => item.detail,
          compact: true,
          allowBack: true,
        }));
        if (target === BACK) continue;
        ui.showLoading("Stopping viewers…");
        const results = await manager.stop(target.target);
        ui.stop({ preserveScreen: true });
        results.forEach((result) => console.log(viewerActionLine(result)));
        return;
      }

      ui.showLoading(selected.action === "start" ? "Starting viewers…" : "Checking viewer status…");
      if (selected.action === "status") {
        const results = await manager.status();
        ui.stop({ preserveScreen: true });
        results.forEach((result) => console.log(viewerStatusLine(result)));
        return;
      }
      const target = selected.target;
      const results = await manager.start(target);
      ui.stop({ preserveScreen: true });
      results.forEach((result) => console.log(viewerActionLine(result)));
      await manager.open(target === "both" ? VIEWER_IDS.visual : target);
      return;
    }
  } finally {
    ui.stop({ preserveScreen: true });
  }
}

export async function runViewCommand(cwd, command) {
  if (command.action === "select") return runViewerSelector(cwd);
  const manager = createViewerManager({ repositoryRoot: cwd });
  if (command.action === "start") return startAndOpenViewers(manager, command.target);
  const results = command.action === "status"
    ? await manager.status(command.target)
    : await manager.stop(command.target);
  for (const result of results) {
    console.log(command.action === "status"
      ? viewerStatusLine(result)
      : viewerActionLine(result));
  }
}

export async function offerViewersAfterRun(cwd, relevantViewer) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;
  const ui = new BenchUI();
  ui.start();
  try {
    const selected = selectedOrCancel(await ui.select([
      { target: null, label: "No", detail: "Return to the terminal" },
      { target: relevantViewer, label: "Relevant viewer", detail: relevantViewer === VIEWER_IDS.inspect ? "Open Inspect results" : "Open Visual results" },
      { target: "both", label: "Both viewers", detail: "Start both and open Visual as the hub" },
    ], {
      step: "Results",
      title: "Open results after run?",
      message: "No is selected by default.",
      label: (item) => item.label,
      summary: (item) => item.detail,
      compact: true,
    }));
    if (!selected.target) return;
    ui.showLoading("Starting results viewers…");
    const manager = createViewerManager({ repositoryRoot: cwd });
    const results = await manager.start(selected.target);
    ui.stop({ preserveScreen: true });
    results.forEach((result) => console.log(viewerActionLine(result)));
    await manager.open(selected.target === "both" ? VIEWER_IDS.visual : selected.target);
  } catch (error) {
    if (!(error instanceof SelectionCancelled)) {
      console.error(`Warning: Could not open results viewer: ${errorMessage(error)}`);
    }
  } finally {
    ui.stop({ preserveScreen: true });
  }
}