#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildBenchmarkSources,
  loadSweepData,
  sentenceHint,
  sweepWarningLines,
} from "../src/catalog.mjs";
import { BenchError, SelectionCancelled } from "../src/errors.mjs";
import {
  loadInteractiveBenchmarkSuites,
  loadProjectDataScienceAccess,
} from "../src/benchmark-suites.mjs";
import { executeInteractiveBenchmark, runForeground } from "../src/interactive-runner.mjs";
import { prepareLocalModelLifecycle } from "../src/local-lifecycle.mjs";
import { loadBenchPreferences, saveBenchPreferences } from "../src/preferences.mjs";
import {
  MODEL_DISCOVERY_TIMEOUT_MS,
  annotateProviderBackends,
  classifyBackend,
  discoverModels,
  groupModels,
  probeTcp,
} from "../src/providers.mjs";
import {
  buildInspectInvocation,
  formatCommand,
  formatSampleCount,
  hasInspectOption,
  inspectOptionValue,
  localConcurrencyChoices,
  sampleChoices,
} from "../src/run-plan.mjs";
import { BACK, CANCEL, BenchUI, benchUiStyle } from "../src/ui/bench-ui.mjs";
import { taskWarning, terminalLink } from "../src/ui/presentation.mjs";
import {
  createViewerManager,
  VIEWER_IDS,
} from "../src/viewers.mjs";
import {
  BENCHMARK_SUITE_IDS,
  buildInteractiveReview,
  buildSuiteChoices,
  interactiveBenchmarkDetails,
  suitePassthroughError,
  updateSuitePreferences,
} from "../src/suite-workflow.mjs";

function selectedOrCancel(result) {
  if (result === CANCEL) throw new SelectionCancelled();
  return result;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function setupAdvice(error) {
  const message = errorMessage(error);
  if (/Required command not found: uv|uv unavailable/i.test(message)) {
    return "Install uv, then return here and choose Retry.";
  }
  if (/no authenticated models|No authentication|\/login/i.test(message)) {
    return "Open Pi, run /login, then return here and choose Retry.";
  }
  if (/Interactive write confinement is (?:unavailable|not supported)/i.test(message)) {
    return process.platform === "linux"
      ? "Install Bubblewrap and enable unprivileged user namespaces, then choose Retry."
      : "Interactive runs require the macOS Seatbelt launcher or Linux Bubblewrap.";
  }
  if (/custom task root.*not found/i.test(message)) {
    return "Fix [tool.bench].custom-task-roots in pyproject.toml, then choose Retry.";
  }
  if (/configuration errors/i.test(message)) {
    return "Fix the reported Pi configuration issue, then choose Retry.";
  }
  return "Correct the reported setup issue, then choose Retry.";
}

function passthroughArgs(argv) {
  if (argv.length === 0) return [];
  if (argv[0] !== "--") {
    throw new BenchError("Inspect options must follow `--`, for example: bench -- --limit 20");
  }
  return argv.slice(1);
}

async function loadConfig(cwd) {
  const configPath = resolve(cwd, "pyproject.toml");
  let source;

  try {
    source = await readFile(configPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new BenchError(`Missing configuration: ${configPath}`);
    }
    throw new BenchError(`Could not read ${configPath}: ${errorMessage(error)}`);
  }

  let parse;
  try {
    ({ parse } = await import("smol-toml"));
  } catch (error) {
    throw new BenchError(`TOML parser unavailable. Run \`npm install\`. (${errorMessage(error)})`);
  }

  let document;
  try {
    document = parse(source);
  } catch (error) {
    throw new BenchError(`Invalid ${configPath}: ${errorMessage(error)}`);
  }

  const config = document.tool?.bench;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new BenchError(`Missing [tool.bench] in ${configPath}`);
  }

  const customTaskRoots = config["custom-task-roots"];
  if (
    !Array.isArray(customTaskRoots) ||
    customTaskRoots.some((root) => typeof root !== "string" || root.length === 0)
  ) {
    throw new BenchError("[tool.bench].custom-task-roots must be an array of paths");
  }
  if (customTaskRoots.some(isAbsolute)) {
    throw new BenchError("[tool.bench].custom-task-roots must be relative to the project directory");
  }

  const logDir = config["log-dir"];
  if (typeof logDir !== "string" || logDir.length === 0) {
    throw new BenchError("[tool.bench].log-dir must be a non-empty path");
  }

  const taskConfigDir = config["task-config-dir"] ?? "bench-configs";
  if (typeof taskConfigDir !== "string" || taskConfigDir.length === 0 || isAbsolute(taskConfigDir)) {
    throw new BenchError("[tool.bench].task-config-dir must be a non-empty relative path");
  }

  const missingRoots = [];
  await Promise.all(
    customTaskRoots.map(async (root) => {
      try {
        await access(resolve(cwd, root));
      } catch {
        missingRoots.push(root);
      }
    }),
  );
  if (missingRoots.length > 0) {
    throw new BenchError(`Configured custom task root${missingRoots.length === 1 ? "" : "s"} not found: ${missingRoots.sort().join(", ")}`);
  }

  return { customTaskRoots, logDir, taskConfigDir };
}

const activeCapturedChildren = new Set();

function stopActiveCapturedChildren() {
  for (const child of activeCapturedChildren) child.kill("SIGTERM");
  activeCapturedChildren.clear();
}

function runCaptured(command, args, cwd, env = process.env, failureLabel = "Command failed") {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeCapturedChildren.add(child);
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(new BenchError(`Required command not found: ${command}`));
        return;
      }
      reject(new BenchError(`Could not start ${command}: ${errorMessage(error)}`));
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }
      const detail = stderr.trim() || stdout.trim() || (signal ? `terminated by ${signal}` : `exit code ${code}`);
      reject(new BenchError(`${failureLabel}:\n${detail}`));
    });
  });
}

async function discoverTasks(cwd, taskRoots, options = {}) {
  const output = await runCaptured(
    options.uvCommand ?? "uv",
    ["run", "inspect", "list", "tasks", "--json", "--", ...taskRoots],
    cwd,
    options.env,
    "Inspect task discovery failed",
  );

  let tasks;
  try {
    tasks = JSON.parse(output);
  } catch (error) {
    throw new BenchError(`Inspect returned invalid JSON: ${errorMessage(error)}`);
  }
  if (
    !Array.isArray(tasks) ||
    tasks.some((task) => !task || typeof task !== "object" || typeof task.name !== "string" || typeof task.file !== "string")
  ) {
    throw new BenchError("Inspect returned an unexpected task listing");
  }
  if (tasks.length === 0 && !options.allowEmpty) {
    throw new BenchError(`Inspect found no benchmarks in: ${taskRoots.join(", ")}`);
  }

  return tasks.sort((left, right) => left.name.localeCompare(right.name) || left.file.localeCompare(right.file));
}

const REGISTRY_DISCOVERY_SCRIPT = `
import json
from importlib.metadata import PackageNotFoundError, version
from inspect_ai._util.registry import registry_find, registry_info
from inspect_evals.metadata import load_listing

listing = load_listing()
try:
    inspect_evals_version = version("inspect-evals")
except PackageNotFoundError:
    inspect_evals_version = None

tasks = []
for component in registry_find(lambda info: info.type == "task"):
    info = registry_info(component)
    title = None
    description = None
    group = None
    eval_id = None
    sample_count = None
    package_version = None
    if info.name.startswith("inspect_evals/"):
        package_version = inspect_evals_version
        task_name = info.name.split("/", 1)[1]
        eval_metadata, task_metadata = listing.find_task(task_name)
        if eval_metadata is None:
            module_parts = component.__module__.split(".")
            if len(module_parts) > 1 and module_parts[0] == "inspect_evals":
                eval_metadata = listing.get_eval(module_parts[1])
        if eval_metadata is not None:
            eval_id = eval_metadata.id
            title = eval_metadata.title
            description = (task_metadata.comment if task_metadata else None) or eval_metadata.description
            group = str(eval_metadata.group)
            sample_count = task_metadata.dataset_samples if task_metadata else None
    tasks.append({
        "name": info.name,
        "attribs": info.metadata.get("attribs", {}),
        "params": info.metadata.get("params", []),
        "title": title,
        "description": description,
        "group": group,
        "evalId": eval_id,
        "sampleCount": sample_count,
        "packageVersion": package_version,
    })
print(json.dumps(tasks))
`;

