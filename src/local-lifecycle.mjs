import { BenchError } from "./errors.mjs";
import { classifyBackend } from "./providers.mjs";

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function localApiUrl(baseUrl, path) {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/v1\/?$/, "").replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  url.search = "";
  url.hash = "";
  return url;
}

function ollamaModelName(name) {
  const value = String(name);
  const finalSegment = value.slice(value.lastIndexOf("/") + 1);
  return finalSegment.includes(":") ? value : `${value}:latest`;
}

async function responseJson(response, action) {
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new BenchError(`${action} failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return response.json();
}

function localModelAdapter(model, translated, fetchImpl) {
  if (classifyBackend(translated.baseUrl).location !== "local") return null;

  if (model.provider === "ollama") {
    const statusUrl = localApiUrl(translated.baseUrl, "api/ps");
    const unloadUrl = localApiUrl(translated.baseUrl, "api/generate");
    return {
      async isLoaded() {
        const data = await responseJson(
          await fetchImpl(statusUrl, { signal: AbortSignal.timeout(5_000) }),
          "Ollama model status",
        );
        const selected = ollamaModelName(model.id);
        return Array.isArray(data.models) && data.models.some((entry) => (
          ollamaModelName(entry.name ?? entry.model) === selected
        ));
      },
      async unload() {
        await responseJson(
          await fetchImpl(unloadUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: model.id, keep_alive: 0 }),
            signal: AbortSignal.timeout(30_000),
          }),
          "Ollama model unload",
        );
      },
    };
  }

  if (model.provider === "omlx") {
    const statusUrl = localApiUrl(translated.baseUrl, "v1/models/status");
    const unloadUrl = localApiUrl(translated.baseUrl, `v1/models/${encodeURIComponent(model.id)}/unload`);
    const apiKey = translated.childEnv?.[translated.apiKeyEnv];
    const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
    return {
      async isLoaded() {
        const data = await responseJson(
          await fetchImpl(statusUrl, { headers, signal: AbortSignal.timeout(5_000) }),
          "oMLX model status",
        );
        return Array.isArray(data.models) && data.models.some((entry) => (
          (entry.id === model.id || entry.source_model_id === model.id) && entry.loaded === true
        ));
      },
      async unload() {
        await responseJson(
          await fetchImpl(unloadUrl, {
            method: "POST",
            headers,
            signal: AbortSignal.timeout(30_000),
          }),
          "oMLX model unload",
        );
      },
    };
  }

  return null;
}

export async function prepareLocalModelLifecycle(model, translated, options = {}) {
  if (model.backend.location !== "local") return null;
  const adapter = localModelAdapter(model, translated, options.fetchImpl ?? fetch);
  if (!adapter) {
    return {
      summary: `keep loaded · no unload adapter for ${model.provider}`,
      cleanup: async () => ({ status: "skipped", message: `No cleanup adapter for ${model.provider}` }),
    };
  }

  try {
    const wasLoaded = await adapter.isLoaded();
    if (wasLoaded) {
      return {
        summary: "keep loaded · it was already running before Bench",
        cleanup: async () => ({ status: "kept", message: "Model was already loaded before Bench" }),
      };
    }
    return {
      summary: "unload after run · only if bench loaded it",
      async cleanup() {
        try {
          if (!await adapter.isLoaded()) {
            return { status: "unchanged", message: "Model was not loaded after the run" };
          }
          await adapter.unload();
          return { status: "unloaded", message: `Unloaded ${model.provider}/${model.id}` };
        } catch (error) {
          const message = `Could not unload ${model.provider}/${model.id}: ${errorMessage(error)}`;
          return { status: "failed", message };
        }
      },
    };
  } catch (error) {
    return {
      summary: "keep loaded · status check failed",
      cleanup: async () => ({ status: "skipped", message: "Cleanup skipped because model status was unavailable" }),
      warning: errorMessage(error),
    };
  }
}
