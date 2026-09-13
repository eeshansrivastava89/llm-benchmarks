# Phase 0 Baseline

**Recorded:** 2026-09-13 22:57 IST  
**Canonical target:** `/Users/eeshans/dev/llm-benchmarks`  
**Untouched visual source:** `/Users/eeshans/dev/local-llm-visual-benchmark`

## Safety policy

The original visual repository is a read-only migration source until the unified repository is built and validated. Copying from it is allowed; committing, stashing, cleaning, regenerating outputs, or otherwise modifying it is not.

The five pre-existing visual working-tree changes were copied to the ignored local backup at `.bench-migration/visual-uncommitted-backup/`. Their SHA-256 manifest and before/after source-state records are also under `.bench-migration/`.

Visual baseline commands were run from an isolated working-tree copy. After the checks, the source repository still had the same branch, HEAD, Git status, and protected-file hashes:

- Branch: `main`
- HEAD: `2057804`
- Modified: `benchmarks/sakura.md`, `package-lock.json`, `package.json`, `playwright.config.ts`
- Untracked: `playwright.test.ts`

## Inspect baseline

| Command | Result |
|---|---|
| `npm run check` | Passed |
| `npm test` | Passed, 32/32 tests |
| `uv lock --check` | Passed, 117 packages resolved |

The first test attempt passed 30/32 tests but exposed a stale `.venv/bin/inspect` shebang pointing at the directory's pre-rename path. Reinstalling only `inspect-ai` with `uv sync --reinstall-package inspect-ai` regenerated the executable for `/Users/eeshans/dev/llm-benchmarks`; the complete 32-test suite then passed. This was a local environment repair, not a source change.

A 26-file SHA-256 inventory of the current Inspect source, tests, lockfiles, benchmark data, and internal plans is recorded in `internal-docs/phase-0-inspect-source-manifest.sha256`.

## Visual baseline

The visual project was copied to `.bench-migration/visual-baseline-worktree` without `.git`, secrets, dependencies, run data, generated output, caches, or agent context. The temporary copy read the original `runs/` directory while writing all generated exports and build output inside the temporary copy. The copy was removed after validation; command logs remain under `.bench-migration/logs/`.

| Command | Result |
|---|---|
| `npm ci` | Passed; npm reported 11 dependency audit findings (3 moderate, 7 high, 1 critical) |
| `npm run check` | Passed; 50 files, 0 errors/warnings/hints |
| `npm test` | Passed; 16 files and 109 tests |
| `npm run build:static` | Passed; 6 benchmarks and 159 runs |

## Local data that must be retained

| Data | Files/entries | Size | Migration requirement |
|---|---:|---:|---|
| Inspect logs | 19 | 8,910,872 bytes | Already in canonical target; retain as ignored data |
| Inspect task configs | 1 | 1,312 bytes | Already in canonical target; retain as ignored data |
| Inspect sweep artifacts | 523 | 14,931,609 bytes | Retain locally |
| Inspect sweep data | 1 | 72,556 bytes | Retain as versioned project data |
| Visual/data-science runs | 130,816 regular files plus 28 symlinks; 159 run directories across 6 benchmarks | approximately 4.8 GB | Copy all artifacts into unified `runs/`; preserve source copy |
| Visual public export | 376 files; manifest contains 6 benchmarks and 117 runs | 447,937,549 bytes | Preserve tracked publish-safe export |
| Visual comparison exports | 6 files | 45,152,496 bytes | Copy all into unified `comparison-exports/`; preserve source copy |

The existing public export contains 117 runs while current local run discovery finds 159. Both datasets must be retained: copy all raw runs and preserve the current tracked public export rather than assuming one replaces the other.

## Exclusions from repository-level copying

Do not migrate root dependency environments, secrets, generated builds, caches, or agent context directories: root `node_modules/`, root `.venv/`, `.env*`, `.astro/`, `dist/`, `dist-static/`, test/browser output, `.claude/`, `.codex/`, and `.pi/`. Historical files inside individual run directories are part of the requested run artifacts and will be copied as-is into ignored local storage.
