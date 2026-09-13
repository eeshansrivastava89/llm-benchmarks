---
title: "[Future] Browser WebGPU Local Inference Vision"
lastmod: 2026-05-22
---


## Vision

Browser-based local inference is a good future showcase for the project’s broader theme: private, local AI that runs on user-owned hardware. With llama.cpp WebGPU support, a small GGUF model can run directly inside a browser tab with GPU acceleration. The model downloads once, caches locally for that site origin, and can then run without sending prompts to a server.

This is not a replacement for the main local model benchmarks. It is an additive runtime experiment: a way to show what fully in-browser private AI can do, where it is useful, and where it still falls short.

## Practical Use Case

The most compelling use case is an opt-in public demo on one of the local AI sites:

> “Run a tiny private AI model in your browser. The model downloads to your device, runs locally with WebGPU, and your prompt does not leave the tab.”

This fits the project’s privacy/local-first story better than a server-hosted chatbot. It also gives non-technical visitors a concrete way to experience local inference without installing LM Studio, oMLX, llama.cpp, or a coding harness.

Good tasks for a browser model should stay small and focused:

- explain a short A/B test summary
- rewrite or summarize a small paragraph
- classify a small piece of text
- answer questions over a tiny provided context
- demonstrate CPU vs WebGPU speed
- compare browser-local output with desktop-local model output

Bad fits for the first version:

- serious coding
- full data science notebooks
- long-context analysis
- large document QA
- high-accuracy factual work
- anything requiring a large model download by default

## Product Shape

This should be opt-in, not automatic. The site should not download a model on page load.

A possible experience:

1. User opens a “Browser Local AI” demo page.
2. Page explains that a small model will be downloaded and cached locally.
3. Browser checks WebGPU support and memory budget if available.
4. User clicks “Download and run locally.”
5. The page loads a small GGUF model through wllama/llama.cpp WebGPU.
6. User runs a few short prompts.
7. The app shows basic runtime metrics: model, browser, device class, prefill speed, decode speed, first-token latency, and cache status.

## How It Relates to Benchmarking

This should be treated as a new backend/runtime axis, not a new quality benchmark category by itself.

Existing benchmark framing:

```text
model + backend + harness + prompt → artifact quality
```

Browser WebGPU framing:

```text
model + browser + WebGPU runtime + device → local-in-browser capability
```

If it becomes useful, the benchmark gallery could compare:

- browser WebGPU tiny model
- LM Studio desktop model
- oMLX desktop model
- llama.cpp server model

The value is not that the browser model wins on quality. The value is showing the tradeoff: zero server inference cost, strong privacy, simple access, smaller/weaker models, and browser-dependent performance.

## High-Level Implementation Plan

### Phase 1: Research spike

- Test the llama.cpp WebGPU/wllama package in a small standalone page.
- Confirm model loading, caching, browser support, and basic generation on Apple Silicon Chrome/Safari.
- Identify a small default model that is acceptable for download size and UX.

### Phase 2: Minimal demo page

- Add an opt-in browser-local demo page.
- Show clear download/cache/privacy messaging.
- Run a few fixed short prompts plus one custom prompt.
- Display basic runtime metrics and compatibility warnings.

### Phase 3: Benchmark integration

- Add a `browser-webgpu` runtime label to the benchmark metadata model.
- Save prompt, output, model, browser, and performance metrics as a run artifact.
- Compare browser-local outputs against desktop-local runs for lightweight tasks.

### Phase 4: Public storytelling

- Add a short explanation of where browser-local inference is practical.
- Emphasize privacy, offline potential, and zero server inference cost.
- Be explicit about limitations: model size, download time, browser variance, memory, and quality.
