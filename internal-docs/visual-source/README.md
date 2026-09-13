<div align="center">

# Local LLM Visual Benchmark

**A creative way to see whether your local models are actually good enough: ask them to build visual experiences, then compare the results.**

[![site](https://img.shields.io/badge/demo-live-cb9f6a)](https://localai.eeshans.com/)
[![node](https://img.shields.io/badge/node-24%2B-3c873a)](package.json)
[![astro](https://img.shields.io/badge/built%20with-Astro-ff5d01)](https://astro.build/)
[![typescript](https://img.shields.io/badge/TypeScript-6.x-3178c6)](https://www.typescriptlang.org/)
[![platform](https://img.shields.io/badge/platform-Apple%20Silicon-blue)]()

[Live workbench](https://localai.eeshans.com/) • [Source](https://github.com/eeshansrivastava89/local-llm-visual-benchmark) • [eeshans.com](https://eeshans.com)

<img width="1467" height="897" alt="image" src="https://github.com/user-attachments/assets/6499b82d-1cba-402e-b2c6-eca3f3b6076e" />


> **Requirements:** [Node.js 24+](https://nodejs.org/) and [offgrid-ai](https://www.npmjs.com/package/offgrid-ai) for running benchmarks.

```bash
npm install
npm run dev
```

</div>

## Why this exists

Model benchmarks are usually abstract: scores, tokens, leaderboards, and tiny deltas that do not always explain what a model can actually do.

This project takes a more practical route. It gives models small visual build tasks like a solar system, a sakura tree, a macro wildflower scene, or a sunset ocean study. The model has to produce a working HTML artifact. The app captures a screenshot and 20-second preview video, then lets you compare outputs by model or by prompt.

If a model understands layout, animation, visual hierarchy, browser APIs, and instruction-following, the result usually looks better. If it struggles, you can see exactly where it falls apart.

The point of view is intentionally narrow: this is an Apple Silicon daily-driver stack benchmark, not a universal local-inference leaderboard. The project is about finding which combination of model source (oMLX, LM Studio, Ollama, cloud), model artifact (GGUF quant, MLOX format, API), coding harness (Pi, OpenCode, manual chat), and prompt workflow is usable enough for real local work.

## How it works

### Running benchmarks with offgrid-ai

[offgrid-ai](https://www.npmjs.com/package/offgrid-ai) is the runner — it manages local models, launches servers, and prepares benchmark runs.

```bash
npm install -g offgrid-ai
offgrid-ai models          # select a model → run, benchmark, or inspect
offgrid-ai run <profile>   # start the model server and open Pi
offgrid-ai benchmark       # prepare a benchmark run (standalone)
```

The model-first flow in `offgrid-ai models` lets you pick a model, then choose an action:

1. **Run** — start the server and open Pi
2. **Benchmark** — choose a prompt, create a run slot in this repo
3. **Reconfigure** — change context window, MTP, or other settings
4. **Details** — inspect ports, paths, and flags

For benchmark runs, offgrid-ai creates the run directory under `runs/` with `metadata.json` and `prompt.md`, then you:

1. Start the model with `offgrid-ai run <profile>`
2. Open the gallery with `npm run dev`
3. Find your run in the gallery and copy the prompt from the run details
4. Paste into Pi and generate

### Using the workbench

1. Open the app locally with `npm run dev`.
2. Browse results in the workbench using **By prompt**, **By model**, or **Compare** views.
3. Toggle cloud models on/off with the **Include cloud models** checkbox.
4. In **Compare**, select rows to compare visual runs side by side.

The live site is the same workbench as a static export of captured results. The local app is where run preparation, capture, deletion, folder-opening, and config sync happen.

### Cloud model benchmarks

Cloud models (GPT, Claude, Gemini, DeepSeek, etc.) are benchmarked the same way: `offgrid-ai benchmark` → choose "Custom / cloud" → enter a model name. The prompt is copied into your cloud tool of choice. No local server needed.

## Supported backends

| Backend | Type | Model source | Setup |
|---|---|---|---|
| **llama.cpp** | Local server | `~/.lmstudio/models/` GGUF | `offgrid-ai models` → Set up |
| **llama.cpp MTP** | Local server (speculative decoding) | `~/.lmstudio/models/` GGUF | `offgrid-ai models` → Set up → MTP variant |
| **Ollama** | Managed server | Ollama API (`localhost:11434`) | `offgrid-ai models` → Set up |
| **oMLX** | Managed server | oMLX API (`127.0.0.1:8000`) | `offgrid-ai models` → Set up |
| **Cloud** | No server | Any OpenAI-compatible API | `offgrid-ai benchmark` → Custom / cloud |

## Setup

Install dependencies:

```bash
npm install
```

Start the local gallery:

```bash
npm run dev
```

oMLX defaults to:

```text
http://127.0.0.1:8000/v1
```

LM Studio defaults to:

```text
http://localhost:1234/v1
```

Ollama defaults to:

```text
http://localhost:11434/v1
```

## Publishing your own gallery

After you capture some runs locally:

```bash
npm run publish
git add public/export
git commit -m "data: publish gallery update"
git push
```

That single publish command refreshes the publish-safe gallery snapshot in `public/export/`, runs checks/tests, and creates a smoke-testable static site in `dist-static/`.

The GitHub Pages workflow deploys at `https://localai.eeshans.com/` on every push to `main`.

## Architecture notes

The browser workbench is intentionally one site, not separate local and public apps. Local dev mode and the static GitHub Pages export share the same Astro page and viewer modules. Static mode only loads `export/manifest.json` and hides local operational controls.

The viewer bootstrap lives in `public/js/app.js`; feature behavior is split into small controller modules under `public/js/` for data loading, model sources, capture, prepare-run, detail actions, workbench rendering, operational-control visibility, icons, and the machine-profile pill.

Captured videos default to 20 seconds at 1600×900. The defaults are defined in `src/lib/capture-media.ts` as `DEFAULT_VIDEO_DURATION_MS` and `DEFAULT_VIEWPORT`.

## Local folders

| Folder | Purpose |
|---|---|
| `benchmarks/` | Source benchmark prompts |
| `runs/` | Local run folders, generated prompts, HTML, screenshots, and videos |
| `public/export/` | Tracked publish-safe gallery snapshot: manifest plus copied preview media |
| `dist-static/` | Final static site artifact |

`runs/` and `dist-static/` are ignored by git so local experiments and build output do not get committed accidentally. `public/export/` is tracked because it is the public gallery data source.

## Commands

```bash
npm run dev           # local app with operational controls
npm run build         # server/API build
npm run build:static  # static gallery build from existing export
npm run publish       # refresh export, validate, and build static site
npm test              # unit tests
npm run test:e2e      # Playwright tests
npm run check         # Astro + TypeScript checks
```

## Privacy

- Runs are local by default.
- oMLX, LM Studio, and Ollama stay on your machine.
- The production site may use PostHog pageview analytics; local builds keep analytics disabled unless explicitly enabled with public env vars.
- The app only publishes captured media, the benchmark prompt text, publish-safe summary metadata, and a build-time machine profile when you build the static export.
- Raw generated HTML, prepared run prompts, raw responses, stream logs, launch commands, local service URLs, and local filesystem paths are kept local and are not included in the published workbench.

## License

Personal project by [Eeshan Srivastava](https://eeshans.com).