async function discoverRegisteredTasks(cwd, options = {}) {
  const output = await runCaptured(
    options.uvCommand ?? "uv",
    ["run", "python", "-c", REGISTRY_DISCOVERY_SCRIPT],
    cwd,
    options.env,
    "Inspect registry discovery failed",
  );

  let tasks;
  try {
    tasks = JSON.parse(output);
  } catch (error) {
    throw new BenchError(`Inspect registry returned invalid JSON: ${errorMessage(error)}`);
  }
  if (
    !Array.isArray(tasks)
    || tasks.some((task) => (
      !task
      || typeof task.name !== "string"
      || !Array.isArray(task.params)
      || task.params.some((parameter) => typeof parameter !== "string")
      || (task.description !== null && typeof task.description !== "string")
      || (task.group !== null && typeof task.group !== "string")
      || (task.evalId !== null && typeof task.evalId !== "string")
      || (task.sampleCount !== null && (!Number.isInteger(task.sampleCount) || task.sampleCount < 0))
      || (task.packageVersion !== null && typeof task.packageVersion !== "string")
    ))
  ) {
    throw new BenchError("Inspect returned an unexpected registry listing");
  }

  return tasks.map((task) => {
    const separator = task.name.indexOf("/");
    const source = separator === -1 ? "installed" : task.name.slice(0, separator);
    return {
      ...task,
      source,
      sourceLabel: source === "inspect_evals" ? "Inspect Evals" : source,
      displayName: separator === -1 ? task.name : task.name.slice(separator + 1),
      spec: task.name,
    };
  });
}

const TASK_CONFIG_TEMPLATE_SCRIPT = `
import enum
import hashlib
import inspect
import json
import sys
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

import yaml
from inspect_ai._util.registry import registry_find, registry_info


def find_task(name):
    for component in registry_find(lambda info: info.type == "task"):
        if registry_info(component).name == name:
            return component
    raise ValueError(f"Registered task not found: {name}")


def yaml_value(value):
    if value is None or isinstance(value, (str, bool, int, float)):
        return True, value
    if isinstance(value, enum.Enum):
        return yaml_value(value.value)
    if isinstance(value, Path):
        return True, str(value)
    if isinstance(value, list):
        converted = []
        for item in value:
            safe, item = yaml_value(item)
            if not safe:
                return False, None
            converted.append(item)
        return True, converted
    if isinstance(value, dict) and all(isinstance(key, str) for key in value):
        converted = {}
        for key, item in value.items():
            safe, item = yaml_value(item)
            if not safe:
                return False, None
            converted[key] = item
        return True, converted
    return False, None


def describe(value):
    if callable(value):
        module = getattr(value, "__module__", type(value).__module__)
        name = getattr(value, "__qualname__", getattr(value, "__name__", type(value).__qualname__))
        return f"{module}.{name}"
    text = repr(value).replace("\\n", " ")
    return text if len(text) <= 240 else text[:237] + "..."


def annotation_text(parameter):
    if parameter.annotation is inspect.Parameter.empty:
        return "Any"
    return inspect.formatannotation(parameter.annotation)


task_name = sys.argv[1]
eval_id = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None
component = find_task(task_name)
signature = inspect.signature(component)
try:
    package_version = version("inspect-evals") if task_name.startswith("inspect_evals/") else None
except PackageNotFoundError:
    package_version = None

signature_data = []
for parameter in signature.parameters.values():
    default = "<required>" if parameter.default is inspect.Parameter.empty else describe(parameter.default)
    signature_data.append([parameter.name, annotation_text(parameter), default, str(parameter.kind)])
signature_hash = hashlib.sha256(json.dumps(signature_data, sort_keys=True).encode()).hexdigest()[:16]

header = [
    "# Generated by bench from the installed task source.",
    "# Edit values to override the task's official defaults.",
    "# This file is passed directly to Inspect with --task-config.",
    f"# bench-template-version: 1",
    f"# task: {task_name}",
    f"# package: {'inspect-evals' if package_version else 'unknown'}",
    f"# package-version: {package_version or 'unknown'}",
    f"# signature: {signature_hash}",
]
if eval_id:
    header.extend([
        "#",
        f"# Benchmark documentation: https://ukgovernmentbeis.github.io/inspect_evals/evals/{eval_id}/",
    ])
if package_version and eval_id:
    header.append(f"# Installed-version source: https://github.com/UKGovernmentBEIS/inspect_evals/blob/v{package_version}/src/inspect_evals/{eval_id}/README.md")
header.extend([
    "# Inspect task parameters: https://inspect.aisi.org.uk/tasks.html#parameters",
    "",
])

body = []
active = 0
for parameter in signature.parameters.values():
    annotation = annotation_text(parameter)
    body.append(f"# {parameter.name}")
    body.append(f"# Type: {annotation}")
    if parameter.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
        body.append("# Variadic parameters are omitted from generated task configs.")
        body.append("")
        continue
    if parameter.default is inspect.Parameter.empty:
        body.append("# Required parameter: replace the commented line below with a value.")
        body.append(f"# {parameter.name}: null")
        body.append("")
        continue
    safe, value = yaml_value(parameter.default)
    if safe:
        body.append(f"# Official default: {describe(parameter.default)}")
        body.append(yaml.safe_dump({parameter.name: value}, sort_keys=False, allow_unicode=True).strip())
        active += 1
    else:
        body.append(f"# Official default: {describe(parameter.default)}")
        body.append("# Omitted because this runtime Python value cannot be represented safely in YAML.")
    body.append("")

if active == 0:
    body.append("{}")
    body.append("")

content = "\\n".join(header + body).rstrip() + "\\n"
print(json.dumps({"content": content, "signature": signature_hash, "packageVersion": package_version}))
`;

const TASK_CONFIG_VALIDATE_SCRIPT = `
import inspect
import sys
import yaml
from inspect_ai._util.registry import registry_find, registry_info

try:
    task_name, path = sys.argv[1], sys.argv[2]
    component = next(
        component
        for component in registry_find(lambda info: info.type == "task")
        if registry_info(component).name == task_name
    )
    with open(path, encoding="utf-8") as stream:
        config = yaml.safe_load(stream)
    if not isinstance(config, dict):
        raise ValueError("task config must contain a YAML mapping")
    signature = inspect.signature(component)
    accepts_extra = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in signature.parameters.values())
    unknown = sorted(set(config) - set(signature.parameters))
    if unknown and not accepts_extra:
        raise ValueError("unknown task parameter" + ("s" if len(unknown) != 1 else "") + ": " + ", ".join(unknown))
except Exception as error:
    print(str(error), file=sys.stderr)
    raise SystemExit(1)
`;

function safePathPart(value) {
  const normalized = String(value).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "task";
}

function taskConfigPath(cwd, configDir, task) {
  return resolve(cwd, configDir, safePathPart(task.source), `${safePathPart(task.displayName)}.yaml`);
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw new BenchError(`Could not access ${path}: ${errorMessage(error)}`);
  }
}

