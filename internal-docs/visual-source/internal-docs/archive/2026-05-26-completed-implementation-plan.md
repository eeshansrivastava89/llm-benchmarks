---
title: "[Completed] Local LLM Visual Benchmark - Implementation Plan"
lastmod: 2026-05-26
---


This is the single planning source of truth. The older product, design, and minimal-plan documents were consolidated here on 2026-05-10 because they had started to diverge.

## Agent Instructions

- Work one phase at a time.
- Keep this file updated when scope, ordering, or acceptance criteria change.
- Fix root causes and architectural problems instead of layering patches onto confused UX.
- For UI phases, run browser/visual QA plus the relevant automated tests before calling the phase complete.
- Pause after each phase with a short status, known issues, and next recommended phase.

## Product Thesis

Local LLM Visual Benchmark is not a universal benchmark for every local inference stack. It is an Apple Silicon daily-driver lab for finding which local AI stack is actually usable enough to replace frontier-model workflows for day-to-day creative coding, visual reasoning, and agentic tool use.

The product point of view is intentionally narrow:

```text
Apple Silicon
  -> MLX model artifacts
  -> oMLX or LM Studio model source
  -> coding harness
  -> visual benchmark task
  -> daily-driver verdict
```

The benchmark unit is the whole stack, not just the model. The same model can feel radically different depending on the runtime, cache behavior, memory pressure, model source, and coding harness. A run should therefore record the model, source backend, intended harness, actual harness when known, and enough evidence to explain whether the stack was usable.

This project should be honest about its scope: it is for the author's Apple Silicon workflow first, and useful to other Mac users with similar hardware second. Windows, Linux GPU, hosted inference, and broad enterprise serving concerns are not target use cases.

## Product Direction

Local LLM Visual Benchmark is a local-first visual evaluation lab for Apple Silicon users testing daily-driver local AI stacks. It should help users discover local models from oMLX and LM Studio, prepare visual benchmark run slots, inspect visual artifacts, compare model/harness attempts, and publish a clean static read-only gallery without hiding the filesystem evidence trail.

The app should feel like a focused lab bench, not an orchestration dashboard. It should stay small, explicit, file-backed, and transparent about what exists on disk.

### Users

Apple Silicon users who run visual prompts through oMLX, LM Studio, OpenCode, Pi, Hermes, or another local coding harness and want to inspect, compare, and share visual results.

Secondary users are other Mac local-LLM builders who want a practical reference stack instead of a generalized benchmark matrix.

### Core Principles

- Viewing is the product: prioritize artifact browsing, comparison, and inspection.
- Apple Silicon is the product boundary. Prefer MLX-native paths and avoid generalized runtime sprawl.
- Treat the coding harness as part of the benchmarked stack, not a neutral transport detail.
- Prefer one-command, low-configuration workflows over JSON editing and hand-built server commands.
- Preserve the filesystem contract: a run folder with `metadata.json` is canonical.
- Separate descriptive metadata from raw evidence artifacts.
- Keep backends explicit and user-owned; the app should not silently start, stop, or mutate external model servers.
- Support oMLX and LM Studio model discovery. oMLX is the primary daily-driver lane; LM Studio remains useful for model browsing and config sync.
- Use Astro pages/components and small client scripts. Avoid broad frontend frameworks until a component actually needs that complexity.
- DRY applies to data access, shared controls, and visual primitives. It does not mean unrelated user jobs should share the same screen.

## Run Storage Contract

Each visual run folder owns one canonical `metadata.json` record plus any evidence artifacts.

Supported run kinds:

- `visual`: visual benchmark attempts that may produce `index.html`, `preview.png`, `preview.webm`, and optional `preview.mp4`.
- `data-science`: data science benchmark attempts that may produce `analysis.ipynb`, `summary.json`, and chart PNGs (`chart-distribution.png`, `chart-treatment-effect.png`, `chart-completion-rates.png`).

Suggested folder shape:

```text
runs/
  {benchmark-id}/
    {model-slug}/
      {run-id}/
        metadata.json
        prompt.md
        request.json
        stream.ndjson
        response.txt
        index.html
        preview.png
        preview.webm
```

Metadata should describe labels and intent: run kind, model source, intended harness, actual harness, backend label, model label, base URL when relevant, launch command when relevant, benchmark label, status, notes, retries, fallbacks, and token metric source.

