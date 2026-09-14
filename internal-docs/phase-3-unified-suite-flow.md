# Phase 3: Unified suite flow

Completed on 2026-06-11 on `feat/unified-benchmark-suite`.

## Changes

- Added the Suite screen between Model and Benchmark. Its choices are Inspect evals, Visual Bench, and Data Science.
- Deferred Inspect task discovery, compatibility enforcement, and authentication translation until Inspect is selected. A missing or broken Inspect installation no longer prevents access to the interactive suites.
- Changed model rows to distinguish `Pi + Inspect` from `Pi only`. Offline local servers remain unavailable to every suite.
- Kept the existing Inspect source tabs and configuration flow. Their step numbers moved forward by one to account for Suite.
- Added searchable Visual and Data Science benchmark screens backed by `loadInteractiveBenchmarkSuites()`.
- Added a Data Science credential check before review. It reads the shell or project `.env` and does not create a run directory.
- Rejected arguments after `--` on interactive suites with an error that lets the user return to Suite or switch to Inspect.
- Added the interactive review receipt. It names expected assets, the absolute `runs/` root, the planned Pi handoff, and provider-specific cleanup behavior.
- Added Back paths from Suite to Model, Benchmark to Suite, and interactive Review to Benchmark. Existing cancellation behavior is unchanged.
- Updated `.bench-state.json` to schema 2. It stores the selected suite and one benchmark ID per interactive suite while retaining the most recent Inspect source and task.

Phase 3 stops after the interactive review. The review says that no slot will be created; foreground Pi execution and cleanup are Phase 4 work.

## New shared workflow module

`src/suite-workflow.mjs` contains the pure suite-choice, review, passthrough-validation, and preference-update logic used by the CLI. Expected output names come from `buildRunAssets()` in the canonical run-preparation module, so the review and metadata cannot drift. Benchmark discovery and run preparation remain in the canonical visual modules through `src/benchmark-suites.mjs`.

## Validation

- `npm run check`: passed; the pre-existing unused `cleanLines` TypeScript hint remains.
- `npm test`: passed; the current suite contains 43 Bench tests and 114 visual tests. The final header regression test also passed in a focused run.
- `uv lock --check`: passed.
- `npm run build:static`: passed with 6 benchmarks and 159 runs in the generated export.
- `git diff --check`: passed.

One Inspect registry test took about 229 seconds during the aggregate run. It passed without a code or fixture change.
