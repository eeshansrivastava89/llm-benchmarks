# Phase 2 Shared Visual Integration

**Completed:** 2026-09-13 23:37 IST
**Branch:** `feat/unified-benchmark-suite`

## Outcome

Bench and the visual viewer now share the same Markdown benchmark catalog and canonical run-preparation modules. No benchmark IDs, prompts, run paths, metadata serializers, or asset contracts are duplicated in the Bench adapter.

## Changes

- Added required `kind` frontmatter validation in `src/lib/benchmarks.ts`.
- Classified all six repository benchmarks through frontmatter: five `visual`, one `data-science`.
- Added `src/benchmark-suites.mjs` as the small Bench-facing adapter around `loadBenchmarks()` and `prepareRun()`.
- Derived the repository and runs roots from the adapter module location rather than requiring an external visual repository setting or relying on the caller's working directory.
- Added explicit `.ts` extensions through the TypeScript module chain used directly by Node.
- Made benchmark kind part of new benchmark/run records and public benchmark exports.
- Removed the viewer's hardcoded Data Science benchmark ID; viewer filtering now uses benchmark kind metadata.
- Added the canonical `supabase.json` path to run paths.
- Required valid Supabase URL/key configuration before any Data Science run directory is created.
- Limited `supabase.json` creation to Data Science runs and writes it with mode `0600`.
- Reads only the two required Supabase values from the project `.env`, with shell values taking precedence, without mutating `process.env`.
- Updated the existing static manifest's six benchmark catalog entries with kind metadata while preserving its 117 published runs.

## Tests

- Node tests directly import the TypeScript-backed adapter, proving the runtime import path works without a build step.
- Discovery tests assert the current five Visual IDs and one Data Science ID while the implementation remains frontmatter-driven.
- Fixture-based tests verify persisted metadata and initial assets for both run kinds.
- Data Science tests cover project `.env`, shell precedence, private file permissions, and failure before slot creation when access is missing.
- Viewer tests verify kind-based filtering without benchmark-ID special cases.

## Validation

| Command | Result |
|---|---|
| `npm run check` | Passed; 0 errors, one pre-existing unused-import hint |
| `npm test` | Passed; 37 Bench tests and 114 visual tests |
| `uv lock --check` | Passed; 117 packages resolved |
| `STATIC_USE_EXISTING_EXPORT=true ASTRO_BASE=/ npm run build:static` | Passed; existing 6-benchmark/117-run export preserved |

The original visual repository remains untouched.
