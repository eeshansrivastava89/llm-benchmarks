import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { BenchError } from "./errors.mjs";
import { openExternalUrl } from "./open-url.mjs";
import { BenchUI, selectedOrCancel } from "./ui/bench-ui.mjs";

const REPORT_SCRIPT = fileURLToPath(new URL("../scripts/build_benchmark_report.py", import.meta.url));

const USAGE = "Usage: bench report | bench report variants | bench report --model <name> --variant <provider/model> [--variant <provider/model> ...] [--output <directory>]";

export function parseReportCommand(argv) {
  if (argv[0] !== "report") return null;
  if (argv.length === 1) return { action: "select" };
  if (argv.length === 2 && argv[1] === "variants") return { action: "variants" };

  let model = null;
  let output = null;
  const variants = [];
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--model" && value && !value.startsWith("--")) {
      model = value;
      index += 1;
    } else if (argument === "--variant" && value && !value.startsWith("--")) {
      variants.push(value);
      index += 1;
    } else if (argument === "--output" && value && !value.startsWith("--")) {
      output = value;
      index += 1;
    } else {
      throw new BenchError(USAGE);
    }
  }
  if (!model || variants.length === 0) throw new BenchError(USAGE);
  return { action: "build", model, variants, output };
}

function reportArgs(cwd, command) {
  const args = ["run"];
  if (command.action !== "variants") args.push("--group", "report");
  args.push("python", REPORT_SCRIPT, "--repository-root", cwd);
  if (command.action === "variants") {
    args.push("--list-variants");
  } else {
    args.push("--model", command.model);
    for (const variant of command.variants) args.push("--variant", variant);
    if (command.output) args.push("--output", command.output);
  }
  return args;
}

// mode: "inherit" streams straight to the terminal, "buffer" collects output
// without printing it (machine-readable discovery), and "tee" prints while
// collecting so the generated report can be opened afterward.
function invokeReport(cwd, command, dependencies = {}, mode = "inherit") {
  const spawnProcess = dependencies.spawnProcess ?? spawn;
  const piped = mode === "buffer" || mode === "tee";
  return new Promise((resolvePromise, reject) => {
    const child = spawnProcess("uv", reportArgs(cwd, command), {
      cwd,
      stdio: piped ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (piped) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (mode === "tee") process.stdout.write(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        if (mode === "tee") process.stderr.write(chunk);
      });
    }
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(new BenchError("Required command not found: uv"));
      } else {
        reject(new BenchError(`Could not start report builder: ${error.message}`));
      }
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolvePromise(stdout);
      } else {
        const detail = piped && stderr.trim() ? `\n${stderr.trim()}` : "";
        reject(new BenchError(signal
          ? `Report builder was terminated by ${signal}${detail}`
          : `Report builder failed with exit code ${code}${detail}`));
      }
    });
  });
}

function reportIndexPath(stdout) {
  const match = /^Report: (.+)$/m.exec(stdout ?? "");
  return match ? match[1].trim() : null;
}

// The report is a standalone file, so finishing a build should land the user on
// it instead of asking them to copy a path out of the terminal.
async function openReport(stdout, dependencies = {}) {
  if (process.env.BENCH_NO_OPEN === "1") return;
  const index = reportIndexPath(stdout);
  if (!index) return;
  try {
    await (dependencies.openUrl ?? openExternalUrl)(index);
  } catch (error) {
    console.error(`Warning: could not open ${index}: ${error.message}`);
  }
}

async function selectReport(cwd, dependencies) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new BenchError("`bench report` without options requires an interactive terminal");
  }
  const ui = new BenchUI();
  ui.start();
  try {
    ui.showLoading("Finding benchmark evidence…");
    const output = await invokeReport(cwd, { action: "variants" }, dependencies, "buffer");
    let available;
    try {
      available = JSON.parse(output);
    } catch {
      throw new BenchError("Report discovery returned invalid JSON");
    }
    if (!Array.isArray(available) || available.length === 0) {
      throw new BenchError("No Inspect logs or Visual runs were found");
    }

    const selected = [];
    while (selected.length < available.length) {
      const choices = available
        .filter((variant) => !selected.some((item) => item.id === variant.id))
        .map((variant) => ({
          action: "add",
          ...variant,
          label: variant.id,
          detail: `${variant.inspectLogs} Inspect log${variant.inspectLogs === 1 ? "" : "s"} · ${variant.visualRuns} Visual run${variant.visualRuns === 1 ? "" : "s"}`,
        }));
      if (selected.length > 0) {
        choices.unshift({
          action: "build",
          id: null,
          label: `Build with ${selected.length} selected variant${selected.length === 1 ? "" : "s"}`,
          detail: selected.map((variant) => variant.id).join(" · "),
        });
      }
      const choice = selectedOrCancel(await ui.select(choices, {
        step: "Report",
        context: selected.length > 0 ? `${selected.length} selected` : "Available local evidence",
        title: selected.length > 0 ? "Add another variant or build" : "Choose the first variant",
        message: "Bench will compile every compatible Inspect and Visual result it can find.",
        label: (item) => item.label,
        summary: (item) => item.detail,
        details: (item) => [item.detail],
        searchable: true,
        searchPlaceholder: "provider or model",
        compact: true,
      }));
      if (choice.action === "build") break;
      selected.push(choice);
    }

    const firstModel = selected[0].id.slice(selected[0].id.indexOf("/") + 1);
    const title = selectedOrCancel(await ui.input({
      step: "Report",
      context: selected.map((variant) => variant.id).join(" · "),
      title: "Name this model report",
      message: "Use a model-family title; the exact deployment variants remain visible in the report.",
      initialValue: `${firstModel} benchmark report`,
      placeholder: "Qwen 3.8 27B local configurations",
      validate: (answer) => answer.trim() ? null : "Enter a report title.",
    }));

    ui.stop({ preserveScreen: true });
    const buildOutput = await invokeReport(cwd, {
      action: "build",
      model: title.trim(),
      variants: selected.map((variant) => variant.id),
      output: null,
    }, dependencies, "tee");
    await openReport(buildOutput, dependencies);
  } finally {
    ui.stop({ preserveScreen: true });
  }
}

export async function runReportCommand(cwd, command, dependencies = {}) {
  if (command.action === "select") return selectReport(cwd, dependencies);
  if (command.action === "variants") return invokeReport(cwd, command, dependencies);
  const output = await invokeReport(cwd, command, dependencies, "tee");
  await openReport(output, dependencies);
}
