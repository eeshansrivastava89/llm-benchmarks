import { escapeAttribute, escapeHtml } from "./utils.js";

/**
 * Stack-pill tone mapping.
 *
 * This mirrors src/lib/stack-tones.ts for the browser bundle.
 * Keep the two in sync when adding or changing tone mappings.
 */

export function renderStackSummary(stack) {
  return '<span class="stack-summary" aria-label="' + escapeAttribute(stack.label) + '">' +
    renderStackPill(stack.backend, "backend") +
    renderStackPill(stack.harness, "harness") +
  '</span>';
}

export function renderStackPill(label, role) {
  if (!label) return "";
  return '<span class="stack-pill" data-stack-role="' + escapeAttribute(role) + '" data-stack-tone="' + escapeAttribute(stackTone(label, role)) + '">' + escapeHtml(label) + '</span>';
}

function stackTone(label, role) {
  const value = String(label ?? "").toLowerCase();
  if (role === "harness") {
    if (/\bpi\b/u.test(value)) return "pi";
    if (/opencode|open code/u.test(value)) return "opencode";
    if (/hermes/u.test(value)) return "hermes";
    if (/manual/u.test(value)) return "manual";
    return "harness";
  }
  if (/cloud|gpt|chatgpt|openai|anthropic|claude/u.test(value)) return "cloud";
  if (/omlx|base mlx/u.test(value)) return "omlx";
  if (/llama\.cpp mtp|llama-cpp-mtp/u.test(value)) return "llamacpp-mtp";
  if (/llama\.cpp|llamacpp|lm studio|lmstudio/u.test(value)) return "llamacpp";
  if (/ollama/u.test(value)) return "ollama";
  if (/source unrecorded|unrecorded/u.test(value)) return "unknown";
  return "backend";
}