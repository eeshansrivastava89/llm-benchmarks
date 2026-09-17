const LOCAL_MODEL_TIMEOUT_MS = 5_000;
// Local APIs do not bill per token. This is accounting, not a generation setting.
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export async function discoverLocalProviders(modelRuntime, configs = {}, options = {}) {
  const providers = modelRuntime.getProviders().filter((provider) => (
    classifyBackend(provider.baseUrl).location === "local"
    && (configs[provider.id]?.api === "openai-completions" || ["ollama", "omlx"].includes(provider.id))
  ));
  return Promise.all(providers.map((provider) => {
    const config = configs[provider.id] ?? {};
    const backend = classifyBackend(provider.baseUrl);
    const refreshModels = async () => {
      const signal = AbortSignal.timeout(options.timeoutMs ?? LOCAL_MODEL_TIMEOUT_MS);
      const resolution = await modelRuntime.getAuth(provider.id, { signal });
      const baseUrl = resolution?.auth?.baseUrl ?? provider.baseUrl;
      if (classifyBackend(baseUrl).location !== "local") throw new Error("Pi resolved a non-local discovery endpoint");
      const headers = new Headers(resolution?.auth?.headers);
      if (resolution?.auth?.apiKey && !headers.has("authorization")) headers.set("authorization", `Bearer ${resolution.auth.apiKey}`);
      const request = async (path, body) => {
        let response;
        try {
          response = await (options.fetchImpl ?? fetch)(new URL(path, `${baseUrl.replace(/\/$/, "")}/`), {
            headers: body ? new Headers([...headers, ["content-type", "application/json"]]) : headers,
            signal, redirect: "error", ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
          });
        } catch {
          throw new CatalogError(signal.aborted ? "Model discovery timed out" : "Local server could not be reached");
        }
        if (!response.ok) throw new CatalogError(`Model discovery returned HTTP ${response.status}`);
        try { return await response.json(); } catch { throw new CatalogError("Model discovery returned invalid JSON"); }
      };
      let entries;
      try {
        const payload = await request("models");
        if (!Array.isArray(payload.data) || payload.data.some((entry) => !entry || typeof entry.id !== "string" || !entry.id.trim())) {
          throw new CatalogError("Invalid /models inventory");
        }
        const inventory = [...new Map(payload.data.map((entry) => [entry.id, entry])).values()];
        if (provider.id === "omlx") {
          const status = await request("models/status");
          if (!Array.isArray(status.models)) throw new CatalogError("Invalid /models/status metadata");
          entries = inventory.map((entry) => {
            const detail = status.models.find((item) => item.id === entry.id || item.model_alias === entry.id);
            return { ...entry, metadata: omlxMetadata(detail) };
          });
        } else if (provider.id === "ollama") {
          entries = await Promise.all(inventory.map(async (entry) => ({
            ...entry, metadata: ollamaMetadata(await request("../api/show", { model: entry.id })),
          })));
        } else {
          entries = inventory.map((entry) => ({ ...entry, metadata: {
            contextWindow: entry.contextWindow ?? entry.max_model_len ?? entry.context_window,
            maxTokens: entry.max_tokens,
            input: entry.input,
            reasoning: entry.reasoning,
            generation: ["embedding", "embeddings", "reranker", "reranking", "tool"].includes(entry.type) ? false : undefined,
          } }));
        }
      } catch (error) {
        if (!(error instanceof CatalogError)) throw error;
        return { provider: provider.id, models: [], backend: { ...backend, status: "offline" }, discoveryError: error.message, refreshModels };
      }

      const models = entries.filter(({ metadata }) => metadata.generation !== false).map((entry) => {
        const raw = config.models?.find((model) => model.id === entry.id) ?? {};
        const override = config.modelOverrides?.[entry.id] ?? {};
        const metadata = entry.metadata;
        const sampling = { ...raw.samplingParams, ...override.samplingParams };
        const contextWindow = raw.contextWindow ?? metadata.contextWindow;
        const input = raw.input ?? metadata.input;
        const model = {
          ...metadata, ...raw,
          id: entry.id, name: raw.name ?? entry.id, api: raw.api ?? config.api ?? "openai-completions", baseUrl,
          contextWindow, input, cost: raw.cost ?? ZERO_COST,
          compat: { ...config.compat, ...raw.compat },
          localDiscovery: true,
          localModelPolicy: {
            output: (override.maxTokens ?? raw.maxTokens ?? sampling.max_tokens ?? sampling.max_completion_tokens) !== undefined ? "pi" : "server",
            thinking: (override.compat?.thinkingFormat ?? raw.compat?.thinkingFormat ?? config.compat?.thinkingFormat)
              || ["thinking", "reasoning_effort", "enable_thinking", "chat_template_kwargs", "chat_template_args"].some((key) => Object.hasOwn(sampling, key)) ? "pi" : "server",
          },
        };
        // Missing metadata is not permission to invent a usable Pi model.
        if (!positive(override.contextWindow ?? contextWindow) || !Array.isArray(override.input ?? input)) {
          model.unavailableReason = "Server did not advertise context/input metadata; configure those fields explicitly in Pi.";
        }
        return model;
      });
      const ready = models.filter((model) => !model.unavailableReason);
      modelRuntime.registerProvider(provider.id, {
        baseUrl, api: config.api ?? "openai-completions",
        // Pi requires an auth marker for a server that explicitly accepted a keyless request.
        ...(!resolution ? { apiKey: "local" } : {}),
        models: ready,
      });
      const resolved = new Map(modelRuntime.getModels(provider.id).map((model) => [model.id, model]));
      return {
        provider: provider.id,
        models: models.map((model) => ({ ...model, ...resolved.get(model.id), backend: { ...backend, status: "online" } }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        backend: { ...backend, status: "online" }, refreshModels,
      };
    };
    return refreshModels();
  }));
}

class CatalogError extends Error {}
function positive(value) { return Number.isSafeInteger(value) && value > 0; }

function omlxMetadata(detail) {
  if (!detail) return {};
  const generation = ["llm", "vlm"].includes(detail.model_type);
  return {
    generation,
    contextWindow: detail.max_context_window,
    maxTokens: detail.max_tokens,
    input: generation ? (detail.model_type === "vlm" ? ["text", "image"] : ["text"]) : undefined,
    reasoning: typeof detail.thinking_default === "boolean" ? true : undefined,
  };
}

function ollamaMetadata(detail) {
  const capabilities = detail.capabilities;
  const parameters = new Map((detail.parameters ?? "").split("\n").map((line) => line.trim().split(/\s+/, 2)));
  const architecture = detail.model_info?.["general.architecture"];
  const context = Number(parameters.get("num_ctx"));
  const output = Number(parameters.get("num_predict"));
  return {
    generation: Array.isArray(capabilities) ? capabilities.includes("completion") : undefined,
    contextWindow: positive(context) ? context : detail.model_info?.[`${architecture}.context_length`],
    maxTokens: positive(output) ? output : undefined,
    input: Array.isArray(capabilities) ? (capabilities.includes("vision") ? ["text", "image"] : ["text"]) : undefined,
    reasoning: Array.isArray(capabilities) ? capabilities.includes("thinking") : undefined,
  };
}

export function classifyBackend(baseUrl) {
  let url;
  try { url = new URL(baseUrl); } catch { return { location: "unknown", status: "unknown" }; }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isLoopback = hostname === "localhost" || hostname.endsWith(".localhost")
    || /^127(?:\.\d{1,3}){3}$/.test(hostname) || hostname === "::1" || hostname.startsWith("::ffff:127.");
  if (!isLoopback) return { location: "cloud" };
  const defaultPort = url.protocol === "https:" ? 443 : url.protocol === "http:" ? 80 : undefined;
  const port = url.port ? Number.parseInt(url.port, 10) : defaultPort;
  if (!port) return { location: "local", status: "unknown" };
  return { location: "local", status: "unknown", hostname, port, endpoint: `${hostname}:${port}` };
}
