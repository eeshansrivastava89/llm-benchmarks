import type { LMStudioModel } from "./types";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_BASE_URL = "http://localhost:1234/v1";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface LMStudioRequestOptions {
  baseUrl?: string;
  localModelRoot?: string | false;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface LMStudioConnectionResult {
  ok: boolean;
  baseUrl: string;
  error?: string;
}

interface ModelsResponse {
  data?: unknown;
}

export function normalizeLmStudioBaseUrl(baseUrl?: string): string {
  const raw = baseUrl?.trim() || DEFAULT_BASE_URL;
  let url: URL;

  try {
    url = new URL(raw);
  } catch (error) {
    throw new Error(`Invalid LM Studio base URL "${raw}": ${formatCause(error)}`);
  }

  url.hash = "";
  url.search = "";

  const pathname = url.pathname.replace(/\/+$/u, "");
  url.pathname = pathname.length === 0 ? "/v1" : pathname;

  return url.toString().replace(/\/+$/u, "");
}

export async function checkLmStudioConnection(
  baseUrl?: string,
  options: Omit<LMStudioRequestOptions, "baseUrl"> = {}
): Promise<LMStudioConnectionResult> {
  const normalizedBaseUrl = normalizeLmStudioBaseUrl(baseUrl);

  try {
    await fetchJson(`${normalizedBaseUrl}/models`, {
      method: "GET",
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      context: "checking LM Studio connection"
    });

    return {
      ok: true,
      baseUrl: normalizedBaseUrl
    };
  } catch (error) {
    return {
      ok: false,
      baseUrl: normalizedBaseUrl,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function listLmStudioModels(
  baseUrl?: string,
  options: Omit<LMStudioRequestOptions, "baseUrl"> = {}
): Promise<LMStudioModel[]> {
  const normalizedBaseUrl = normalizeLmStudioBaseUrl(baseUrl);
  const body = (await fetchJson(`${normalizedBaseUrl}/models`, {
    method: "GET",
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    context: "listing LM Studio models"
  })) as ModelsResponse;

  if (!Array.isArray(body.data)) {
    throw new Error("Malformed LM Studio /models response: expected data array.");
  }

  const localModels = options.localModelRoot === false
    ? []
    : await discoverLocalGgufModels(options.localModelRoot);

  return body.data.map((model, index) => {
    if (!isRecord(model) || typeof model.id !== "string") {
      throw new Error(
        `Malformed LM Studio /models response: model at index ${index} is missing a string id.`
      );
    }

    const localPath = matchLocalGgufPath(model.id, localModels);

    return {
      id: model.id,
      ...(localPath ? { localPath } : {})
    };
  });
}

export async function discoverLocalGgufModels(
  root = join(homedir(), ".lmstudio", "models")
): Promise<string[]> {
  const matches: string[] = [];

  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 5) return;

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path, depth + 1);
        return;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".gguf") && !entry.name.toLowerCase().startsWith("mmproj")) {
        matches.push(path);
      }
    }));
  }

  await visit(root, 0);
  return matches.sort((a, b) => a.localeCompare(b));
}

function matchLocalGgufPath(modelId: string, paths: string[]): string | undefined {
  const tokens = modelTokens(modelId);
  if (tokens.length === 0) return undefined;

  const ranked: Array<{ path: string; score: number }> = [];
  for (const path of paths) {
    const haystack = normalizeForModelMatch(path);
    const score = tokens.filter((token) => haystack.includes(token)).length;
    ranked.push({ path, score });
  }

  const requiredScore = Math.max(2, Math.ceil(tokens.length * 0.75));
  ranked.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const [best, second] = ranked;
  if (!best || best.score < requiredScore) return undefined;
  if (second && second.score === best.score) return undefined;
  return best.path;
}

function modelTokens(modelId: string): string[] {
  const vendorNoise = new Set(["google", "zai", "org", "lmstudio", "community", "local", "unsloth"]);
  return normalizeForModelMatch(modelId)
    .split(" ")
    .filter((token) => token.length > 1 && !vendorNoise.has(token));
}

function normalizeForModelMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

async function fetchJson(
  url: string,
  options: RequestInit & {
    context: string;
    timeoutMs?: number;
  }
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const abortController = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const abortFromCaller = () => abortController.abort(options.signal?.reason);

  if (options.signal?.aborted) {
    throw new Error(`LM Studio ${options.context} was aborted.`);
  } else {
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  if (timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      abortController.abort(new DOMException("Request timed out", "TimeoutError"));
    }, timeoutMs);
  }

  try {
    const response = await fetch(url, {
      ...options,
      signal: abortController.signal
    });

    if (!response.ok) {
      throw new Error(
        `LM Studio request failed with HTTP ${response.status} ${response.statusText} while ${options.context}.`.trim()
      );
    }

    return await response.json();
  } catch (error) {
    if (timedOut) {
      throw new Error(`LM Studio ${options.context} timed out after ${timeoutMs}ms.`);
    }

    if (isAbortError(error) || abortController.signal.aborted) {
      throw new Error(`LM Studio ${options.context} was aborted.`);
    }

    if (error instanceof Error && error.message.includes("HTTP ")) {
      throw error;
    }

    throw new Error(`LM Studio ${options.context} network error: ${formatCause(error)}`);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function formatCause(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
