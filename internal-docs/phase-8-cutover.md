# Phase 8 repository cutover

**Branch:** `feat/unified-benchmark-suite`

**Status:** Local cutover complete; commit, push, and GitHub Pages activation await approval

## Retained local data

The unified checkout retains its ignored private data:

- 20 Inspect `.eval` logs under `logs/`
- 1 saved Inspect task configuration under `bench-configs/`
- 165 Visual/Data Science run metadata files under `runs/`
- 6 comparison-export files under `comparison-exports/`
- 117 published runs in the tracked `public/export/manifest.json`

A checksum-mode rsync comparison from the read-only visual source found no run-file differences. The only `runs/` differences were modification times on two directories. Every one of the source repository's 162 run metadata paths exists in the unified checkout; the unified checkout has three additional runs.

The six comparison-export files match byte-for-byte. The current public export differs in content at exactly two files, `manifest.json` and one Data Science `metadata.json`, because Phase 7 replaced credential-shaped historical prompt content with the canonical safe prompt. All other reported public-export differences are timestamps or directory metadata.

The visual source remains on `main` at `2057804`. Its original four modified files and one untracked file still have the exact SHA-256 hashes recorded before migration.

## Shipped repository identity

- Node package: `llm-benchmarks`
- Python package: `llm-benchmarks`
- Inspect entry point: `llm_benchmarks`
- Canonical GitHub repository: `https://github.com/eeshansrivastava89/llm-benchmarks`
- Public gallery: `https://localai.eeshans.com/`
- Canonical checkout remote: `origin` points to the new GitHub repository
- Global `bench`: linked to this checkout under the active Node installation

The old visual GitHub repository has not been renamed, archived, pushed to, or otherwise changed. It remains available as historical source until the user chooses to archive it.

## Documentation and UI cutover

The root README now documents all three suites, clean-checkout installation, Pi authentication, private Data Science configuration, viewer lifecycle, publishing, privacy, and troubleshooting.

The Visual viewer's onboarding and prepare-run dialog use `bench` and `bench view visual`. Active UI no longer directs users to the retired external runner. Historical redesign docs now state that their old labels and runner references are archival evidence rather than current instructions.

`AGENTS.md` describes the shipped single-repository architecture. The old visual checkout is a read-only archive and is not part of any supported workflow.

## Static publication safety

`npm run build:static` now reads the existing tracked export by default and uses `/` as its default Astro base. It no longer refreshes `public/export/` accidentally. `npm run publish` remains the explicit command that regenerates the public snapshot from local runs before checks, tests, build, and privacy audit.

The existing `public/CNAME` remains `localai.eeshans.com`, and the GitHub Pages workflow builds with `ASTRO_BASE=/`.

## Validation

Completed in the canonical checkout:

- `npm run check:bench`
- `npm run test:bench`: 68 passed
- `npm run check:visual`: zero errors, warnings, or hints
- `npm run test:visual`: 117 passed
- `npm run test:e2e`: 23 passed
- `uv lock --check`
- `git diff --check`
- `npm run build:static`: existing 117-run export, privacy audit passed, tracked manifest unchanged
- Real `bench view both` lifecycle on isolated ports: start, health, ownership, stop, and final stopped status passed
- Global `npm link`: resolves `bench` to this checkout

A temporary clean worktree, with no dependency environments or ignored run data copied from either working repository, passed:

- `npm ci`
- `uv sync --locked`
- aggregate checks and tests
- `bench view status`
- `npm run publish`
- static build and privacy audit

The clean-worktree publish generated an empty gallery because clean checkouts intentionally contain no ignored private runs. It proved that publication no longer depends on the old visual repository; it did not change this checkout's tracked export.

## Remaining cutover actions

1. Approve and create the Phase 8 commit.
2. Push the canonical history and establish `main` in the new GitHub repository.
3. Enable GitHub Pages with GitHub Actions and attach `localai.eeshans.com` to the new repository.
4. Verify the deployed workflow and live custom domain.
5. Update project-local context files after the final deployed state is known.
6. Leave the old visual repository in place until the user separately chooses to archive it.
