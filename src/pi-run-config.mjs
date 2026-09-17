import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Executed inside confinement, after copying Pi config into private scratch storage.
// The selected model (and resolved auth) travels via environment, never command args.
const payload = process.env.BENCH_PI_LOCAL_MODEL;
delete process.env.BENCH_PI_LOCAL_MODEL;
if (payload) {
  const { model, auth } = JSON.parse(payload);
  const { provider, backend, localDiscovery, localModelPolicy, generation, unavailableReason, headers, ...definition } = model;
  const directory = process.env.PI_CODING_AGENT_DIR;
  const config = await readJson(join(directory, "models.json"));
  config.providers ??= {};
  config.providers[provider] = {
    ...config.providers[provider],
    baseUrl: auth?.baseUrl ?? definition.baseUrl,
    api: definition.api,
    headers: Object.fromEntries(Object.entries(auth?.headers ?? {}).map(([key, value]) => [key, literal(value)])),
    // Locally discovered models must come only from the explicit extension; if it
    // cannot load, Pi must not fall back to a static/default definition.
    // Extension-registered providers have no dynamic registration in the confined
    // run, so the selected definition joins the static provider entry instead.
    models: localDiscovery
      ? []
      : [...(config.providers[provider]?.models ?? []).filter((entry) => entry?.id !== definition.id), definition],
  };
  await writeFile(join(directory, "models.json"), JSON.stringify(config), { mode: 0o600 });
  await writeFile(join(directory, "bench-local-model.json"), JSON.stringify({
    provider, model: { ...definition, baseUrl: auth?.baseUrl ?? definition.baseUrl }, policy: localModelPolicy,
  }), { mode: 0o600 });
  if (auth?.apiKey) {
    const credentials = await readJson(join(directory, "auth.json"));
    credentials[provider] = { type: "api_key", key: literal(auth.apiKey) };
    await writeFile(join(directory, "auth.json"), JSON.stringify(credentials), { mode: 0o600 });
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {};
  }
}

function literal(value) {
  return value.replaceAll("$", () => "$$").replace(/^!/, () => "$!");
}