async function taskConfigMetadata(path) {
  const source = await readFile(path, "utf8");
  return {
    packageVersion: source.match(/^# package-version: (.+)$/m)?.[1] ?? null,
    signature: source.match(/^# signature: (.+)$/m)?.[1] ?? null,
  };
}

async function generateTaskConfigTemplate(cwd, task, options = {}) {
  if (!task.spec || !Array.isArray(task.params) || task.params.length === 0) {
    throw new BenchError(`No configurable task parameters were discovered for ${task.displayName}`);
  }
  const output = await runCaptured(
    options.uvCommand ?? "uv",
    ["run", "python", "-c", TASK_CONFIG_TEMPLATE_SCRIPT, task.spec, task.evalId ?? ""],
    cwd,
    options.env,
    "Task config generation failed",
  );
  try {
    const template = JSON.parse(output);
    if (!template || typeof template.content !== "string" || typeof template.signature !== "string") {
      throw new Error("unexpected template result");
    }
    return template;
  } catch (error) {
    throw new BenchError(`Task config generator returned invalid JSON: ${errorMessage(error)}`);
  }
}

async function validateTaskConfig(cwd, task, path, options = {}) {
  await runCaptured(
    options.uvCommand ?? "uv",
    ["run", "python", "-c", TASK_CONFIG_VALIDATE_SCRIPT, task.spec, path],
    cwd,
    options.env,
    `Invalid task configuration ${path}`,
  );
}

async function waitForTaskConfigEdit(cwd, task, path, ui) {
  const displayPath = relative(cwd, path);
  let validationError = null;
  while (true) {
    const selected = selectedOrCancel(await ui.select([
      {
        action: "continue",
        label: "Use the edited file",
        detail: "Validate it before continuing",
      },
      {
        action: "later",
        label: "Return without using this file",
        detail: `The file stays at ${displayPath}`,
      },
    ], {
      step: "5 Configure",
      context: `${task.displayName}  ·  ${displayPath}`,
      title: "Edit task configuration",
      message: validationError
        ? `Validation failed: ${validationError}`
        : `Edit ${path} in another terminal or editor, then return here.`,
      label: (item) => item.label,
      summary: (item) => item.detail,
      details: (item) => [item.detail, "", "FILE", path],
      compact: true,
      allowBack: true,
    }));
    if (selected === BACK || selected.action === "later") return false;
    try {
      await validateTaskConfig(cwd, task, path);
      return true;
    } catch (error) {
      validationError = errorMessage(error);
    }
  }
}

async function writeTaskConfig(cwd, config, task, { replace = false } = {}) {
  const path = taskConfigPath(cwd, config.taskConfigDir, task);
  const existed = await pathExists(path);
  if (existed && !replace) return path;

  const template = await generateTaskConfigTemplate(cwd, task);
  await mkdir(dirname(path), { recursive: true });
  if (existed) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    await copyFile(path, `${path}.bak-${timestamp}`);
  }
  await writeFile(path, template.content, "utf8");
  return path;
}

function taskDocumentation(task) {
  const links = [terminalLink("https://inspect.aisi.org.uk/tasks.html#parameters", "Inspect task parameter guide")];
  if (task.evalId) {
    links.unshift(terminalLink(
      `https://ukgovernmentbeis.github.io/inspect_evals/evals/${task.evalId}/`,
      "Inspect Evals benchmark guide",
    ));
    if (task.packageVersion) {
      links.push(terminalLink(
        `https://github.com/UKGovernmentBEIS/inspect_evals/blob/v${task.packageVersion}/src/inspect_evals/${task.evalId}/README.md`,
        "Source README for the installed version",
      ));
    }
  }
  return links;
}

async function selectTaskConfiguration(cwd, config, task, inspectPassthrough, ui, previous = null) {
  const explicit = inspectOptionValue(inspectPassthrough, "--task-config");
  if (explicit !== null) {
    return { args: [], summary: `command line · ${explicit}`, path: explicit };
  }

  if (task.source === "local") {
    return { args: [], summary: "official defaults", path: null };
  }

  const path = taskConfigPath(cwd, config.taskConfigDir, task);
  let savedValidationChecked = false;
  let savedValidationError = null;
  while (true) {
    const exists = await pathExists(path);
    if (!exists && task.params.length === 0) {
      return { args: [], summary: "official defaults", path: null };
    }
    const savedMetadata = exists ? await taskConfigMetadata(path) : null;
    if (exists && !savedValidationChecked) {
      ui.showLoading("Checking the saved task configuration…", relative(cwd, path));
      try {
        await validateTaskConfig(cwd, task, path);
        savedValidationError = null;
      } catch (error) {
        savedValidationError = errorMessage(error);
      }
      savedValidationChecked = true;
    }
    const versionMismatch = Boolean(
      savedMetadata?.packageVersion
      && savedMetadata.packageVersion !== "unknown"
      && task.packageVersion
      && savedMetadata.packageVersion !== task.packageVersion,
    );
    const savedItems = [
      {
        action: "saved",
        label: `${savedValidationError ? "× " : ""}Use saved configuration`,
        detail: savedValidationError
          ? "invalid · repair or regenerate it first"
          : versionMismatch
            ? `created for Inspect Evals ${savedMetadata?.packageVersion}`
            : `valid · ${relative(cwd, path)}`,
      },
      { action: "defaults", label: "Use official defaults (Recommended)", detail: "safe · ignore the saved file for this run" },
      { action: "edit", label: "Edit saved configuration", detail: relative(cwd, path) },
      ...(task.params.length > 0
        ? [{ action: "regenerate", label: "Regenerate from installed source", detail: "backs up the current file" }]
        : []),
      ...(task.evalId ? [{ action: "docs", label: "View official documentation", detail: task.evalId }] : []),
    ];
    if (versionMismatch || savedValidationError) {
      const priority = { defaults: 0, regenerate: 1, saved: 2, edit: 3, docs: 4 };
      savedItems.sort((left, right) => priority[left.action] - priority[right.action]);
    }
    const items = exists
      ? savedItems
      : [
          { action: "defaults", label: "Use official defaults (Recommended)", detail: "safe · no setup required" },
          ...(task.params.length > 0
            ? [{ action: "generate", label: "Customize advanced options", detail: `${task.params.length} available · ${task.params.join(", ")}` }]
            : []),
          ...(task.evalId ? [{ action: "docs", label: "View official documentation", detail: task.evalId }] : []),
        ];

    if (items.length === 1 && items[0].action === "defaults") {
      return { args: [], summary: "official defaults", path: null };
    }

    const selected = selectedOrCancel(await ui.select(items, {
      step: "5 Configure",
      context: task.displayName,
      title: "Task options",
      message: savedValidationError
        ? "The saved configuration is invalid. Use defaults, edit it, or regenerate it."
        : exists
          ? versionMismatch
            ? `The saved file was created for an older Inspect Evals version; installed version is ${task.packageVersion}.`
            : "A valid saved configuration is available. Defaults remain the safest choice."
          : "Defaults are safe for most runs. Customize only when you need a specific task parameter.",
      label: (item) => item.label,
      summary: (item) => typeof item.detail === "string" ? item.detail : item.detail.text,
      details: (item) => [
        item.detail,
        ...(item.action === "generate" || item.action === "regenerate"
          ? ["", "AVAILABLE PARAMETERS", ...task.params]
          : []),
        ...(item.action === "saved" && savedValidationError
          ? ["", "VALIDATION ERROR", savedValidationError]
          : []),
      ],
      compact: true,
      tone: savedValidationError || versionMismatch ? "warning" : undefined,
      isInitial: (item) => previous
        ? previous.path === path ? item.action === "saved" : previous.path === null && item.action === "defaults"
        : item.action === "defaults",
      allowBack: true,
    }));
    if (selected === BACK) return BACK;

    switch (selected.action) {
      case "defaults":
        return { args: [], summary: "official defaults", path: null };
      case "saved":
        if (savedValidationError) break;
        return { args: ["--task-config", relative(cwd, path)], summary: relative(cwd, path), path };
      case "generate":
        await writeTaskConfig(cwd, config, task);
        savedValidationChecked = false;
        if (await waitForTaskConfigEdit(cwd, task, path, ui)) {
          return { args: ["--task-config", relative(cwd, path)], summary: relative(cwd, path), path };
        }
        break;
      case "edit":
        savedValidationChecked = false;
        if (await waitForTaskConfigEdit(cwd, task, path, ui)) {
          return { args: ["--task-config", relative(cwd, path)], summary: relative(cwd, path), path };
        }
        break;
      case "regenerate":
        await writeTaskConfig(cwd, config, task, { replace: true });
        savedValidationChecked = false;
        if (await waitForTaskConfigEdit(cwd, task, path, ui)) {
          return { args: ["--task-config", relative(cwd, path)], summary: relative(cwd, path), path };
        }
        break;
      case "docs":
        selectedOrCancel(await ui.select([
          { action: "back", label: "Back to task options" },
        ], {
          step: "5 Configure",
          context: task.displayName,
          title: "Official documentation",
          message: "Click a link in supported terminals, or copy it into a browser.",
          label: (item) => item.label,
          details: () => taskDocumentation(task),
          compact: true,
          allowBack: true,
        }));
        break;
      default:
        throw new BenchError(`Unknown task configuration action: ${selected.action}`);
    }
  }
}

async function discoverBenchmarks(cwd, customTaskRoots, options = {}) {
  const [registered, custom, sweepData] = await Promise.all([
    discoverRegisteredTasks(cwd, options),
    customTaskRoots.length > 0
      ? discoverTasks(cwd, customTaskRoots, { ...options, allowEmpty: true })
      : Promise.resolve([]),
    loadSweepData(options.sweepDataPath),
  ]);
  return buildBenchmarkSources(registered, custom, sweepData);
}

async function confirmSweepWarning(task, ui) {
  const lines = sweepWarningLines(task);
  if (!lines) return true;
  const selected = selectedOrCancel(await ui.select(
    [
      { action: "back", label: "Choose another benchmark", detail: "Return to the benchmark browser" },
      { action: "continue", label: "Continue anyway", detail: "Configure and run this benchmark" },
    ],
    {
      step: "4 Benchmark",
      context: task.displayName,
      title: "Compatibility warning",
      message: lines[0],
      label: (item) => item.label,
      summary: (item) => item.detail,
      details: () => ["HISTORICAL CHECK", ...lines.slice(1)],
      compact: true,
      tone: "warning",
      allowBack: true,
    },
  ));
  return selected !== BACK && selected.action === "continue";
}

async function askPositiveInteger(ui, label, maximum = null, context = "", step = "6 Samples", initialValue = null) {
  const range = Number.isInteger(maximum) ? `1–${formatSampleCount(maximum)}` : "a positive whole number";
  const result = selectedOrCancel(await ui.input({
    step,
    context,
    title: label,
    message: `Enter ${range}.`,
    placeholder: Number.isInteger(maximum) ? `1–${maximum}` : "1 or greater",
    initialValue: initialValue === null ? "" : String(initialValue),
    allowBack: true,
    validate: (answer) => {
      const value = Number(answer.trim());
      return Number.isSafeInteger(value) && value > 0 && (maximum === null || value <= maximum)
        ? null
        : `Enter ${range}.`;
    },
  }));
  return result === BACK ? BACK : Number(result.trim());
}

async function selectSamples(task, inspectPassthrough, taskConfiguration = { path: null }, ui, previous = null) {
  const sampleId = inspectOptionValue(inspectPassthrough, "--sample-id");
  if (sampleId !== null) {
    return { args: [], limit: null, summary: `Specific sample ${sampleId} · command line`, risk: "normal" };
  }
  const explicitLimit = inspectOptionValue(inspectPassthrough, "--limit");
  if (explicitLimit !== null) {
    const numericLimit = Number(explicitLimit);
    return {
      args: [],
      limit: explicitLimit,
      summary: `${explicitLimit} sample limit · command line`,
      risk: Number.isFinite(numericLimit) && numericLimit > 100 ? "high" : "normal",
    };
  }
  if (task.sampleCount === 1) {
    return { args: [], limit: 1, summary: "Complete task · 1 sample", risk: "normal" };
  }

  const choices = sampleChoices(task.sampleCount);
  const presetLimits = new Set(choices.filter(({ action }) => action === "limit").map(({ limit }) => limit));
  const selected = selectedOrCancel(await ui.select(choices, {
    step: "6 Samples",
    context: task.displayName,
    title: "Sample budget",
    message: Number.isInteger(task.sampleCount)
      ? taskConfiguration.path
        ? `${formatSampleCount(task.sampleCount)} samples with defaults; the task config may reduce this.`
        : `${formatSampleCount(task.sampleCount)} samples with official defaults.`
      : "This task does not publish an exact sample count.",
    label: (choice) => choice.label,
    summary: (choice) => choice.detail,
    details: (choice) => [
      choice.detail,
      ...(choice.action === "limit"
        ? ["", "REPEATABILITY", "Bench uses the same random subset on repeated runs.", "Advanced: sample shuffle seed 42"]
        : []),
      ...(choice.action === "all"
        ? ["", "CAUTION", "Runtime and provider usage depend on the task and model."]
        : []),
    ],
    compact: true,
    isInitial: (choice) => previous
      ? choice.action === "all"
        ? previous.limit === null
        : choice.action === "custom"
          ? previous.limit !== null && !presetLimits.has(previous.limit)
          : choice.limit === previous.limit
      : choice.limit === 1,
    allowBack: true,
  }));
  if (selected === BACK) return BACK;

  const limit = selected.action === "custom"
    ? await askPositiveInteger(ui, "Sample count", task.sampleCount, task.displayName, "6 Samples", previous?.limit ?? null)
    : selected.limit;
  if (limit === BACK) return BACK;
  if (limit === null) {
    return {
      args: [],
      limit,
      summary: Number.isInteger(task.sampleCount)
        ? `Full dataset · ${formatSampleCount(task.sampleCount)} sample${task.sampleCount === 1 ? "" : "s"}`
        : "No sample limit · dataset size unknown",
      risk: !Number.isInteger(task.sampleCount) || task.sampleCount > 100 ? "high" : "normal",
    };
  }

  const usesCommandLineShuffle = hasInspectOption(inspectPassthrough, "--sample-shuffle");
  const shuffleArgs = usesCommandLineShuffle ? [] : ["--sample-shuffle", "42"];
  const sampling = usesCommandLineShuffle ? "sampling order from command line" : "shuffled, seed 42";
  const runLabel = selected.action === "custom" ? "Custom run" : selected.label.split(" · ")[0];
  return {
    args: [...shuffleArgs, "--limit", String(limit)],
    limit,
    summary: Number.isInteger(task.sampleCount)
      ? `${runLabel} · ${formatSampleCount(limit)} of ${formatSampleCount(task.sampleCount)} · same random subset`
      : `${runLabel} · ${formatSampleCount(limit)} sample${limit === 1 ? "" : "s"} maximum · same random subset`,
    detail: sampling,
    risk: limit > 100 ? "high" : "normal",
  };
}

async function selectConcurrency(model, inspectPassthrough, ui, previous = null) {
  if (model.backend.location !== "local") return null;

  const explicitMaximum = inspectOptionValue(inspectPassthrough, "--max-connections");
  if (explicitMaximum !== null) {
    return {
      args: [],
      connections: explicitMaximum,
      summary: `${explicitMaximum} request${explicitMaximum === "1" ? "" : "s"} at a time · command line`,
    };
  }
  const explicitAdaptive = inspectOptionValue(inspectPassthrough, "--adaptive-connections");
  if (explicitAdaptive !== null) {
    return {
      args: [],
      connections: null,
      summary: `adaptive ${explicitAdaptive} · command line`,
    };
  }

  const selected = selectedOrCancel(await ui.select(localConcurrencyChoices(), {
    step: "7 Concurrency",
    context: `${model.provider}/${model.id}  ·  local model`,
    title: "Request concurrency",
    message: "More parallel requests can finish sooner, but they use more memory. Choose Safe if unsure.",
    label: (choice) => choice.label,
    summary: (choice) => choice.detail,
    details: (choice) => [
      choice.detail,
      "",
      `REQUESTS AT ONCE: ${choice.connections ?? "decided by Inspect"}`,
      ...(choice.action === "adaptive" ? ["", "CAUTION", "Inspect may choose a high value for one local server."] : []),
    ],
    compact: true,
    isInitial: (choice) => previous
      ? previous.connections === null
        ? choice.action === "adaptive"
        : [1, 2, 4, 8].includes(previous.connections)
          ? choice.action === "static" && choice.connections === previous.connections
          : choice.action === "custom"
      : choice.connections === 1,
    allowBack: true,
  }));
  if (selected === BACK) return BACK;
  if (selected.action === "adaptive") {
    return { args: [], connections: null, summary: "Inspect decides · advanced" };
  }
  const connections = selected.action === "custom"
    ? await askPositiveInteger(ui, "Maximum requests at once", null, `${model.provider}/${model.id}`, "7 Concurrency", previous?.connections ?? null)
    : selected.connections;
  if (connections === BACK) return BACK;
  const intent = selected.action === "custom" ? "Custom" : selected.label.split(" · ")[0];
  return {
    args: ["--max-connections", String(connections)],
    connections,
    summary: `${intent} · ${connections} request${connections === 1 ? "" : "s"} at a time`,
  };
}

function formatTokens(tokens) {
  if (!Number.isFinite(tokens)) return "unknown";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}m`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(tokens % 1_000 === 0 ? 0 : 1)}k`;
  return String(tokens);
}

