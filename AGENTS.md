# AGENTS.md

Project-specific instructions for coding agents working on the unified benchmark suite.

## Product boundary

`bench` is the single workflow for Inspect, Visual, and Data Science benchmarks. Pi is the source of truth for providers, models, and authentication. Inspect remains the source of truth for Inspect tasks and `.eval` logs. The visual application remains the source of truth for Markdown benchmark prompts, run preparation, capture, scoring, and gallery exports.

Do not restore the old offgrid/minimal-ai runner or create duplicate provider, prompt, run-path, metadata, or asset logic.

## Migration safety

`/Users/eeshans/dev/local-llm-visual-benchmark` is an untouched, read-only migration source until the unified repository is fully built and validated. Reading and copying from it is allowed. Do not commit, stash, clean, reformat, regenerate, or delete anything there.

Historical `runs/` and `comparison-exports/` are ignored local data but must be preserved. `public/export/` is the tracked publish-safe gallery snapshot.

Never copy or commit `.env`, provider credentials, root dependency environments, caches, build output, or agent context directories.

## Repository layout

- `bin/bench.mjs` and `src/*.mjs` — Bench CLI, provider discovery, Inspect planning, and lifecycle handling
- `src/bench_inspect/` — project-local Inspect compatibility hooks
- `src/lib/`, `src/server/`, `src/pages/`, `src/components/`, `src/styles/` — visual/data-science application
- `benchmarks/*.py` — local Inspect tasks
- `benchmarks/*.md` — visual/data-science benchmark definitions
- `test/` — Bench Node tests
- `tests/` — visual Vitest and Playwright tests
- `logs/` — ignored Inspect logs
- `runs/` — ignored visual/data-science runs
- `public/export/` — tracked public gallery snapshot

## Validation

Use the narrow command while iterating, then run aggregate checks before committing:

```bash
npm run check:bench
npm run check:visual
npm run check
npm run test:bench
npm run test:visual
npm test
uv lock --check
```

Use `npm run build:static` when changing the viewer, export pipeline, or deployment. Avoid `npm run publish` unless the public export should be regenerated and committed.

## Publishing

`npm run publish` refreshes `public/export/`, runs aggregate checks and tests, and creates the static build. Public exports must not include raw generated HTML, prepared prompts, raw responses, logs, command files, local URLs, local paths, or secrets.

## Keep changes focused

Follow `internal-docs/unified-benchmark-suite-plan.md` phase by phase. Preserve the native Inspect and visual result formats, avoid broad reorganization during consolidation, and prefer shared domain modules over parallel implementations.
