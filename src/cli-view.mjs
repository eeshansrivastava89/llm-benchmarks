import { BenchError } from "./errors.mjs";
import { BACK, BenchUI, selectedOrCancel } from "./ui/bench-ui.mjs";
import { createViewerManager, VIEWER_IDS } from "./viewers.mjs";

const VIEWER_TARGETS = [VIEWER_IDS.inspect, VIEWER_IDS.visual, "both"];

export function createViewerManagerFor(cwd) {
  return createViewerManager({ repositoryRoot: cwd });
}

export function parseViewCommand(argv) {
  if (argv[0] !== "view") return null;
  if (argv.length === 1) return { action: "select" };
  const force = argv.includes("--reopen") || argv.includes("--open");
  const rest = argv.slice(1).filter((argument) => argument !== "--reopen" && argument !== "--open");
  if (rest[0] === "status" && rest.length === 1) return { action: "status", target: "both" };
  if (rest[0] === "stop" && rest.length <= 2) {
    const target = rest[1] ?? "both";
    if (VIEWER_TARGETS.includes(target)) return { action: "stop", target };
  }
  if (rest[0] === "open" && rest.length <= 2) {
    const target = rest[1] ?? "both";
    if (VIEWER_TARGETS.includes(target)) return { action: "start", target, force: true };
  }
  if (VIEWER_TARGETS.includes(rest[0]) && rest.length === 1) {
    return force
      ? { action: "start", target: rest[0], force: true }
      : { action: "start", target: rest[0] };
  }
  throw new BenchError("Usage: bench view [inspect|visual|both|open [inspect|visual|both]|status|stop [inspect|visual|both]] [--reopen]");
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

// Bench never reopens a viewer it already surfaced inside the reopen window.
// Saying so is more useful than silently spawning another browser tab.
export function viewerOpenLine(result) {
  return result.opened
    ? `${result.label}: opened · ${result.url}`
    : `${result.label}: already open, not reopening · ${result.url} (use --reopen to force)`;
}

export function viewerReceiptLines(results) {
  return results.map((result) => {
    const ownership = result.owned ? "Bench-owned" : result.health === "healthy" ? "external" : "not managed";
    return `${result.label}: ${result.health} · ${ownership} · ${result.url}`;
  });
}

export async function viewerStatuses(manager, target = "both") {
  try {
    return await manager.status(target);
  } catch {
    return [];
  }
}

function hubViewerId(target) {
  return target === "both" ? VIEWER_IDS.visual : target;
}

export function viewerMenuChoices(statuses, options = {}) {
  const byId = Object.fromEntries(statuses.map((status) => [status.id, status]));
  const owned = statuses.filter((status) => status.owned);
  const describe = (status) => status
    ? `${status.health}${status.owned ? " · Bench-owned" : ""}${status.pid ? ` · PID ${status.pid}` : ""} · ${status.url}`
    : "status unavailable";
  return [
    {
      action: "open",
      target: VIEWER_IDS.inspect,
      label: byId.inspect?.health === "healthy" ? "Open Inspect results" : "Start Inspect results",
      detail: describe(byId.inspect),
    },
    {
      action: "open",
      target: VIEWER_IDS.visual,
      label: byId.visual?.health === "healthy" ? "Open Visual results" : "Start Visual results",
      detail: describe(byId.visual),
    },
    { action: "open", target: "both", label: "Open both viewers", detail: "Start both and open Visual as the hub" },
    ...owned.map((status) => ({ action: "stop", target: status.id, label: `Stop ${status.label}`, detail: describe(status) })),
    ...(owned.length > 1
      ? [{ action: "stop", target: "both", label: "Stop all Bench-owned viewers", detail: "Stop both validated process groups" }]
      : []),
    ...(options.standalone
      ? [{ action: "quit", label: "Quit", detail: "Return to the terminal" }]
      : [{ action: "back", label: "Back to Bench", detail: "Return to the previous step" }]),
  ];
}

// Shared results surface. `standalone` performs one action and returns to the
// terminal; the main flow loops until the user goes back.
export async function runResultsMenu(ui, manager, options = {}) {
  const standalone = options.standalone ?? false;
  while (true) {
    const statuses = await viewerStatuses(manager);
    const selected = selectedOrCancel(await ui.select(viewerMenuChoices(statuses, { standalone }), {
      step: "Results",
      context: standalone ? undefined : "Available before or after a run",
      title: "Results viewers",
      message: "Bench reuses matching viewers, refuses unknown applications, and never reopens one it already surfaced.",
      label: (item) => item.label,
      summary: (item) => item.detail,
      details: () => (statuses.length > 0 ? statuses.map(viewerStatusLine) : ["Viewer status is unavailable."]),
      compact: true,
      allowBack: true,
    }));
    if (selected === BACK || selected.action === "back" || selected.action === "quit") return;

    if (selected.action === "stop") {
      ui.showLoading("Stopping viewers…");
      const results = await manager.stop(selected.target);
      if (standalone) {
        ui.stop({ preserveScreen: true });
        results.forEach((result) => console.log(viewerActionLine(result)));
        return;
      }
      ui.flash(results.map(viewerActionLine).join("   "));
      continue;
    }

    ui.showLoading(selected.target === "both" ? "Starting viewers…" : "Starting viewer…");
    const results = await manager.start(selected.target);
    const opened = await manager.open(hubViewerId(selected.target), { force: true });
    if (standalone) {
      ui.stop({ preserveScreen: true });
      results.forEach((result) => console.log(viewerActionLine(result)));
      console.log(viewerOpenLine(opened));
      return;
    }
    ui.flash(viewerOpenLine(opened));
  }
}

async function startAndOpenViewers(manager, target, options = {}) {
  const results = await manager.start(target);
  results.forEach((result) => console.log(viewerActionLine(result)));
  const opened = await manager.open(hubViewerId(target), { force: options.force });
  console.log(viewerOpenLine(opened));
  return results;
}

async function runViewerSelector(manager) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new BenchError("`bench view` without a target requires an interactive terminal");
  }
  const ui = new BenchUI();
  ui.start();
  try {
    await runResultsMenu(ui, manager, { standalone: true });
  } finally {
    ui.stop({ preserveScreen: true });
  }
}

export async function runViewCommand(cwd, command, dependencies = {}) {
  const manager = (dependencies.createViewerManager ?? createViewerManagerFor)(cwd);
  if (command.action === "select") return runViewerSelector(manager);
  if (command.action === "start") return startAndOpenViewers(manager, command.target, { force: command.force });
  const results = command.action === "status"
    ? await manager.status(command.target)
    : await manager.stop(command.target);
  for (const result of results) {
    console.log(command.action === "status"
      ? viewerStatusLine(result)
      : viewerActionLine(result));
  }
}

// Runs after a successful benchmark. Never prompts and never throws: a viewer
// problem must not turn a completed run into a failure.
export async function openViewersAfterRun(cwd, target, options = {}) {
  const manager = options.manager ?? createViewerManagerFor(cwd);
  try {
    const results = await manager.start(target);
    const opened = await manager.open(hubViewerId(target), { force: options.force ?? false });
    return { results, opened, error: null };
  } catch (error) {
    return { results: [], opened: null, error };
  }
}

// Prints the full two-viewer state so a finished run always ends with the same
// answer to "what is running and where do I look?".
export function printViewerSummary(statuses) {
  console.log("  Results viewers");
  if (statuses.length === 0) {
    console.log("    Status unavailable.");
    return;
  }
  for (const status of statuses) console.log(`    ${viewerStatusLine(status)}`);
}