function apiLabel(api) {
  return {
    "openai-completions": "OpenAI Chat",
    "openai-responses": "OpenAI Responses",
    "anthropic-messages": "Anthropic Messages",
    "google-generative-ai": "Google GenAI",
  }[api] ?? api;
}

function detailHeading(value) {
  return benchUiStyle.muted(value);
}

function providerStatus(provider) {
  const { backend } = provider;
  if (backend.location === "local") {
    return backend.status === "online"
      ? benchUiStyle.success("● Local · server online")
      : backend.status === "offline"
        ? benchUiStyle.error("× Local · server offline")
        : benchUiStyle.warning("○ Local · server status unknown");
  }
  if (backend.location === "cloud") return "Cloud · remote API";
  return "Mixed or unknown location";
}

function providerDetails(provider) {
  const { backend, models } = provider;
  const lines = [
    provider.provider,
    "",
    detailHeading("WHERE IT RUNS"),
    providerStatus(provider),
    "",
  ];
  if (backend.location === "local") {
    lines.push(
      backend.status === "online"
        ? "The server is reachable from this machine."
        : "Start the local model server before running a benchmark.",
      "Speed and memory use depend on your hardware.",
    );
  } else {
    lines.push(
      "Requests are sent to a remote provider.",
      "Provider pricing, limits, and data policies apply.",
    );
  }
  lines.push("", detailHeading("AVAILABLE MODELS"), String(models.length));
  return lines;
}

function modelCompatibility(modelRuntime, model) {
  if (modelRuntime.isUsingSubscription(model.provider)) {
    return { ready: false, short: "subscription login", reason: "Subscription login is not supported by Inspect" };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(model.provider)) {
    return { ready: false, short: "provider ID", reason: "Provider ID cannot be passed to Inspect" };
  }
  if (!["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"].includes(model.api)) {
    return { ready: false, short: "unsupported API", reason: `Unsupported API format: ${model.api}` };
  }
  if (model.api === "anthropic-messages" && ["azure", "bedrock", "vertex"].includes(model.provider)) {
    return { ready: false, short: "adapter required", reason: "This Anthropic service needs a dedicated adapter" };
  }
  if (model.api === "google-generative-ai" && model.id.includes("/")) {
    return { ready: false, short: "model ID", reason: "This Google model ID cannot be passed to Inspect" };
  }
  if (model.backend?.location === "local" && model.backend.status === "offline") {
    return { ready: false, short: "server offline", reason: "Local server is offline" };
  }
  return { ready: true, short: "ready", reason: "Ready for Inspect" };
}

function modelPiReady(model) {
  return model.backend?.location !== "local" || model.backend.status !== "offline";
}

