# Phase 1 Migration Record

**Recorded:** 2026-09-13 23:11 IST  
**Branch:** `feat/unified-benchmark-suite`  
**Visual history decision:** Keep history only in the archived source repository; do not import it into `llm-benchmarks`.

## Repository setup

- Initialized a new Git repository in `/Users/eeshans/dev/llm-benchmarks`.
- Created the dedicated consolidation branch `feat/unified-benchmark-suite` before copying visual files.
- Expanded `.gitignore` before initialization so secrets, dependency environments, local results, build output, caches, and agent context remain untracked.
- Kept `internal-docs/unified-benchmark-suite-plan.md` in the new repository's candidate tracked files. The initial checkpoint commit remains pending approval.

## Migrated source

Copied the visual application's current working tree, including its protected uncommitted changes, into the compatible root layout:

- Six Markdown benchmark definitions into `benchmarks/` alongside `smoke.py`
- `src/lib`, `src/server`, `src/pages`, `src/components`, `src/styles`, and `src/env.d.ts`
- `public/`, including the existing tracked publish-safe export
- Visual scripts, Vitest tests, Playwright tests/configuration, mockups, screenshots, and deployment workflow
- Astro, TypeScript, and Vitest configuration
- The untracked `playwright.test.ts`
- Historical visual documentation under `internal-docs/visual-source/` without replacing the unified README or agent instructions

Every visual Git-tracked path is represented in the target. Conflicting root files were intentionally merged or archived rather than overwritten:

- Root `package.json` was merged and `package-lock.json` regenerated with npm.
- Root `.gitignore` was merged.
- Root `AGENTS.md` now describes the unified architecture and source-repository safety policy.
- Existing Inspect README remains authoritative until the final documentation phase; the visual README is archived under `internal-docs/visual-source/`.

## Migrated local artifacts

Copied as ignored local data, preserving file metadata and symlinks:

- `runs/`: approximately 4.8 GB, 130,816 regular files, 28 symlinks, 159 run directories
- `comparison-exports/`: approximately 45 MB, 6 files
- `public/export/`: approximately 448 MB, 376 tracked files, existing manifest with 117 published runs

Checksum-mode rsync dry runs reported zero differences for `runs/`, `comparison-exports/`, and `public/` after copying.

## Unified package and CI

- Package name is now `llm-benchmarks`.
- Preserved exact Pi dependency pins and merged Astro/viewer dependencies.
- Added separate and aggregate scripts for Bench and visual checks/tests.
- Regenerated the lockfile with `npm install`; did not copy either source lockfile over the other.
- Updated GitHub Pages CI to install uv/Python dependencies, run aggregate checks, run both test suites without `continue-on-error`, and build from the existing public export.

`npm ci` reports 3 audit findings (1 moderate, 1 high, 1 critical) and npm allow-script warnings for `esbuild`, `@google/genai`, and `protobufjs`. Installation and all validation commands still pass. Dependency remediation is separate from the functional migration.

## Validation

| Command | Result |
|---|---|
| `uv sync --locked` | Passed; 117 packages audited |
| `npm ci` | Passed; 637 packages installed |
| `npm run check` | Passed; Bench syntax/Python compile and visual type checks |
| `npm test` | Passed; 32 Bench tests and 109 visual tests |
| `STATIC_USE_EXISTING_EXPORT=true ASTRO_BASE=/ npm run build:static` | Passed; 6 benchmarks and 117 published runs |

Astro reports one non-failing TypeScript hint for the pre-existing unused `cleanLines` import in `src/ui/bench-ui.mjs`. No errors or warnings were reported.

The static build used the existing export and did not change `public/export/manifest.json`.

## Source repository verification

After all copying and validation, `/Users/eeshans/dev/local-llm-visual-benchmark` remains on `main` at `2057804` with exactly its original four modified files and one untracked file. Protected-file hashes match the Phase 0 snapshot. No Git operation or write was performed in the source repository.
