import type { ModelSourceId } from "./types.ts";

/**
 * Canonical local/cloud backend identity mapping.
 *
 * Single source of truth for backend display labels and recorded
 * modelSource values, shared by run preparation (interactive-runner),
 * prepared-run metadata (prompt-prep), and metadata editing
 * (server/api-helpers). Add new backends here only.
 */
const BACKEND_IDENTITIES = {
  ollama: { modelSource: "ollama", label: "Ollama" },
  omlx: { modelSource: "omlx", label: "oMLX" },
  "llama-cpp": { modelSource: "llama-cpp", label: "llama.cpp" },
  "llama-cpp-mtp": { modelSource: "llama-cpp-mtp", label: "llama.cpp MTP" },
  lmstudio: { modelSource: "llama-cpp", label: "LM Studio" },
  mlx: { modelSource: undefined, label: "Base MLX" },
} as const satisfies Record<string, { modelSource: ModelSourceId | undefined; label: string }>;

export type BackendKey = keyof typeof BACKEND_IDENTITIES;

export function isBackendKey(value: string): value is BackendKey {
  return value in BACKEND_IDENTITIES;
}

export function backendIdentity(key: BackendKey): { modelSource?: ModelSourceId; label: string } {
  return BACKEND_IDENTITIES[key];
}

/** Display label for a recorded modelSource, with an optional cloud override. */
export function modelSourceLabel(source: ModelSourceId, customLabel?: string): string {
  if (source === "cloud") return customLabel ?? "Cloud";
  return isBackendKey(source) ? BACKEND_IDENTITIES[source].label : source;
}