Evidence artifacts should remain separate: request JSON, stream chunks, response text, generated HTML, captured media, and optional command text.

Missing metrics must be represented as unavailable, not silently estimated. Estimated metrics are allowed only when explicitly labeled as estimated.

## Deprecated Scope

LightEval and other quantitative benchmark integrations are out of scope. They added too much setup complexity, unclear task/result semantics, and mixed a different job into the visual benchmark product. Do not add LightEval routes, setup steps, run preparation, result parsing, score rendering, or publish flows.

Existing LightEval folders on disk are user data and must not be deleted automatically. The visual app should ignore unsupported non-visual run metadata in normal browsing surfaces.

llama.cpp and `llama-server` are also deprecated from the public project workflow. They are powerful personal tools, but this project is no longer trying to expose GGUF path discovery, editable server commands, or llama.cpp status checks. Existing run metadata that mentions llama.cpp must remain readable as historical evidence, but no new first-class llama.cpp preparation UI, status API, or documentation should be added.

## Target Information Architecture

The app should use separate visual workspaces that share data and components underneath. Each workspace should have one primary job.

## Visibility Modes

The app has two visibility modes that must stay conceptually separate:

- Public/browse mode: read-only viewing surfaces that can be shared or statically exported. Gallery pages and visual comparison pages belong here when they expose only publish-safe artifacts.
- Server/operational mode: local-only controls that require filesystem access, backend setup, run preparation, editing, status checks, deletion, capture, import, or opening folders. These must stay out of static export and should only appear when the server APIs are available.

Rule of thumb: viewing is public-safe when it uses curated artifacts and summaries; operating is local-only when it mutates files, reveals local paths, exposes commands, checks local services, or depends on private run evidence.

Publish-safe by default:

- Preview images and videos.
- Prompt text and benchmark metadata.
- Model labels and high-level run summary metadata.

Local-only by default:

- Raw generated HTML.
- Raw responses, request payloads, stream logs, and command files.
- Full local paths, setup commands, model-source server status, capture actions, delete actions, and `Open in Finder`.

### Top-Level Workspaces

- `Workbench`: one visual browsing surface with mode tabs: `By prompt`, `By model`, and `Table`.
- `Prepare run`: visual creation flow that creates a run folder from an oMLX or LM Studio model and gives the exact prompt for the selected coding harness.
- `Compare`: table-row selection plus a side-by-side visual comparison panel inside the existing workbench; there is no separate Compare tab.

Prefer the home route as the canonical workbench. `/gallery` can remain as a compatibility alias, but the UI should not present separate Gallery and Runs surfaces.

### Workspace Responsibilities

`Workbench`

- Shows visual runs only.
- Defaults to `By prompt`, then offers `By model`, then `Table`.
- Uses only high-signal visual controls by default: model, prompt, and search. Do not add status or runner filters unless a real browsing problem proves they are needed.
- Opens the same visual detail view from cards and table rows.
- Allows capture or recapture only when local operational controls are available.
- Does not show unsupported quantitative runs.

`Visual detail`

- Shows preview/video as the main surface.
- Shows a compact state summary box.
- Shows the full prepared prompt from `prompt.md` when available, including the generated instructions and output path.
- Shows the run folder path.
- Does not show artifact inventories, runner metadata, or a separate metadata record modal unless a concrete user need returns.

`Prepare run`

- Shows prompt, model source, model, and coding harness inputs.
- Supports model listing from oMLX and LM Studio.
- Keeps LM Studio config sync for Pi/OpenCode, but does not make config sync the core product.
- Copy actions live next to the artifact they copy.
- The primary action always names the next concrete step: prepare folder, refresh models, copy prompt, run harness, capture media, or compare result.

## Design Baseline

- Use the warm local-tool palette already in `src/styles/global.css`.
- Keep typography compact and native-system.
- Avoid decorative SaaS chrome, gradients, and generic landing-page treatment.
- Make page density intentional: dense where users scan records, spacious where users inspect artifacts.
- Keep controls close to the workflow they affect. Do not show every filter on every page.
- Run detail modals/pages must be accessible: keyboard-reachable, focus-trapped for modals, visible focus states, and WCAG AA contrast.

## Current Assessment

Phase 1 and Phase 2 fixed important functionality, and Phase 2.5 removed the LightEval experiment after product review. The app is now back to a visual-only workbench.

