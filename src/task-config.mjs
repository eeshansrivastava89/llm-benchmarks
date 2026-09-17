import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BenchError, errorMessage } from "./errors.mjs";
import { runCaptured } from "./inspect-discovery.mjs";
import { inspectOptionValue } from "./run-plan.mjs";
import { BACK, selectedOrCancel } from "./ui/bench-ui.mjs";
import { terminalLink } from "./ui/presentation.mjs";

const TASK_CONFIG_TEMPLATE_SCRIPT = fileURLToPath(
  new URL("../scripts/inspect_task_config_template.py", import.meta.url),
);
const TASK_CONFIG_VALIDATE_SCRIPT = fileURLToPath(
  new URL("../scripts/inspect_task_config_validate.py", import.meta.url),
);

function safePathPart(value) {
  const normalized = String(value).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "task";
}

export function taskConfigPath(cwd, configDir, task) {
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

export async function generateTaskConfigTemplate(cwd, task, options = {}) {
  if (!task.spec || !Array.isArray(task.params) || task.params.length === 0) {
    throw new BenchError(`No configurable task parameters were discovered for ${task.displayName}`);
  }
  const output = await runCaptured(
    options.uvCommand ?? "uv",
    ["run", "python", TASK_CONFIG_TEMPLATE_SCRIPT, task.spec, task.evalId ?? ""],
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

export async function validateTaskConfig(cwd, task, path, options = {}) {
  await runCaptured(
    options.uvCommand ?? "uv",
    ["run", "python", TASK_CONFIG_VALIDATE_SCRIPT, task.spec, path],
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

export async function selectTaskConfiguration(cwd, config, task, inspectPassthrough, ui, previous = null) {
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