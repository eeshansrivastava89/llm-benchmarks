import { randomUUID } from "node:crypto";

import { BenchError, errorMessage } from "./errors.mjs";
import { MODEL_DISCOVERY_TIMEOUT_MS } from "./providers.mjs";

export function apiLabel(api) {
  return {
    "openai-completions": "OpenAI Chat",
    "openai-responses": "OpenAI Responses",
    "anthropic-messages": "Anthropic Messages",
    "google-generative-ai": "Google GenAI",
  }[api] ?? api;
}

// Single source of truth for whether a Pi model can be translated into an
// Inspect invocation. The picker shows the issue; the resolver throws it.
export function inspectCompatibilityIssue(modelRuntime, model) {
  if (modelRuntime.isUsingSubscription(model.provider)) {
    return {
      short: "subscription login",
      reason: `Subscription-backed provider "${model.provider}" is not supported by Inspect yet`,
    };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(model.provider)) {
    return {
      short: "provider ID",
      reason: `Provider "${model.provider}" cannot be represented as an Inspect service name`,
    };
  }
  if (!["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"].includes(model.api)) {
    return {
      short: "unsupported API",
      reason: `Unsupported Pi API "${model.api}" for ${model.provider}/${model.id}`,
    };
  }
  if (model.api === "anthropic-messages" && ["azure", "bedrock", "vertex"].includes(model.provider)) {
    return {
      short: "adapter required",
      reason: `Anthropic service name "${model.provider}" requires a dedicated compatibility adapter`,
    };
  }
  if (model.api === "google-generative-ai" && model.id.includes("/")) {
    return {
      short: "model ID",
      reason: `Google model ID "${model.id}" cannot be represented by Inspect`,
    };
  }
  return null;
}

export function modelCompatibility(modelRuntime, model) {
  if (model.unavailableReason) return { ready: false, short: "missing metadata", reason: model.unavailableReason };
  const issue = inspectCompatibilityIssue(modelRuntime, model);
  if (issue) return { ready: false, ...issue };
  if (model.backend?.location === "local" && model.backend.status === "offline") {
    return { ready: false, short: "server offline", reason: "Local server is offline" };
  }
  return { ready: true, short: "ready", reason: "Ready for Inspect" };
}

export function modelPiReady(model) {
  return !model.unavailableReason && (model.backend?.location !== "local" || model.backend.status !== "offline");
}

function providerIdForInspect(provider) {
  // Guaranteed by inspectCompatibilityIssue; kept as a guard at the boundary.
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(provider)) {
    throw new BenchError(`Provider "${provider}" cannot be represented as an Inspect service name`);
  }
  return provider;
}

export async function resolveInspectModel(modelRuntime, model) {
  const issue = inspectCompatibilityIssue(modelRuntime, model);
  if (issue) throw new BenchError(issue.reason);

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
      inspectModel = `anthropic/${service}/${model.id}`;
      apiKeyEnv = "ANTHROPIC_API_KEY";
      childEnv.ANTHROPIC_AUTH_TOKEN = "";
      break;
    }
    case "google-generative-ai":
      inspectModel = `google/${model.id}`;
      apiKeyEnv = "GOOGLE_API_KEY";
      childEnv.GOOGLE_USE_ADC = "";
      childEnv.GOOGLE_GENAI_USE_VERTEXAI = "";
      break;
    default:
      // Unreachable: inspectCompatibilityIssue rejects unknown APIs first.
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