function modelDetails(choice) {
  const { model, compatibility, piReady = true } = choice;
  const lines = [
    model.name || model.id,
    !piReady
      ? benchUiStyle.error("× Local server is offline")
      : compatibility.ready
        ? benchUiStyle.success("✓ Pi + Inspect")
        : benchUiStyle.success("✓ Available through Pi"),
    ...(!compatibility.ready && piReady
      ? [benchUiStyle.warning(`Inspect: ${compatibility.reason}`)]
      : []),
    "",
    detailHeading("CAPABILITIES"),
    `Input: ${model.input.includes("image") ? "Text and images" : "Text"}`,
    `Reasoning: ${model.reasoning ? "Supported" : "Not advertised"}`,
    "",
    detailHeading("MAXIMUM INPUT"),
    `${formatTokens(model.contextWindow)} tokens`,
    "How much information the model can consider at once.",
    "",
    detailHeading("WHERE IT RUNS"),
    model.backend.location === "local"
      ? `${model.backend.status === "online" ? "●" : "×"} This machine · server ${model.backend.status}`
      : "Cloud · requests go to the provider",
    "",
    detailHeading("ADVANCED"),
    `Model ID: ${model.id}`,
    `API format: ${apiLabel(model.api)}`,
  ];
  return lines;
}

function providerIdForInspect(provider) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(provider)) {
    throw new BenchError(`Provider "${provider}" cannot be represented as an Inspect service name`);
  }
  return provider;
}

async function resolveInspectModel(modelRuntime, model) {
  if (modelRuntime.isUsingSubscription(model.provider)) {
    throw new BenchError(`Subscription-backed provider "${model.provider}" is not supported by Inspect yet`);
  }

  let resolution;
  try {
    resolution = await modelRuntime.getAuth(model, {
      signal: AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS),
    });
  } catch (error) {
    throw new BenchError(`Could not resolve authentication for ${model.provider}/${model.id}: ${errorMessage(error)}`);
  }
  if (!resolution) {
    throw new BenchError(`No authentication is available for ${model.provider}/${model.id}`);
  }

  const headerNames = Object.keys(resolution.auth.headers ?? {});
  if (headerNames.length > 0) {
    throw new BenchError(`Model requires headers that Inspect cannot safely receive yet: ${headerNames.join(", ")}`);
  }
  const envNames = Object.keys(resolution.env ?? {});
  if (envNames.length > 0) {
    throw new BenchError(`Provider requires configuration that Inspect cannot translate yet: ${envNames.join(", ")}`);
  }
  if (!resolution.auth.apiKey) {
    throw new BenchError(`Model authentication cannot be represented as an Inspect API key: ${model.provider}/${model.id}`);
  }

  const baseUrl = resolution.auth.baseUrl ?? model.baseUrl;
  if (!baseUrl) {
    throw new BenchError(`Pi did not provide an endpoint for ${model.provider}/${model.id}`);
  }

  let inspectModel;
  let apiKeyEnv;
  let modelArgs = {};
  const childEnv = {
    ...process.env,
    INSPECT_API_KEY_OVERRIDE: "",
  };

  switch (model.api) {
    case "openai-completions":
    case "openai-responses": {
      const service = providerIdForInspect(model.provider);
      inspectModel = `openai-api/${service}/${model.id}`;
      apiKeyEnv = `${service.toUpperCase().replaceAll("-", "_")}_API_KEY`;
      modelArgs = { responses_api: model.api === "openai-responses" };
      break;
    }
    case "anthropic-messages": {
      const service = providerIdForInspect(model.provider);
      if (["azure", "bedrock", "vertex"].includes(service)) {
        throw new BenchError(`Anthropic service name "${service}" requires a dedicated compatibility adapter`);
      }
      inspectModel = `anthropic/${service}/${model.id}`;
      apiKeyEnv = "ANTHROPIC_API_KEY";
      childEnv.ANTHROPIC_AUTH_TOKEN = "";
      break;
    }
    case "google-generative-ai":
      if (model.id.includes("/")) {
        throw new BenchError(`Google model ID "${model.id}" cannot be represented by Inspect`);
      }
      inspectModel = `google/${model.id}`;
      apiKeyEnv = "GOOGLE_API_KEY";
      childEnv.GOOGLE_USE_ADC = "";
      childEnv.GOOGLE_GENAI_USE_VERTEXAI = "";
      break;
    default:
      throw new BenchError(`Unsupported Pi API "${model.api}" for ${model.provider}/${model.id}`);
  }

  childEnv[apiKeyEnv] = resolution.auth.apiKey;
  const adapter = model.provider === "kimi" && model.api === "openai-completions"
    ? {
        summary: "Kimi fixed sampling · requested temperature, top-p, and penalty settings are ignored",
      }
    : null;
  if (adapter) childEnv.BENCH_KIMI_FIXED_SAMPLING = "1";

  const extraHeaders = model.provider === "opencode-go"
    ? {
        "x-opencode-client": "inspect-ai",
        "x-opencode-session": randomUUID(),
      }
    : undefined;

  return { inspectModel, baseUrl, modelArgs, extraHeaders, childEnv, apiKeyEnv, adapter };
}

async function runInherited(command, args, options) {
  const result = await runForeground(command, args, options);
  return result.status;
}

async function confirmRun(
  model,
  translated,
  task,
  taskConfiguration,
  samples,
  concurrency,
  lifecycle,
  config,
  inspectPassthrough,
  redactedCommand,
  ui,
) {
  const cautions = [
    ...(samples.risk === "high" ? ["Large or unlimited run selected. Time and provider usage may be significant."] : []),
    ...(taskWarning(task) ? ["This task has historical compatibility evidence that needs review."] : []),
    ...(lifecycle?.warning ? [`Local model status could not be checked: ${lifecycle.warning}`] : []),
  ];
  const receipt = [
    detailHeading("MODEL"),
    `${model.provider}/${model.id}  ·  ${model.backend.location}`,
    ...(translated.adapter
      ? ["", detailHeading("PROVIDER COMPATIBILITY"), translated.adapter.summary]
      : []),
    "",
    detailHeading("BENCHMARK"),
    `${task.displayName}${task.group ? `  ·  ${task.group}` : ""}`,
    "",
    detailHeading("RUN SIZE"),
    samples.summary,
    "",
    detailHeading("TASK OPTIONS"),
    taskConfiguration.summary,
    ...(task.sweep
      ? [
          "",
          detailHeading("HISTORICAL CHECK"),
          task.sweep.result === "passed" && task.sweep.versionMatches
            ? "✓ Worked in the saved one-sample check"
            : `⚠ ${task.sweep.result} · review before running`,
        ]
      : []),
    ...(concurrency ? ["", detailHeading("REQUESTS AT ONCE"), concurrency.summary] : []),
    ...(lifecycle ? ["", detailHeading("AFTER THE RUN"), lifecycle.summary] : []),
    "",
    detailHeading("RESULTS"),
    `Inspect will save logs under ${config.logDir}`,
    ...(inspectPassthrough.length > 0
      ? ["", detailHeading("COMMAND-LINE OVERRIDES"), inspectPassthrough.join(" ")]
      : []),
    ...(cautions.length > 0 ? ["", benchUiStyle.warning("CAUTION"), ...cautions.map(benchUiStyle.warning)] : []),
  ];

  while (true) {
    const safeToDefaultRun = cautions.length === 0;
    const actions = [
      ...(safeToDefaultRun ? [{ action: "run", label: "Run benchmark", detail: "Start Inspect" }] : []),
      { action: "back", label: "Go back", detail: "Adjust the most recent choice" },
      ...(!safeToDefaultRun ? [{ action: "run", label: "Run anyway", detail: "Accept the cautions and start Inspect" }] : []),
      { action: "command", label: "View redacted command", detail: "For advanced troubleshooting" },
    ];
    const selected = selectedOrCancel(await ui.select(actions, {
      step: "8 Review",
      context: `${model.provider}/${model.id}  →  ${task.displayName}`,
      title: cautions.length > 0 ? "Review cautions before running" : "Ready to run",
      message: cautions.length > 0
        ? "Go back is selected by default. Continue only if this run is intentional."
        : `Results will be saved under ${config.logDir}.`,
      label: (item) => item.label,
      summary: (item) => item.detail,
      details: () => receipt,
      tone: cautions.length > 0 ? "warning" : undefined,
      allowBack: true,
    }));
    if (selected === BACK || selected.action === "back") return false;
    if (selected.action === "run") return true;
    selectedOrCancel(await ui.select([
      { action: "back", label: "Back to review", detail: "Return to the run plan" },
    ], {
      step: "8 Review",
      context: task.displayName,
      title: "Redacted Inspect command",
      message: "Authentication values are omitted.",
      details: () => redactedCommand,
      compact: true,
      allowBack: true,
    }));
  }
}

async function selectInteractiveBenchmark(suite, model, preferredBenchmarkId, ui) {
  const result = selectedOrCancel(await ui.select(suite.benchmarks, {
    step: "4 Benchmark",
    context: `${suite.label}  ·  ${model.provider}/${model.id}`,
    title: `Choose a ${suite.label} benchmark`,
    message: "The benchmark prompt and output contract come from the shared catalog.",
    listTitle: "Benchmarks",
    detailTitle: "Benchmark contract",
    label: (benchmark) => benchmark.title,
    summary: (benchmark) => benchmark.description,
    details: interactiveBenchmarkDetails,
    searchText: (benchmark) => `${benchmark.id} ${benchmark.title} ${benchmark.description}`,
    searchPlaceholder: "benchmark name or description",
    searchable: true,
    isInitial: (benchmark) => benchmark.id === preferredBenchmarkId,
    allowBack: true,
  }));
  return result;
}