The latest product pivot clarifies that the app should benchmark usable Apple Silicon stacks, not every local-LLM backend. The immediate model-source scope is therefore oMLX plus LM Studio:

- oMLX is the primary daily-driver path because the MLX artifacts and cache/server behavior are performing better on the author's Mac.
- LM Studio remains supported for listing loaded models and syncing discovered model config into local coding harnesses.
- llama.cpp/`llama-server` should be removed from the active workflow because it adds command/path complexity without matching the project's daily-driver goal.
- Coding harnesses such as OpenCode, Pi, and Hermes must be treated as first-class parts of the result because tool calling, context handling, and patch/application behavior materially change model usefulness.

The remaining work should protect both simplifications:

- Polish the visual workbench before adding new surfaces.
- Add oMLX model discovery and run-slot preparation without turning the app into a generalized backend manager.
- Remove llama.cpp-specific UI, API, command-generation, and docs while preserving old run records.
- Remove technical artifact/file-state clutter from the browsing cards unless it directly helps the user decide what to open next.
- Keep operational controls and local evidence available in server mode, but do not let them dominate public viewing.
- Treat comparison, scoring, and publishing as later phases after the basic visual viewer feels clean.

## Completed Work

### Phase 1: Foundation

- [x] Set Astro dev mode to server output while keeping static export as a separate build script.
- [x] Extended run metadata for schema version, kind, runner, notes, and typed artifact names.
- [x] Preserved compatibility with older visual run metadata.
- [x] Added folder-backed discovery for visual run metadata.
- [x] Added experimental llama.cpp GGUF path discovery and server status support; this is now deprecated and scheduled for removal from the active workflow.
- [x] Added tests for run metadata, export, prompt preparation, and supporting libraries.

### Phase 2: Functional Core UX

- [x] Added Visual and Quantitative section controls.
- [x] Added first-visit onboarding.
- [x] Made Gallery the default mode.
- [x] Removed stale global capture control.
- [x] Wired HTML polling for saved `index.html` arrival.
- [x] Added per-run `Capture preview` action.
- [x] Added metadata-first run record modal.
- [x] Prototyped LightEval preparation and parsed-result display, then deprecated it after product review.
- [x] Verified with E2E, unit tests, type/lint checks, builds, and visual QA.

Phase 2 is accepted as functional, not as the final UX architecture.

### Phase 2.5: LightEval Deprecation and Visual Simplification

Goal: remove quantitative benchmark scope and leave a focused visual benchmark viewer before adding comparison, ratings, or leaderboards.

- [x] Replace `state.section` and overloaded `state.mode` with a top-level workspace model.
- [x] Replace the separate Gallery/Runs IA with one visual workbench on the home route plus a `/gallery` compatibility alias.
- [x] Collapse Gallery/Runs into a single visual workbench with `By prompt`, `By model`, and `Table` modes.
- [x] Move the shared Astro shell into a reusable component so route pages do not duplicate markup.
- [x] Remove LightEval route, API endpoint, parser, constants, CSS, tests, setup docs, and prepare-run branches.
- [x] Filter or ignore unsupported non-visual metadata in normal run discovery/UI without deleting old folders.
- [x] Move shared data fetching, run normalization, artifact helpers, status labels, buttons, badges, and modal utilities into smaller reusable client modules where it reduces real complexity.
- [x] Keep the workbench visual-only and remove irrelevant LightEval/kind/runner filters from that surface.
- [x] Remove the Runs metadata-first surface from the active UI.
- [x] Route cards and table rows to the same visual detail experience.
- [x] Remove the metadata-first record detail from the active UI; table rows open visual detail.
- [x] Simplify visual detail to preview, state summary, full prompt, and run folder only.
- [x] Make `Prepare run` visual-only again and remove run-kind selection.
- [x] Reduce `public/viewer.js` where the LightEval and metadata-record removal created obvious dead branches. Further extraction is optional code hygiene, not a product blocker.
- [x] Update E2E coverage for the visual-only workbench, visual-only preparation, and absence of LightEval UI.
- [x] Run visual QA across the desktop workbench, table mode, and visual detail modal.

Acceptance criteria:

- A user can switch between prompt grouping, model grouping, and table view without navigating to a different workspace.
- No workspace shows filters that do not apply to that workspace.
- LightEval is not available in navigation, setup, prepare-run, API, or static export.
- Visual detail stays focused on the generated artifact, prompt, state, and run folder.
- Shared code remains reusable without collapsing different UX jobs into one page.

