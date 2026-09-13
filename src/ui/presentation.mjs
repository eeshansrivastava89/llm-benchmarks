import { truncateToWidth } from "@earendil-works/pi-tui";

const ANSI_BOLD = "\u001b[1m";
const ANSI_DIM = "\u001b[2m";
const ANSI_CYAN = "\u001b[36m";
const ANSI_GREEN = "\u001b[32m";
const ANSI_YELLOW = "\u001b[33m";
const ANSI_RED = "\u001b[31m";
const ANSI_RESET = "\u001b[0m";
const USE_COLOR = !process.env.NO_COLOR && process.env.TERM !== "dumb";
const paint = (open, value) => USE_COLOR ? `${open}${value}${ANSI_RESET}` : String(value);

export const style = {
  accent: (value) => paint(ANSI_CYAN, value),
  success: (value) => paint(ANSI_GREEN, value),
  warning: (value) => paint(ANSI_YELLOW, value),
  error: (value) => paint(ANSI_RED, value),
  muted: (value) => paint(ANSI_DIM, value),
  strong: (value) => paint(ANSI_BOLD, value),
};

export function terminalLink(url, label = url) {
  if (!USE_COLOR) return label === url ? url : `${label} (${url})`;
  return `\u001b]8;;${url}\u0007${label}\u001b]8;;\u0007`;
}

export function listTheme(isActive = () => true) {
  return {
    selectedPrefix: (text) => isActive() ? style.accent(text) : "  ",
    selectedText: (text) => isActive() ? style.accent(style.strong(text)) : text,
    description: (text) => style.muted(text),
    scrollInfo: (text) => style.muted(text),
    noMatch: (text) => style.warning(text),
  };
}

export function cleanLines(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (value === undefined || value === null || value === "") return [];
  return String(value).split("\n");
}

export function formatCount(value) {
  if (!Number.isInteger(value)) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(value);
}

export function sourceTabs(sources, activeIndex) {
  return sources.map((source, index) => {
    const label = `${index + 1} ${source.label.replace(" Inspect Evals", "")}`;
    return index === activeIndex
      ? style.accent(style.strong(`[ ${label} ]`))
      : style.muted(`  ${label}  `);
  }).join("  ");
}

export function taskWarning(task) {
  return Boolean(
    task.sweep
    && (task.sweep.result !== "passed" || task.sweep.versionMatches === false),
  );
}

export function benchmarkCategories(tasks) {
  const counts = new Map();
  for (const task of tasks) {
    const group = task.group || "Other";
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  return [
    { name: "All", count: tasks.length },
    ...[...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, count]) => ({ name, count })),
  ];
}

export function benchmarkListItem(task) {
  return {
    value: task.spec,
    label: `${taskWarning(task) ? "⚠ " : ""}${task.displayName}`,
    description: formatCount(task.sampleCount),
  };
}

export function benchmarkDetails(task) {
  if (!task) return [style.muted("No benchmark matches the current filters.")];
  const title = task.title || task.displayName;
  const sampleCount = Number.isInteger(task.sampleCount)
    ? task.sampleCount.toLocaleString("en-US")
    : "Unknown";
  const lines = [
    style.strong(title),
    style.muted(task.displayName),
    "",
    style.muted("WHAT IT TESTS"),
    task.description || "No description is published for this task.",
    "",
    style.muted("DATASET"),
    `${sampleCount} sample${task.sampleCount === 1 ? "" : "s"}  ·  ${task.params.length} configurable option${task.params.length === 1 ? "" : "s"}`,
  ];

  if (task.group) lines.push(`Category: ${task.group}`);
  if (task.source === "local") {
    lines.push("", style.accent("LOCAL TASK"), task.file);
  } else if (!task.sweep) {
    lines.push("", style.warning("○ No saved compatibility check"));
  } else if (!task.sweep.versionMatches) {
    lines.push(
      "",
      style.warning("⚠ Check is for a different Inspect Evals version"),
      `Saved ${task.sweep.inspectEvalsVersion}; installed ${task.packageVersion ?? "unknown"}.`,
    );
  } else if (task.sweep.result === "passed") {
    lines.push("", style.success("✓ Worked in the saved one-sample check"));
  } else {
    const label = task.sweep.result === "inconclusive" ? "Check was inconclusive" : "Check was blocked";
    lines.push(
      "",
      style.warning(`⚠ ${label}`),
      `Reason: ${task.sweep.category.replaceAll("_", " ")}`,
      task.sweep.diagnostic,
    );
  }

  if (task.sweep) {
    lines.push(
      "",
      style.muted("HISTORICAL CHECK"),
      style.muted(`${task.sweep.model}  ·  ${task.sweep.date}  ·  Inspect Evals ${task.sweep.inspectEvalsVersion}`),
      style.muted("Evidence from that environment only; the selected model may behave differently."),
    );
  }
  return lines;
}

export function selectorDetails(item, options) {
  const lines = cleanLines(options.details?.(item));
  return lines.length > 0 ? lines : [style.muted("Press Enter to select.")];
}

export class WorkflowHeader {
  constructor(step = "") {
    this.step = step;
  }

  render(width) {
    const match = /^(\d+)\s+(.+)$/.exec(this.step);
    if (!match) return [`${style.accent(style.strong("Bench"))}  ${style.muted(this.step)}`];
    const current = Number(match[1]);
    const names = ["Provider", "Model", "Benchmark", "Configure", "Samples", "Concurrency", "Review"];
    if (width < 140) {
      return [`${style.accent(style.strong("Bench"))}  ${style.muted(`${current}/7`)}  ${style.strong(match[2])}`];
    }
    const progress = names.map((name, index) => {
      const label = `${index + 1} ${name}`;
      return index + 1 === current ? style.accent(style.strong(label)) : style.muted(label);
    }).join(style.muted("  >  "));
    return [`${style.accent(style.strong("Bench"))}  ${progress}`];
  }

  invalidate() {}
}

export class ResponsiveHelp {
  constructor(longText, shortText) {
    this.longText = longText;
    this.shortText = shortText;
  }

  render(width) {
    const text = width < 140 ? this.shortText : this.longText;
    return [style.muted(truncateToWidth(` ${text}`, width, ""))];
  }

  invalidate() {}
}
