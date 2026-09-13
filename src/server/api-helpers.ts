
export class ApiRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

/**
 * Request validation and input-reading helpers for the local API.
 *
 * Extracted from api.ts to keep the API class focused on handler logic.
 */

export type EditableRunBackend = "unrecorded" | "omlx" | "llama-cpp" | "llama-cpp-mtp" | "llama.cpp" | "lmstudio" | "ollama" | "mlx" | "cloud" | "custom";
export type EditableRunHarness = "manual" | "pi" | "opencode" | "hermes";

export function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiRequestError(400, `${field} must be a non-empty string.`);
  }
  return value.trim();
}

export function readOptionalString(value: unknown, field: string): string | undefined {
  if (typeof value === "undefined" || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ApiRequestError(400, `${field} must be a string.`);
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function readOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new ApiRequestError(400, `${field} must be a boolean.`);
  }
  return value;
}

export function readStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new ApiRequestError(400, `${field} must be a string array.`);
  }
  const result = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  if (result.length === 0) {
    throw new ApiRequestError(400, `${field} must contain at least one item.`);
  }
  return result;
}

export function readRunBackend(value: unknown): EditableRunBackend {
  if (value === undefined || value === null || value === "") {
    return "unrecorded";
  }
  if (
    value === "unrecorded" ||
    value === "ollama" ||
    value === "omlx" ||
    value === "llama-cpp" ||
    value === "llama-cpp-mtp" ||
    value === "lmstudio" ||
    value === "llama.cpp" ||
    value === "mlx" ||
    value === "cloud" ||
    value === "custom"
  ) {
    return value;
  }
  throw new ApiRequestError(400, "backend must be unrecorded, ollama, omlx, llama-cpp, llama-cpp-mtp, cloud, or mlx.");
}

export function readRunHarness(value: unknown): EditableRunHarness {
  if (value === undefined || value === null || value === "") {
    return "manual";
  }
  if (value === "manual" || value === "pi" || value === "opencode" || value === "hermes") {
    return value;
  }
  throw new ApiRequestError(400, "harness must be manual, pi, opencode, or hermes.");
}

export function harnessLabel(harness: EditableRunHarness): string {
  if (harness === "pi") return "Pi";
  if (harness === "opencode") return "OpenCode";
  if (harness === "hermes") return "Hermes";
  return "manual";
}

export function assertWritesEnabled(enableWrites: boolean): void {
  if (!enableWrites) {
    throw new ApiRequestError(403, "Write actions are only available in dev server mode.");
  }
}