/**
 * Typed shim over the canonical browser-served implementation in
 * public/js/stack-tones.js. The browser workbench is served verbatim from
 * public/ and cannot import from src/, so the shared module lives there and
 * the Node side (src/lib/comparison-video.ts) imports it through this shim.
 */
export type StackRole = "backend" | "harness";

export { stackTone } from "../../public/js/stack-tones.js";