## Active Plan

### Phase 2.6: Visual Viewer Polish

Goal: make the visual-only workbench feel calm, obvious, and user-friendly before adding comparison or publishing features.

- [x] Remove technical artifact badge clutter from run cards. Cards should communicate readiness in user-facing language such as waiting, capture needed, or video ready.
- [x] Keep `By prompt` as the default browsing mode, with `By model` and `Table` as secondary scanning modes.
- [x] Recheck desktop and mobile layout density so groups, cards, and table rows do not feel cluttered.
- [x] Keep the visual detail sidebar layout: state summary, full prompt from `prompt.md`, and run folder. Do not reintroduce artifact inventories or runner metadata.
- [x] Verify prompt and run-folder scrolling/copy controls inside visual detail.
- [x] Keep local-only actions hidden in static/public mode and available in server mode.
- [x] Update E2E and visual QA for any polish changes.

Acceptance criteria:

- The default front page can be understood without knowing file artifact names.
- Opening a card/table row shows the visual artifact and only the minimum useful run context.
- The static/public surface exposes only publish-safe viewing data.

### Phase 2.7: oMLX Support and llama.cpp Deprecation

Goal: make oMLX and LM Studio the only supported model-source lanes, then remove llama.cpp from the active public workflow.

Scope:

- [x] Add an oMLX client for OpenAI-compatible model listing, defaulting to `http://127.0.0.1:8000/v1`.
- [x] Add `/api/omlx/models` with local-only error handling that matches the existing passive LM Studio model-listing behavior.
- [x] Add a shared model-source shape that can represent `omlx` and `lmstudio` records without losing source/backend labels.
- [x] Update Setup so users can refresh oMLX models and LM Studio models separately.
- [x] Update Prepare run so the user chooses model source, model, and harness before creating the run slot.
- [x] Record the model source/backend in `metadata.json` for new prepared runs.
- [x] Keep LM Studio model config sync for Pi/OpenCode as an LM Studio-specific helper.
- [x] Do not add oMLX config sync unless a concrete harness needs it; prefer oMLX's own simple launch commands.
- [x] Remove the `llama.cpp server command` runner option from Prepare run.
- [x] Remove llama.cpp status UI, status API, GGUF path discovery, generated `llama-server` command defaults, and related tests.
- [x] Preserve historical runs that already contain `backendLabel: "llama.cpp"` or command artifacts.
- [x] Update README and setup copy so the public workflow is oMLX-first, LM Studio-supported, and llama.cpp-free.
- [x] Add unit and E2E coverage for oMLX model listing and run-slot preparation.

Acceptance criteria:

- A user can list oMLX models and create a visual run slot from an oMLX model.
- A user can still list LM Studio models and sync LM Studio model config to supported harnesses.
- No active UI asks the user to paste or edit a llama.cpp/`llama-server` command.
- Existing llama.cpp-labeled historical runs still render in the workbench as evidence.
- The public docs describe the project as an Apple Silicon MLX/oMLX daily-driver stack, not a general local inference benchmark.

### Phase 3: Publishing

Start only after Phase 2.6 and Phase 2.7 are accepted.

- [x] Keep static export on the same prompt/model/table workbench instead of creating a separate public site.
- [x] Remove operational controls in static/public preview mode while preserving the browsing UI.
- [x] Present the published preview as daily-driver stack evidence, not a universal leaderboard.
- [x] Defer extra public information architecture such as `/prompt/<id>` and `/model/<slug>` pages until the workbench needs them.
- [x] Export only publish-safe artifacts by default: preview media, benchmark prompt text, benchmark metadata, and summary metadata.
- [x] Do not export raw generated HTML, raw responses, stream logs, launch commands, local paths, or operational controls by default.
- [x] Validate export path identifiers and run asset paths before reading or writing copied public assets.
- [x] Redact local paths and local URLs from public runner/capture metadata.
- [x] Resolve static manifest and copied asset URLs through the configured Astro base path for GitHub Pages-style deploys.

### Pre-Phase-4 Hardening

Goal: close the publish-safety and path-safety gaps before adding Compare UI.

