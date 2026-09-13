import { connect } from "node:net";

import { BenchError } from "./errors.mjs";

export const MODEL_DISCOVERY_TIMEOUT_MS = 15_000;
const LOCAL_PROBE_TIMEOUT_MS = 400;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function discoverModels(cwd) {
  let createAgentSessionServices;
  try {
    ({ createAgentSessionServices } = await import("@earendil-works/pi-coding-agent"));
  } catch (error) {
    throw new BenchError(`Pi SDK unavailable. Run \`npm install\`. (${errorMessage(error)})`);
  }

  let services;
  try {
    services = await createAgentSessionServices({
      cwd,
      modelRuntimeSignal: AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS),
    });
  } catch (error) {
    throw new BenchError(`Could not load Pi configuration: ${errorMessage(error)}`);
  }

  const extensionErrors = services.resourceLoader
    .getExtensions()
    .errors.map(({ path, error }) => `Extension "${path}": ${error}`);
  const serviceErrors = services.diagnostics
    .filter((diagnostic) => diagnostic.type === "error")
    .map((diagnostic) => diagnostic.message);
  const fatalDiagnostics = [...serviceErrors, ...extensionErrors];
  if (fatalDiagnostics.length > 0) {
    throw new BenchError(`Pi reported configuration errors:\n${fatalDiagnostics.map((message) => `  - ${message}`).join("\n")}`);
  }

  const diagnostics = services.diagnostics
    .filter((item) => item.type !== "error")
    .map((diagnostic) => `Pi ${diagnostic.type}: ${diagnostic.message}`);

  let models;
  try {
    models = await services.modelRuntime.getAvailable(undefined, {
      signal: AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS),
    });
  } catch (error) {
    throw new BenchError(`Could not discover available Pi models: ${errorMessage(error)}`);
  }

  const runtimeError = services.modelRuntime.getError();
  if (runtimeError) {
    throw new BenchError(`Pi model configuration error: ${runtimeError}`);
  }
  const providers = await annotateProviderBackends(groupModels(models));
  return { modelRuntime: services.modelRuntime, providers, diagnostics };
}

export function groupModels(models) {
  if (models.length === 0) {
    throw new BenchError("Pi has no authenticated models available. Run `pi`, then `/login`, or configure an API key.");
  }

  const grouped = new Map();
  for (const model of models) {
    const providerModels = grouped.get(model.provider) ?? [];
    providerModels.push(model);
    grouped.set(model.provider, providerModels);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([provider, providerModels]) => ({
      provider,
      models: providerModels.sort((left, right) => left.id.localeCompare(right.id)),
    }));
}

export function classifyBackend(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    return { location: "unknown", status: "unknown" };
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isLoopback = hostname === "localhost"
    || hostname.endsWith(".localhost")
    || /^127(?:\.\d{1,3}){3}$/.test(hostname)
    || hostname === "::1"
    || hostname.startsWith("::ffff:127.");
  if (!isLoopback) return { location: "cloud" };

  const defaultPort = url.protocol === "https:" ? 443 : url.protocol === "http:" ? 80 : undefined;
  const port = url.port ? Number.parseInt(url.port, 10) : defaultPort;
  if (!port) return { location: "local", status: "unknown" };

  return {
    location: "local",
    status: "unknown",
    hostname,
    port,
    endpoint: `${hostname}:${port}`,
  };
}

export function probeTcp({ hostname, port }, timeoutMs = LOCAL_PROBE_TIMEOUT_MS) {
  return new Promise((resolvePromise) => {
    const socket = connect({ host: hostname, port });
    let settled = false;
    const finish = (online) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolvePromise(online);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function summarizeProviderBackend(models) {
  const locations = new Set(models.map((model) => model.backend.location));
  if (locations.size !== 1) return { location: "mixed", status: "mixed" };

  const [location] = locations;
  if (location !== "local") return { location, status: location === "unknown" ? "unknown" : undefined };

  const statuses = new Set(models.map((model) => model.backend.status));
  return {
    location: "local",
    status: statuses.size === 1 ? [...statuses][0] : "mixed",
  };
}

export async function annotateProviderBackends(providers, options = {}) {
  const probe = options.probe ?? probeTcp;
  const endpointChecks = new Map();

  for (const { models } of providers) {
    for (const model of models) {
      const backend = classifyBackend(model.baseUrl);
      if (backend.location === "local" && backend.endpoint && !endpointChecks.has(backend.endpoint)) {
        endpointChecks.set(
          backend.endpoint,
          Promise.resolve(probe(backend)).then((online) => online ? "online" : "offline"),
        );
      }
    }
  }

  return Promise.all(providers.map(async (provider) => {
    const models = await Promise.all(provider.models.map(async (model) => {
      const backend = classifyBackend(model.baseUrl);
      if (backend.location === "local" && backend.endpoint) {
        backend.status = await endpointChecks.get(backend.endpoint);
      }
      return { ...model, backend };
    }));
    return { ...provider, models, backend: summarizeProviderBackend(models) };
  }));
}