async function confirmInteractiveReview(repositoryRoot, suite, benchmark, model, ui) {
  const review = buildInteractiveReview({ repositoryRoot, suite, benchmark, model });
  const receipt = [
    detailHeading("MODEL"),
    `${review.model}  ·  ${model.backend.location}`,
    "",
    detailHeading("SUITE"),
    review.suite,
    "",
    detailHeading("BENCHMARK"),
    `${review.benchmark}  ·  ${review.benchmarkId}`,
    "",
    detailHeading("EXPECTED OUTPUTS"),
    ...review.expectedAssets.map((asset) => `• ${asset}`),
    "",
    detailHeading("RUN ROOT"),
    review.runRoot,
    "",
    detailHeading("PI HANDOFF"),
    ...review.launch.map((line) => `• ${line}`),
    "",
    detailHeading("AFTER PI EXITS"),
    review.cleanup,
    ...(!review.cleanupSupported
      ? ["", benchUiStyle.warning("CAUTION"), benchUiStyle.warning("This local model will remain loaded after Pi exits.")]
      : []),
  ];
  const safeToLaunch = review.cleanupSupported;
  const selected = selectedOrCancel(await ui.select([
    ...(safeToLaunch ? [{ action: "launch", label: "Launch Pi", detail: "Create the run slot and start Pi" }] : []),
    { action: "back", label: "Go back", detail: "Choose a different benchmark" },
    ...(!safeToLaunch ? [{ action: "launch", label: "Launch anyway", detail: "Leave the local model running afterward" }] : []),
  ], {
    step: "8 Review",
    context: `${model.provider}/${model.id}  →  ${benchmark.title}`,
    title: safeToLaunch ? "Ready to launch Pi" : "Review cleanup limitation",
    message: safeToLaunch
      ? "The run slot will be created only after you confirm."
      : "Go back is selected by default because this provider has no unload adapter.",
    label: (item) => item.label,
    summary: (item) => item.detail,
    details: () => receipt,
    compact: true,
    tone: safeToLaunch ? undefined : "warning",
    allowBack: true,
  }));
  return selected !== BACK && selected.action === "launch";
}

function parseViewCommand(argv) {
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

function viewerStatusLine(result) {
  const detail = result.health === "healthy"
    ? result.owned ? `Bench-owned${result.pid ? ` · PID ${result.pid}` : ""}` : "external"
    : result.health === "occupied" ? "unknown application on configured port"
      : result.health === "stale" ? `stale ownership${result.pid ? ` · PID ${result.pid}` : ""}`
        : "not running";
  return `${result.label}: ${result.health} · ${detail} · ${result.url}`;
}

async function startAndOpenViewers(manager, target) {
  const results = await manager.start(target);
  for (const result of results) {
    const action = result.action === "started" ? "started" : result.owned ? "reused" : "reused external viewer";
    console.log(`${result.label}: ${action} · ${result.url}${result.pid ? ` · PID ${result.pid}` : ""}`);
  }
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
        results.forEach((result) => console.log(`${result.label}: ${result.action}`));
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
      for (const result of results) {
        console.log(`${result.label}: ${result.action} · ${result.url}`);
      }
      await manager.open(target === "both" ? VIEWER_IDS.visual : target);
      return;
    }
  } finally {
    ui.stop({ preserveScreen: true });
  }
}

async function runViewCommand(cwd, command) {
  if (command.action === "select") return runViewerSelector(cwd);
  const manager = createViewerManager({ repositoryRoot: cwd });
  if (command.action === "start") return startAndOpenViewers(manager, command.target);
  const results = command.action === "status"
    ? await manager.status(command.target)
    : await manager.stop(command.target);
  for (const result of results) {
    console.log(command.action === "status"
      ? viewerStatusLine(result)
      : `${result.label}: ${result.action} · ${result.url}`);
  }
}

async function offerViewersAfterRun(cwd, relevantViewer) {
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
    results.forEach((result) => console.log(`${result.label}: ${result.action} · ${result.url}`));
    await manager.open(selected.target === "both" ? VIEWER_IDS.visual : selected.target);
  } catch (error) {
    if (!(error instanceof SelectionCancelled)) {
      console.error(`Warning: Could not open results viewer: ${errorMessage(error)}`);
    }
  } finally {
    ui.stop({ preserveScreen: true });
  }
}

