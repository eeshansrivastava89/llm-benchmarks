import { escapeAttribute, escapeHtml } from "./utils.js";
import { stackTone } from "./stack-tones.js";

/**
 * Stack-pill rendering. Tone mapping lives in ./stack-tones.js (shared with
 * src/lib/stack-tones.ts).
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