- [x] Add regression tests for export path traversal in benchmark/model/run identifiers.
- [x] Add regression tests for traversal asset paths in saved run metadata.
- [x] Add regression tests for public export redaction of local paths and local URLs.
- [x] Add regression tests for static export URLs under the configured Astro base path.
- [x] Validate static export path identifiers before constructing output directories.
- [x] Reuse shared safe asset path resolution when hydrating local run metadata.
- [x] Omit unsafe/traversal asset paths from public export instead of copying them.
- [x] Redact local paths and local URLs from public runner/capture metadata.
- [x] Resolve static manifest and copied asset URLs through the configured Astro base path.
- [x] Verify with unit tests, Astro/TypeScript check, Playwright E2E, static build, and export privacy scan.

### Phase 4: Visual Comparison

The first Compare workspace is implemented and committed. Keep the remaining work narrow.

Completed:

- [x] Extract stack-attempt identity helper before adding Compare UI.
- [x] Cover stack-attempt identity with unit tests.
- [x] Extract compare selection state.
- [x] Extract/reuse media URL rendering seams for Compare.
- [x] Define stack attempt identity as model source + model artifact/slug + harness/intended runner + relevant run metadata; do not compare by model ID alone.
- [x] Build the first Compare workspace inside the existing workbench: multi-select visual runs, then side-by-side preview/video inspection.
- [x] Keep Compare publish-safe in static mode by rendering only exported summary metadata and preview/video media; local-only evidence such as local run folders, prepared prompts, commands, raw responses, and generated HTML remain local-only.

Completed cleanup:

- [x] Simplified Compare playback so selected videos autoplay, mute, loop, and hide controls.
- [x] Improved historical run identity fallbacks so older runs without `runner` metadata display `source unrecorded` instead of `unknown-source`.

### Phase 5: Harness and Daily-Driver Evaluation

Completed as a small extension of Compare:

- [x] Added optional harness/version label support in run metadata and stack identity display.
- [x] Deprecated the model-by-prompt summary matrix after review; side-by-side Compare remains the comparison surface.

## Decisions

- The public product thesis is Apple Silicon daily-driver stack evaluation, not universal local inference benchmarking.
- The primary stack is Apple Silicon + MLX artifacts + oMLX serving/cache + local coding harnesses.
- Supported model-source discovery lanes are oMLX and LM Studio.
- oMLX is the preferred daily-driver implementation lane.
- LM Studio remains supported for model discovery and config sync, but no longer defines the product.
- llama.cpp and `llama-server` are deprecated from the active project workflow.
- Ollama is not part of the active roadmap. Reconsider only if it becomes necessary for the Apple Silicon daily-driver goal.
- The app does not launch or stop oMLX, LM Studio, or any external coding harness in the current phases.
- Manual mode remains first-class.
- Coding harnesses are first-class benchmark context. Pi, OpenCode, Hermes, and manual chat can produce meaningfully different results with the same model.
- LightEval is deprecated and removed from product scope.
- Existing unsupported run folders are ignored by the app and never deleted automatically.
- Existing llama.cpp-era run folders are historical evidence and must remain readable, but no new llama.cpp helper workflow should be added.
- `metadata.json` remains canonical; do not add a second per-run manifest unless a concrete need appears.
- Runtime defaults may exist only as visible/editable UI defaults, not hidden fallbacks.
- Static export remains publish-safe and uses the same workbench as the local operational app; it only hides operational controls and loads exported data.
- Static export includes a build-time machine profile for the header pill; it does not run live system telemetry in the browser.
- Static export is read-only on GitHub Pages; features that require production writes need a separate backend decision first.

## Repository Hygiene

Keep the repository focused on source, tests, setup files, public-safe fixtures, and documentation intended for contributors.

Ignored local-only state:

- Local agent context folders: `.claude/`, `.codex/`, `.pi/`.
- Python virtual environments and caches: `.venv/`, `venv/`, `env/`, `__pycache__/`, `.pytest_cache/`, `.ruff_cache/`, `.mypy_cache/`.
- Local secrets: `.env`, `.env.*`, except checked-in examples such as `.env.example`.
- Generated run data, build output, Playwright reports, and QA screenshots.

Setup instructions should tell users how to recreate ignored dependencies and local state rather than committing those generated folders.

## Immediate Next Step

Phase 1 of the data-science benchmark is complete. Phase 2 (metrics ribbon, verdict pill, E2E tests, visual QA) is next.

See `data-science-benchmark-plan.md` for the full plan, scoring approach, and implementation phases.