async function main(argv = process.argv.slice(2)) {
  const cwd = process.cwd();
  const viewCommand = parseViewCommand(argv);
  if (viewCommand) {
    await runViewCommand(cwd, viewCommand);
    return;
  }
  const inspectPassthrough = passthroughArgs(argv);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new BenchError("Bench requires an interactive terminal");
  }
  let ui;
  ui = new BenchUI({
    cancelLoading: () => {
      stopActiveCapturedChildren();
      ui.stop();
      process.exit(130);
    },
  });
  let lifecycle = null;

  ui.start();
  try {
    let config = null;
    let modelRuntime;
    let providers;
    let diagnostics;
    let benchmarkSources = null;
    let interactiveSuites;
    while (!interactiveSuites) {
      ui.showLoading("Finding Pi models and benchmark suites…");
      try {
        const [modelDiscovery, discoveredSuites] = await Promise.all([
          discoverModels(cwd),
          loadInteractiveBenchmarkSuites({ repositoryRoot: cwd }),
        ]);
        ({ modelRuntime, providers, diagnostics } = modelDiscovery);
        interactiveSuites = discoveredSuites;
      } catch (error) {
        const recovery = selectedOrCancel(await ui.select([
          { action: "retry", label: "Retry", detail: "Run the setup checks again" },
          { action: "quit", label: "Quit", detail: "Exit Bench" },
        ], {
          step: "Setup",
          title: "Bench could not finish setup",
          message: "Fix the issue below, then retry without losing the terminal session.",
          details: () => [
            detailHeading("WHAT TO DO"),
            setupAdvice(error),
            "",
            detailHeading("TECHNICAL DETAILS"),
            errorMessage(error),
          ],
          compact: true,
          tone: "error",
        }));
        if (recovery.action === "quit") throw new SelectionCancelled();
      }
    }
    if (diagnostics.length > 0) {
      ui.flash(`Pi reported ${diagnostics.length} non-fatal configuration notice${diagnostics.length === 1 ? "" : "s"}.`);
    }

    const preferences = await loadBenchPreferences(cwd);
    let selectedProvider = null;
    let selectedModel = null;
    let selectedSuite = null;
    let selectedTask = null;
    let selectedInteractiveBenchmark = null;
    let preferredModelId = preferences.model ?? null;
    let preferredTaskSpec = preferences.task ?? null;
    let selectedSourceId = preferences.source ?? "inspect_evals_recommended";
    let preferredSuiteId = preferences.suite ?? BENCHMARK_SUITE_IDS.inspect;
    let translated = null;
    let taskConfiguration = null;
    let samples = null;
    let concurrency = null;
    let inspectArgs = null;
    let dataScienceAccess = null;
    let configureWasInteractive = false;
    let samplesWereInteractive = false;
    let concurrencyWasInteractive = false;
    let stage = "provider";

    while (stage !== "launch") {
      if (stage === "provider") {
        let result = selectedOrCancel(await ui.select(providers, {
          step: "1 Provider",
          title: "Choose where your model comes from",
          message: "Local providers run on this machine. Cloud providers send requests to a remote API.",
          listTitle: "Providers",
          detailTitle: "About this provider",
          label: (provider) => provider.backend.status === "offline"
            ? benchUiStyle.warning(`⚠ ${provider.provider}`)
            : provider.provider,
          summary: ({ models, backend }) => `${backend.location}  ·  ${models.length} model${models.length === 1 ? "" : "s"}${backend.status ? `  ·  ${backend.status}` : ""}`,
          details: (provider) => [
            ...providerDetails(provider),
            ...(diagnostics.length > 0 ? ["", "PI CONFIGURATION NOTICES", ...diagnostics] : []),
          ],
          searchText: ({ provider, backend }) => `${provider} ${backend.location} ${backend.status ?? ""}`,
          searchPlaceholder: "provider name or local/cloud",
          searchable: true,
          isInitial: ({ provider }) => provider === selectedProvider?.provider || provider === preferences.provider,
        }));
        if (result.backend.location === "local" && result.backend.status === "offline") {
          const recovery = selectedOrCancel(await ui.select([
            { action: "another", label: "Choose another provider", detail: "Return to the provider browser" },
            { action: "retry", label: "Retry server check", detail: "Check whether the local server is now running" },
          ], {
            step: "1 Provider",
            context: result.provider,
            title: "Local server is offline",
            message: "Start the provider's local server before choosing one of its models.",
            details: () => providerDetails(result),
            compact: true,
            tone: "error",
            allowBack: true,
          }));
          if (recovery === BACK || recovery.action === "another") continue;
          ui.showLoading("Checking the local server…", result.provider);
          const [refreshed] = await annotateProviderBackends([result]);
          const providerIndex = providers.findIndex(({ provider }) => provider === refreshed.provider);
          if (providerIndex >= 0) providers[providerIndex] = refreshed;
          result = refreshed;
          if (result.backend.status === "offline") {
            ui.flash(`${result.provider} is still offline.`);
            continue;
          }
        }
        if (selectedProvider?.provider !== result.provider) {
          selectedModel = null;
          preferredModelId = result.provider === preferences.provider ? preferences.model ?? null : null;
        }
        selectedProvider = result;
        selectedTask = null;
        stage = "model";
        continue;
      }

      if (stage === "model") {
        const modelChoices = selectedProvider.models.map((model) => ({
          model,
          piReady: modelPiReady(model),
          compatibility: modelCompatibility(modelRuntime, model),
        }));
        const result = selectedOrCancel(await ui.select(modelChoices, {
          step: "2 Model",
          context: selectedProvider.provider,
          title: "Choose a model",
          message: "Pi can use every available model. Inspect compatibility is shown before you choose a suite.",
          listTitle: "Models",
          detailTitle: "What this model can do",
          label: ({ model, piReady }) => piReady ? model.id : benchUiStyle.error(`× ${model.id}`),
          summary: ({ model, compatibility, piReady }) => !piReady
            ? "Unavailable · local server offline"
            : compatibility.ready
              ? `Pi + Inspect  ·  ${model.input.includes("image") ? "text + images" : "text"}  ·  ${formatTokens(model.contextWindow)} max input`
              : `Pi only  ·  Inspect: ${compatibility.short}`,
          details: modelDetails,
          searchText: ({ model }) => `${model.id} ${model.name ?? ""} ${model.input.join(" ")} ${model.api}`,
          searchPlaceholder: "model name, capability, or API format",
          searchable: true,
          isInitial: ({ model }) => model.id === selectedModel?.id || model.id === preferredModelId,
          allowBack: true,
        }));
        if (result === BACK) {
          stage = "provider";
          continue;
        }
        if (!result.piReady) {
          selectedOrCancel(await ui.select([
            { action: "back", label: "Choose another model", detail: "Return to the model browser" },
          ], {
            step: "2 Model",
            context: result.model.id,
            title: "This local model is unavailable",
            message: "Start its local server before using it with Pi or Inspect.",
            details: () => modelDetails(result),
            compact: true,
            tone: "error",
            allowBack: true,
          }));
          continue;
        }
        selectedModel = result.model;
        preferredModelId = selectedModel.id;
        translated = null;
        lifecycle = null;
        dataScienceAccess = null;
        stage = "suite";
        continue;
      }

      if (stage === "suite") {
        const compatibility = modelCompatibility(modelRuntime, selectedModel);
        const suiteChoices = buildSuiteChoices(interactiveSuites, compatibility);
        const result = selectedOrCancel(await ui.select(suiteChoices, {
          step: "3 Suite",
          context: `${selectedModel.provider}/${selectedModel.id}`,
          title: "Choose a benchmark suite",
          message: "Inspect runs scored eval tasks. Visual and Data Science hand an isolated run folder to Pi.",
          listTitle: "Suites",
          detailTitle: "How this suite runs",
          label: (suite) => suite.label,
          summary: (suite) => suite.detail,
          details: (suite) => [suite.description, "", suite.detail],
          searchText: (suite) => `${suite.id} ${suite.label} ${suite.description}`,
          searchable: true,
          isInitial: (suite) => suite.id === selectedSuite?.id || suite.id === preferredSuiteId,
          allowBack: true,
        }));
        if (result === BACK) {
          stage = "model";
          continue;
        }

        const passthroughError = suitePassthroughError(result.id, inspectPassthrough);
        if (passthroughError) {
          const recovery = selectedOrCancel(await ui.select([
            { action: "back", label: "Choose another suite", detail: "Return to the suite browser" },
            { action: "inspect", label: "Use Inspect evals", detail: "Keep the command-line options" },
          ], {
            step: "3 Suite",
            context: result.label,
            title: "Inspect-only command-line options",
            message: passthroughError,
            details: () => [
              detailHeading("OPTIONS RECEIVED"),
              inspectPassthrough.join(" "),
              "",
              "Remove the arguments after -- to use an interactive Pi suite.",
            ],
            compact: true,
            tone: "error",
            allowBack: true,
          }));
          if (recovery !== BACK && recovery.action === "inspect") {
            preferredSuiteId = BENCHMARK_SUITE_IDS.inspect;
          }
          continue;
        }

        if (result.id === BENCHMARK_SUITE_IDS.inspect && !compatibility.ready) {
          const recovery = selectedOrCancel(await ui.select([
            { action: "suite", label: "Choose another suite", detail: "Use this model through interactive Pi" },
            { action: "model", label: "Choose another model", detail: "Find a Pi + Inspect model" },
          ], {
            step: "3 Suite",
            context: `${selectedModel.provider}/${selectedModel.id}`,
            title: "This model cannot run Inspect evals",
            message: compatibility.reason,
            details: () => modelDetails({ model: selectedModel, compatibility, piReady: true }),
            compact: true,
            tone: "error",
            allowBack: true,
          }));
          stage = recovery === BACK || recovery.action === "suite" ? "suite" : "model";
          continue;
        }

        selectedSuite = result.suite ?? { id: result.id, label: result.label };
        preferredSuiteId = result.id;
        if (result.id !== BENCHMARK_SUITE_IDS.inspect) {
          stage = "interactive-benchmark";
          continue;
        }

        let resolutionAction = "retry";
        while (resolutionAction === "retry") {
          ui.showLoading("Checking Inspect authentication and model settings…", `${selectedProvider.provider}/${selectedModel.id}`);
          try {
            translated = await resolveInspectModel(modelRuntime, selectedModel);
            resolutionAction = "continue";
          } catch (error) {
            const recovery = selectedOrCancel(await ui.select([
              { action: "suite", label: "Choose another suite", detail: "Use this model through interactive Pi" },
              { action: "model", label: "Choose another model", detail: "Return to the model browser" },
              { action: "retry", label: "Retry", detail: "Check the same model again" },
            ], {
              step: "3 Suite",
              context: `${selectedProvider.provider}/${selectedModel.id}`,
              title: "Could not prepare this model for Inspect",
              message: "Bench could not translate its current Pi authentication into an Inspect connection.",
              details: () => ["TECHNICAL DETAILS", errorMessage(error)],
              compact: true,
              tone: "error",
              allowBack: true,
            }));
            resolutionAction = recovery === BACK ? "suite" : recovery.action;
          }
        }
        if (resolutionAction !== "continue") {
          stage = resolutionAction;
          continue;
        }

        while (!benchmarkSources) {
          ui.showLoading("Finding Inspect benchmarks…");
          try {
            config = await loadConfig(cwd);
            benchmarkSources = await discoverBenchmarks(cwd, config.customTaskRoots);
          } catch (error) {
            const recovery = selectedOrCancel(await ui.select([
              { action: "suite", label: "Choose another suite", detail: "Return to suite selection" },
              { action: "retry", label: "Retry", detail: "Run Inspect discovery again" },
            ], {
              step: "3 Suite",
              context: "Inspect evals",
              title: "Could not load Inspect benchmarks",
              message: "Interactive Pi suites remain available.",
              details: () => [
                detailHeading("WHAT TO DO"),
                setupAdvice(error),
                "",
                detailHeading("TECHNICAL DETAILS"),
                errorMessage(error),
              ],
              compact: true,
              tone: "error",
              allowBack: true,
            }));
            if (recovery === BACK || recovery.action === "suite") {
              stage = "suite";
              break;
            }
          }
        }
        if (stage === "suite") continue;
        stage = "benchmark";
        continue;
      }

      if (stage === "interactive-benchmark") {
        const preferredBenchmarkId = selectedInteractiveBenchmark?.kind === selectedSuite.id
          ? selectedInteractiveBenchmark.id
          : preferences.benchmarks?.[selectedSuite.id] ?? null;
        const result = await selectInteractiveBenchmark(
          selectedSuite,
          selectedModel,
          preferredBenchmarkId,
          ui,
        );
        if (result === BACK) {
          stage = "suite";
          continue;
        }
        selectedInteractiveBenchmark = result;
        dataScienceAccess = null;

        if (selectedSuite.id === BENCHMARK_SUITE_IDS.dataScience) {
          let accessAction = "retry";
          while (accessAction === "retry") {
            ui.showLoading("Checking Data Science project access…", "SUPABASE_URL + SUPABASE_ANON_KEY");
            try {
              dataScienceAccess = await loadProjectDataScienceAccess({ repositoryRoot: cwd });
              accessAction = "continue";
            } catch (error) {
              const recovery = selectedOrCancel(await ui.select([
                { action: "benchmark", label: "Choose another benchmark", detail: "Return to the benchmark browser" },
                { action: "suite", label: "Choose another suite", detail: "Return to suite selection" },
                { action: "retry", label: "Retry", detail: "Read the project configuration again" },
              ], {
                step: "4 Benchmark",
                context: selectedInteractiveBenchmark.title,
                title: "Data Science access is not configured",
                message: "Add SUPABASE_URL and SUPABASE_ANON_KEY to the shell or project .env before continuing.",
                details: () => [detailHeading("TECHNICAL DETAILS"), errorMessage(error)],
                compact: true,
                tone: "error",
                allowBack: true,
              }));
              accessAction = recovery === BACK ? "benchmark" : recovery.action;
            }
          }
          if (accessAction !== "continue") {
            stage = accessAction === "benchmark" ? "interactive-benchmark" : "suite";
            continue;
          }
        }
        stage = "interactive-review";
        continue;
      }

      if (stage === "benchmark") {
        const result = selectedOrCancel(await ui.browseBenchmarks(benchmarkSources, {
          step: "4 Benchmark",
          context: `${selectedModel.provider}/${selectedModel.id}`,
          initialSource: selectedSourceId,
          initialTaskSpec: selectedTask?.spec ?? preferredTaskSpec,
        }));
        if (result === BACK) {
          stage = "suite";
          continue;
        }
        selectedSourceId = result.source;
        if (!await confirmSweepWarning(result.task, ui)) continue;
        selectedTask = result.task;
        preferredTaskSpec = selectedTask.spec;
        taskConfiguration = null;
        samples = null;
        concurrency = null;
        configureWasInteractive = false;
        samplesWereInteractive = false;
        concurrencyWasInteractive = false;
        stage = "configure";
        continue;
      }

      if (stage === "configure") {
        const interactionBefore = ui.interactionCount;
        const result = await selectTaskConfiguration(
          cwd,
          config,
          selectedTask,
          inspectPassthrough,
          ui,
          taskConfiguration,
        );
        configureWasInteractive = ui.interactionCount > interactionBefore;
        if (result === BACK) {
          stage = "benchmark";
          continue;
        }
        taskConfiguration = result;
        samplesWereInteractive = false;
        concurrencyWasInteractive = false;
        stage = "samples";
        continue;
      }

      if (stage === "samples") {
        const interactionBefore = ui.interactionCount;
        const result = await selectSamples(
          selectedTask,
          inspectPassthrough,
          taskConfiguration,
          ui,
          samples,
        );
        samplesWereInteractive = ui.interactionCount > interactionBefore;
        if (result === BACK) {
          stage = configureWasInteractive ? "configure" : "benchmark";
          continue;
        }
        samples = result;
        concurrencyWasInteractive = false;
        stage = "concurrency";
        continue;
      }

      if (stage === "concurrency") {
        const interactionBefore = ui.interactionCount;
        const result = await selectConcurrency(selectedModel, inspectPassthrough, ui, concurrency);
        concurrencyWasInteractive = ui.interactionCount > interactionBefore;
        if (result === BACK) {
          stage = samplesWereInteractive
            ? "samples"
            : configureWasInteractive ? "configure" : "benchmark";
          continue;
        }
        concurrency = result;
        ui.showLoading("Preparing the final run plan…", `${selectedModel.provider}/${selectedModel.id}  →  ${selectedTask.displayName}`);
        lifecycle = await prepareLocalModelLifecycle(selectedModel, {
          baseUrl: translated.baseUrl,
          apiKey: translated.childEnv?.[translated.apiKeyEnv],
        });
        stage = "review";
        continue;
      }

      if (stage === "review") {
        inspectArgs = buildInspectInvocation(
          selectedTask,
          selectedModel,
          translated,
          config,
          [
            ...taskConfiguration.args,
            ...samples.args,
            ...(concurrency?.args ?? []),
            ...inspectPassthrough,
          ],
        );
        const confirmed = await confirmRun(
          selectedModel,
          translated,
          selectedTask,
          taskConfiguration,
          samples,
          concurrency,
          lifecycle,
          config,
          inspectPassthrough,
          formatCommand("uv", inspectArgs, translated.apiKeyEnv),
          ui,
        );
        if (!confirmed) {
          stage = concurrencyWasInteractive
            ? "concurrency"
            : samplesWereInteractive
              ? "samples"
              : configureWasInteractive ? "configure" : "benchmark";
          continue;
        }
        stage = "launch";
        continue;
      }

      if (stage === "interactive-review") {
        const confirmed = await confirmInteractiveReview(
          cwd,
          selectedSuite,
          selectedInteractiveBenchmark,
          selectedModel,
          ui,
        );
        stage = confirmed ? "launch" : "interactive-benchmark";
      }
    }

    await saveBenchPreferences(cwd, updateSuitePreferences(preferences, {
      provider: selectedProvider.provider,
      model: selectedModel.id,
      suite: selectedSuite.id,
      inspectSource: selectedTask ? selectedSourceId : undefined,
      inspectTask: selectedTask?.spec,
      benchmark: selectedInteractiveBenchmark,
    })).catch(() => {});

    ui.stop({ preserveScreen: true });
    if (selectedSuite.id !== BENCHMARK_SUITE_IDS.inspect) {
      console.log(`\nPreparing ${selectedInteractiveBenchmark.title} with ${selectedModel.provider}/${selectedModel.id}.`);
      const execution = await executeInteractiveBenchmark({
        repositoryRoot: cwd,
        benchmark: selectedInteractiveBenchmark,
        model: selectedModel,
        modelRuntime,
        dataScienceAccess,
        onPrepared: ({ prepared, launchCommand }) => {
          console.log(`Run slot: ${prepared.paths.runDirectory}`);
          if (process.env.BENCH_VERBOSE === "1") console.log(`$ ${launchCommand}`);
          console.log("Starting interactive Pi…\n");
        },
      });
      const exitStatus = execution.childResult?.status ?? 1;
      process.exitCode = exitStatus;
      console.log(exitStatus === 0
        ? `\nPi exited. The prepared run is at ${execution.prepared.paths.runDirectory}.`
        : `\nPi exited with status ${exitStatus}. Run metadata was updated at ${execution.prepared.paths.runDirectory}.`);
      if (execution.cleanupResult?.message) {
        const cleanupMessage = `Local model: ${execution.cleanupResult.message}.`;
        if (execution.cleanupResult.status === "failed") console.error(`Warning: ${cleanupMessage}`);
        else console.log(cleanupMessage);
      }
      if (exitStatus === 0) await offerViewersAfterRun(cwd, VIEWER_IDS.visual);
      return;
    }

    console.log(`\nStarting ${selectedTask.displayName} with ${selectedModel.provider}/${selectedModel.id}.`);
    console.log(`Inspect will save results under ${config.logDir}.`);
    if (process.env.BENCH_VERBOSE === "1") {
      console.log(`$ ${formatCommand("uv", inspectArgs, translated.apiKeyEnv)}`);
    }
    console.log();

    let exitStatus = 1;
    let cleanupResult = null;
    try {
      exitStatus = await runInherited("uv", inspectArgs, {
        cwd,
        env: translated.childEnv,
      });
    } finally {
      cleanupResult = await lifecycle?.cleanup();
    }
    process.exitCode = exitStatus;
    console.log(exitStatus === 0
      ? `\nBench completed. Results are under ${config.logDir}. Run \`uv run inspect view\` to browse them.`
      : `\nBench stopped because Inspect exited with status ${exitStatus}.`);
    if (cleanupResult?.message) {
      const cleanupMessage = `Local model: ${cleanupResult.message}.`;
      if (cleanupResult.status === "failed") console.error(`Warning: ${cleanupMessage}`);
      else console.log(cleanupMessage);
    }
    if (exitStatus === 0) await offerViewersAfterRun(cwd, VIEWER_IDS.inspect);
  } finally {
    ui.stop({ preserveScreen: true });
  }
}

async function runCli() {
  try {
    await main();
  } catch (error) {
    if (error instanceof SelectionCancelled) {
      console.error("Cancelled.");
      process.exitCode = 130;
      return;
    }
    console.error(`Error: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

export {
  BenchError,
  SelectionCancelled,
  annotateProviderBackends,
  buildBenchmarkSources,
  buildInspectInvocation,
  classifyBackend,
  discoverBenchmarks,
  discoverRegisteredTasks,
  discoverTasks,
  formatCommand,
  formatSampleCount,
  generateTaskConfigTemplate,
  groupModels,
  inspectOptionValue,
  loadSweepData,
  localConcurrencyChoices,
  modelCompatibility,
  main,
  parseViewCommand,
  passthroughArgs,
  prepareLocalModelLifecycle,
  probeTcp,
  resolveInspectModel,
  runInherited,
  sampleChoices,
  sentenceHint,
  sweepWarningLines,
  taskConfigPath,
  validateTaskConfig,
};

if (isMainModule()) {
  await runCli();
}
