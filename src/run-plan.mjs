export function formatSampleCount(count) {
  return Number.isInteger(count) ? count.toLocaleString("en-US") : "unavailable";
}

export function inspectOptionValue(args, name) {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name) {
      const value = args[index + 1];
      return value && !value.startsWith("-") ? value : "enabled";
    }
    if (args[index].startsWith(`${name}=`)) return args[index].slice(name.length + 1);
  }
  return null;
}

export function hasInspectOption(args, name) {
  return args.some((argument) => argument === name || argument.startsWith(`${name}=`));
}

export function sampleChoices(total) {
  const presets = [
    { limit: 1, name: "Quick check", detail: "fastest · verifies that the setup works" },
    { limit: 10, name: "Small run", detail: "a small repeatable subset" },
    { limit: 100, name: "Standard run", detail: "more evidence · more time and API usage" },
    { limit: 500, name: "Large run", detail: "substantial time and API usage" },
    { limit: 1_000, name: "Very large run", detail: "use only when you need broad coverage" },
  ];
  const choices = [];
  for (const preset of presets) {
    if (total === null || preset.limit < total) {
      choices.push({
        action: "limit",
        limit: preset.limit,
        label: `${preset.name} · ${formatSampleCount(preset.limit)} sample${preset.limit === 1 ? "" : "s"}${preset.limit === 1 ? " (Recommended)" : ""}`,
        detail: preset.detail,
      });
    }
  }
  if (total === null || total > 1) {
    choices.push({ action: "custom", limit: null, label: "Custom run size…", detail: "enter a specific sample limit" });
  }
  if (Number.isInteger(total)) {
    choices.push({
      action: "all",
      limit: null,
      label: `Full dataset · ${formatSampleCount(total)} sample${total === 1 ? "" : "s"}`,
      detail: total > 100 ? "may take significant time and API usage" : "run every published sample",
    });
  } else {
    choices.push({ action: "all", limit: null, label: "No sample limit", detail: "dataset size is unknown · review carefully" });
  }
  return choices;
}

export function localConcurrencyChoices() {
  return [
    { action: "static", connections: 1, label: "Safe · 1 at a time (Recommended)", detail: "lowest memory use · best if you are unsure" },
    { action: "static", connections: 2, label: "Balanced · 2 at a time", detail: "some parallelism with modest memory pressure" },
    { action: "static", connections: 4, label: "Faster · 4 at a time", detail: "higher throughput and memory use" },
    { action: "static", connections: 8, label: "Aggressive · 8 at a time", detail: "high memory pressure on one local server" },
    { action: "custom", connections: null, label: "Custom limit…", detail: "enter a specific positive number" },
    { action: "adaptive", connections: null, label: "Let Inspect decide (Advanced)", detail: "Inspect may scale aggressively on a local server" },
  ];
}

function metadataArg(name, value) {
  return `${name}=${JSON.stringify(value)}`;
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function formatCommand(command, args, apiKeyEnv) {
  return `${apiKeyEnv}=<redacted> ${[command, ...args].map(shellQuote).join(" ")}`;
}

export function buildInspectInvocation(task, model, translated, config, inspectPassthrough = []) {
  const modelSelection = translated.extraHeaders
    ? [
        "--model-spec",
        JSON.stringify({
          model: translated.inspectModel,
          base_url: translated.baseUrl,
          ...(Object.keys(translated.modelArgs).length > 0 ? { model_args: translated.modelArgs } : {}),
          extra_headers: translated.extraHeaders,
        }),
      ]
    : [
        "--model",
        translated.inspectModel,
        "--model-base-url",
        translated.baseUrl,
        ...Object.entries(translated.modelArgs).flatMap(([name, value]) => ["-M", `${name}=${value}`]),
      ];

  return [
    "run",
    "inspect",
    "eval",
    task.spec ?? `${task.file}@${task.name}`,
    ...modelSelection,
    "--metadata",
    metadataArg("pi_provider", model.provider),
    "--metadata",
    metadataArg("pi_model", model.id),
    "--metadata",
    metadataArg("pi_api", model.api),
    "--log-dir",
    config.logDir,
    ...inspectPassthrough,
  ];
}
