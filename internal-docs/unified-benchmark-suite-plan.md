# Unified Benchmark Suite Plan

**Status:** Phase 5 complete; Phase 6 not started
**Primary command:** `bench`  
**Scope:** Repository consolidation, Inspect/visual/data-science execution, and local viewer orchestration

## 1. Outcome

Maintain one repository and one user-facing command for three benchmark families:

1. Inspect evaluations
2. Visual benchmarks
3. Data-science benchmarks

The normal run flow will be:

```text
Provider
  -> Model
  -> Suite
       -> Inspect evals
       -> Visual Bench
       -> Data Science
  -> Benchmark
  -> Review
  -> Execute
```

Execution branches only after benchmark selection:

```text
Inspect
  -> task configuration
  -> sample budget
  -> concurrency
  -> inspect eval
  -> .eval log

Visual / Data Science
  -> prepare versioned run slot
  -> launch interactive Pi in the run directory
  -> leave output ready for gallery capture/scoring
  -> unload the local model when Pi exits
```

The same `bench` command will also manage the two existing result viewers:

```text
bench view inspect
bench view visual
bench view both
bench view status
bench view stop [inspect|visual|both]
```

The TUI will expose the same viewer choices so users do not need to remember subcommands.

## 2. Repository consolidation decision

### Canonical repository

Use this project as the canonical repository and rename its directory from `local-llm-inspect-benchmarks` to `llm-benchmarks` before consolidation. Then move the visual application, benchmark definitions, run schema, capture pipeline, public exports, and deployment configuration into it.

Reasons:

- `llm-benchmarks` describes the new product scope without implying that models must be local or that benchmarks must use Inspect.
- The unified `bench` command and TUI remain the product entry point.
- This project has not been published to GitHub, so the local rename does not break a remote, package consumers, or deployment URL.
- The root layouts are compatible: both projects already use root-level `src/`, `benchmarks/`, and result directories with distinct file types.

The existing `local-llm-visual-benchmark` Git repository remains an untouched, read-only migration source until the unified repository is fully built and validated. Consolidation may copy from it, but must not commit, stash, clean, reformat, regenerate, or otherwise mutate its tracked files, untracked work, ignored run data, or generated outputs. Run visual baseline checks from an isolated working-tree copy rather than in the original repository. Its Git history will remain only in the archived source repository and will not be imported into `llm-benchmarks`.

### Safety gate

The visual repository currently has unrelated uncommitted changes in:

- `benchmarks/sakura.md`
- `package.json`
- `package-lock.json`
- `playwright.config.ts`
- `playwright.test.ts`

Because the original repository must remain untouched, those changes must be separately backed up before migration; do not commit or stash them in the source repository. The consolidation work must not overwrite them.

The current Inspect Bench changes, including the Kimi fixed-sampling adapter, stay in place through the directory rename. Do not reconstruct or selectively recopy them during the visual merge.

## 3. Unified repository layout

Keep the visual application at repository root. It already assumes root-relative `benchmarks/`, `runs/`, `public/`, and Astro configuration. Moving it into a nested workspace would add configuration without reducing maintenance.

Proposed layout:

```text
bin/
  bench.mjs                    unified CLI and TUI entry point

src/
  catalog.mjs                  Inspect recommendation data
  errors.mjs
  local-lifecycle.mjs
  preferences.mjs
  providers.mjs
  run-plan.mjs
  viewers.mjs                  detached viewer process manager
  ui/                          Bench terminal UI
  bench_inspect/               Inspect hook package

  lib/                         visual/data-science domain and run schema
  server/                      visual viewer local API
  pages/                       Astro routes
  components/                  Astro components
  styles/                      visual viewer styles

benchmarks/
  *.md                         visual and data-science benchmark definitions
  *.py                         local Inspect tasks

bench-data/                    Inspect compatibility sweep data
bench-configs/                 saved Inspect task configurations
logs/                          ignored Inspect .eval logs
runs/                          ignored visual/data-science run folders
public/export/                 tracked publish-safe visual gallery data

internal-docs/
test/                          Node tests for Bench CLI
 tests/                        Vitest and Playwright visual viewer tests

package.json
pyproject.toml
uv.lock
astro.config.mjs
tsconfig.json
vitest.config.ts
```

Keeping `test/` and `tests/` separate during migration avoids a broad test reorganization. They can be renamed later if there is a concrete benefit.

## 4. Source ownership after the merge

| Concern | Source of truth | Consumer |
|---|---|---|
| Providers, models, endpoints, and provider authentication | Pi SDK/runtime | Bench and interactive Pi |
| Inspect task catalog and task behavior | Installed Inspect registry | Bench |
| Inspect execution and `.eval` logs | Inspect | Inspect viewer |
| Visual/data-science prompts | `benchmarks/*.md` | Bench and visual viewer |
| Visual run paths, metadata, and assets | `src/lib/paths.ts`, `src/lib/prompt-prep.ts`, `src/lib/runs.ts` | Bench and visual viewer |
| Visual capture, comparison, and data-science scoring | Existing visual application modules | Visual viewer |
| Workflow and process lifecycle | `bench` | Both execution paths and both viewers |
| Public visual gallery export | `public/export/` | GitHub Pages |

Inspect logs and visual run metadata remain separate formats. The unified repository does not need a new result schema.

## 5. Shared visual benchmark integration

Repository consolidation removes the need for a cross-repository runner API.

Bench will directly use the existing visual modules:

- `loadBenchmarks()` for Markdown discovery
- `prepareRun()` for run-slot creation
- `buildRunPaths()` and `slugModelId()` for canonical paths
- `writeRunMetadata()` and existing asset contracts

Required cleanup before direct imports:

- Parse and validate the frontmatter `kind` field.
- Use explicit `.ts` extensions for runtime imports used by Node.
- Keep Node `>=22.19`, which supports type stripping for the repository's TypeScript modules.
- Remove `process.cwd()` assumptions where an explicit repository root or runs root is safer.
- Make data-science preparation validate required Supabase configuration before creating a runnable slot.

Bench must not maintain a second prompt list, hardcoded visual benchmark IDs, or a duplicate metadata serializer.

## 6. Suite selection and model compatibility

The current model screen blocks models that cannot be translated to Inspect before the benchmark family is known. That rule must move into the Inspect branch.

The model picker will distinguish:

```text
Pi + Inspect
Pi only
```

Behavior:

- Any model available through Pi may be selected for Visual or Data Science.
- Inspect compatibility is checked when the user selects Inspect evals.
- `resolveInspectModel()` runs only for Inspect.
- Pi-based runs use Pi's normal provider and authentication handling.
- Local server reachability remains a shared preflight.
- Inspect CLI passthrough arguments supplied after `--` are valid only for the Inspect suite. Selecting another suite with such arguments produces an explicit error.

The suite screen contains:

1. Inspect evals
2. Visual Bench
3. Data Science

Inspect retains its Recommended, All, and Local source tabs. Visual and Data Science are populated from Markdown frontmatter rather than hardcoded IDs.

## 7. Interactive Pi execution

Bench uses `@pi-tui` as a renderer, but that does not mean an active Pi agent session exists inside Bench. The initial implementation will hand the terminal to the normal Pi CLI rather than embed Pi's `InteractiveMode` SDK class.

Launch shape:

```bash
pi \
  --provider <provider> \
  --model <model-id> \
  --name "Bench: <benchmark>" \
  -- \
  @prompt.md
```

Launch properties:

- `cwd` is the prepared run directory.
- `@prompt.md` submits the canonical prompt without copying it into command construction.
- No API key appears in arguments, metadata, logs, or the run prompt.
- Pi keeps its normal tools, extensions, skills, project context, trust prompt, and session storage.
- Bench remains the parent process and waits for Pi to exit.
- A normal Pi exit leaves the run in the visual pipeline's expected prepared state for capture or scoring.
- Failure to start Pi marks the slot failed with a sanitized error.

Embedding `InteractiveMode` can be reconsidered only if the foreground process handoff has a demonstrated terminal problem.

## 8. Local model cleanup

Use the existing provider-specific lifecycle adapters instead of adding generic HTTP guesses.

Policies:

```text
Inspect runs:
  preserve the existing ownership-aware behavior
  unload only when Bench caused the model to load

Visual and Data Science runs:
  unload the selected local model whenever the Pi session ends

Cloud runs:
  no unload operation
```

The local lifecycle API should accept provider connection data directly instead of depending on an Inspect translation object. This allows Pi-only models to use the same cleanup adapters.

Automatic unload is supported only for providers with explicit adapters. Ollama and oMLX are the initial supported providers. Unsupported local providers must show a clear limitation before launch; Bench must not claim cleanup succeeded.

The foreground child coordinator must keep the parent alive while Pi handles interactive Ctrl-C. Cleanup must run after `/exit`, Ctrl-D, nonzero exits, and handled termination signals. `SIGKILL` cannot be recovered from.

## 9. Viewer architecture

Keep the two upstream viewers as separate loopback services:

- Inspect viewer for `.eval` logs
- Astro visual viewer for visual and data-science runs

Do not embed, proxy, or rewrite Inspect's viewer. Separate ports and a normal new-tab link are simpler and preserve Inspect as the source of truth.

### Default endpoints

```text
Inspect viewer: http://127.0.0.1:7575
Visual viewer:  http://127.0.0.1:4321
```

Ports remain configurable. Bench will not silently choose another port because the visual-to-Inspect link must remain deterministic. A collision produces a clear error and asks the user to change the configured port.

### Viewer commands

```text
bench view inspect   start or reuse Inspect, then open it
bench view visual    start or reuse Visual, then open it
bench view both      start or reuse both, then open Visual as the hub
bench view status    report URL, PID ownership, and health
bench view stop ...  stop only viewers started and recorded by Bench
```

The TUI viewer selector will call the same service functions. Run review/completion can offer:

```text
Open results after run:
  No
  Relevant viewer
  Both viewers
```

The default remains `No` so an evaluation does not unexpectedly open browser tabs.

### Background process ownership

Add `src/viewers.mjs` with one viewer descriptor per service. Each descriptor defines:

- ID and label
- Command and arguments
- Working directory
- Loopback URL
- Health/signature check
- Startup timeout
- Log path

Runtime state lives under an ignored directory:

```text
.bench-runtime/
  viewers.json
  inspect-viewer.log
  visual-viewer.log
```

Starting a viewer will:

1. Probe the expected endpoint.
2. Reuse it only if its response matches the expected application.
3. Refuse to touch an occupied port serving an unknown application.
4. Spawn the viewer in a detached process group with file-backed stdout/stderr.
5. Wait for a successful health check before opening a browser.
6. Record PID, process-group ID, URL, command identity, and start time.

Stopping a viewer will:

1. Read Bench-owned state.
2. Revalidate the process and endpoint identity.
3. Terminate the recorded process group.
4. Wait for shutdown, escalating only for the same validated process group.
5. Remove stale state.

This avoids killing unrelated processes or creating duplicate viewers.

### Inspect viewer process

Use an explicit command and absolute log directory:

```bash
uv run --project <repo-root> inspect view start \
  --host 127.0.0.1 \
  --port 7575 \
  --log-dir <repo-root>/logs
```

Run it with `.bench-runtime/` as its working directory so Inspect's dotenv initialization does not load the repository `.env` into a viewer that does not need provider credentials.

### Visual viewer process

Use the local Astro server because its write APIs support capture, deletion, folder opening, and data-science scoring:

```bash
npm run dev -- --host 127.0.0.1 --port 4321
```

The process is detached and logged by the same viewer manager. Static production builds remain read-only and continue using `public/export/`.

## 10. Link from the visual viewer to Inspect

Add an `Inspect results` action to the visual viewer header.

Local behavior:

- Link to the configured Inspect viewer URL.
- Use `target="_blank"` and `rel="noopener noreferrer"`.
- Keep the visual viewer as the page opened by `bench view both`.
- Optionally show a small unavailable state when the Inspect health check fails, but do not embed Inspect or proxy its API.

Static public behavior:

- Hide the local Inspect link unless an explicit public Inspect URL is configured at build time.
- Never emit a localhost link into the public GitHub Pages build.

The Inspect viewer does not need a reciprocal link because it is upstream software and should not be forked for navigation chrome.

## 11. Credentials and private data

- Pi remains the source of provider authentication.
- Provider API keys are never copied into `.env`, viewer state, run metadata, command arguments, or viewer logs.
- Keep the renamed project's `.env` ignored and never add it to Git.
- Do not overwrite it with the visual repository's `.env`; reconcile only required local Supabase settings into a fresh private configuration.
- Copy all historical visual/data-science run artifacts and comparison exports into the unified repository as local ignored data. Preserve the originals in the source repository until final validation.
- Provider credentials should remain in Pi rather than the unified repository's `.env`.
- `supabase.json` for the data-science benchmark must use restricted permissions and be removed after the Pi session.
- Inspect viewer binds to loopback and runs without `--unsafe-allow-unauthenticated`.
- Public visual export continues excluding raw HTML, prompts, responses, local paths, local URLs, commands, and logs.

## 12. Package and validation strategy

Use one root `package.json`, one lockfile, one Python project, and one GitHub workflow.

Root scripts should separate concerns while offering aggregate checks:

```text
npm run check:bench
npm run check:visual
npm run check
npm run test:bench
npm run test:visual
npm test
npm run test:e2e
npm run build:static
npm run publish
```

Merge dependencies through `npm install`; do not copy one lockfile over the other. Keep the Pi packages pinned until the unified suite passes.

`npm run check` and `npm test` must validate both the CLI and visual application. GitHub Pages CI should stop treating unit test failures as optional after the suites are stable.

## 13. Phased implementation checklist

### Phase 0: Protect current work and establish baselines

- [x] Confirm this project will become the canonical `llm-benchmarks` repository.
- [x] Rename the local project directory from `local-llm-inspect-benchmarks` to `llm-benchmarks` before the next Pi session.
- [x] Separately back up the visual repository's unrelated uncommitted files without committing, stashing, or otherwise changing the source repository.
- [x] Capture a file-level inventory of the current Inspect Bench changes.
- [x] Run and record the current Inspect checks: `npm run check`, `npm test`, and `uv lock --check`.
- [x] Run and record the visual checks from an isolated working-tree copy: `npm run check`, `npm test`, and `npm run build:static`.
- [x] Record all local-only data to migrate: Inspect logs, task configs, visual/data-science runs, public exports, and comparison exports.
- [x] Keep the original visual repository untouched throughout implementation and validation.
- [x] Do not copy either repository's root `node_modules`, root `.venv`, `.env`, build output, caches, or agent context directories. Historical files nested inside run directories remain part of the run artifacts and will be copied as-is.

Exit criteria:

- Both projects have known baseline results.
- All uncommitted user work is protected.
- The migration can be restarted without losing data.

### Phase 1: Create the unified repository tree

- [x] Initialize Git in `llm-benchmarks` and create a dedicated consolidation branch before copying visual files.
- [x] Retain visual Git history only in the archived source repository; do not import it.
- [x] Copy the visual application's `src/lib`, `src/server`, `src/pages`, `src/components`, `src/styles`, `public`, scripts, tests, and deployment files into the root-level layout.
- [x] Copy the visual and data-science Markdown benchmarks alongside the existing local Inspect Python benchmarks.
- [x] Copy all historical visual/data-science `runs/` artifacts and `comparison-exports/` into the unified repository as ignored local data; also preserve the tracked publish-safe `public/export/` content.
- [x] Merge `.gitignore` rules for `logs/`, `.bench-state.json`, `.bench-runtime/`, Python caches, and existing visual artifacts.
- [x] Explicitly track this plan in the initial checkpoint commit.
- [x] Merge root `package.json` dependencies and scripts without overwriting the protected visual package changes.
- [x] Regenerate `package-lock.json` with npm rather than manually combining lockfiles.
- [x] Add a unified `AGENTS.md` in which `bench`, Inspect, and viewer management replace the external offgrid/minimal-ai runner instructions.
- [x] Keep existing visual module and asset paths stable during this phase.

Exit criteria:

- One checkout installs with `npm ci` and `uv sync`.
- The pre-merge Inspect and visual test suites can both be invoked from the root.

### Phase 2: Share visual benchmark discovery and run preparation

- [x] Add validated `kind` parsing to visual benchmark frontmatter.
- [x] Make the visual TypeScript modules directly importable by Node using explicit runtime extensions.
- [x] Add a small Bench-facing adapter around `loadBenchmarks()` and `prepareRun()`; do not duplicate their implementations.
- [x] Discover Visual and Data Science categories from frontmatter.
- [x] Remove the external visual repository root and runner-API concept from Bench configuration.
- [x] Validate data-science access configuration before preparing a run.
- [x] Add tests proving exactly the current five visual benchmarks and one data-science benchmark are discovered without hardcoded IDs.
- [x] Add fixture-based tests for visual and data-science run metadata and assets.

Exit criteria:

- Bench and the visual viewer read the same benchmark definitions.
- Both paths create and consume the same run schema.

### Phase 3: Add the unified suite flow to the TUI

- [x] Add the Suite screen after Provider and Model.
- [x] Keep Inspect's Recommended, All, and Local task navigation intact.
- [x] Add Visual and Data Science benchmark browsers using the shared catalog.
- [x] Move Inspect compatibility enforcement and auth translation into the Inspect branch.
- [x] Label models as `Pi + Inspect` or `Pi only` without blocking Pi-capable visual runs.
- [x] Reject Inspect passthrough arguments explicitly when a non-Inspect suite is selected.
- [x] Add a dedicated Visual/Data Science review screen with expected assets, run root, Pi launch behavior, and cleanup policy.
- [x] Extend saved preferences by suite without overwriting the last Inspect task when a visual task is selected.
- [x] Preserve complete Back and Cancel navigation across both branches.

Exit criteria:

- Existing Inspect runs follow the same effective path as before.
- Visual and Data Science reach review without passing through Inspect configuration screens.

### Phase 4: Launch interactive Pi and clean up local models

- [x] Create the run slot only after final confirmation.
- [x] Stop the Bench alternate screen before launching Pi.
- [x] Launch Pi with the exact provider, model, run-directory `cwd`, session name, and `@prompt.md`.
- [x] Keep provider credentials under Pi's control.
- [x] Refactor local lifecycle adapters to consume provider connection data rather than Inspect translation output.
- [x] Add an explicit always-unload policy for Visual and Data Science.
- [x] Preserve ownership-aware cleanup for Inspect.
- [x] Keep the Bench parent alive during interactive Pi signal handling.
- [x] Run cleanup after normal exit, nonzero exit, and handled termination.
- [x] Remove the transient data-science access file in `finally`.
- [x] Mark launch failures without leaking credentials or local secret values.

Exit criteria:

- A visual prompt opens automatically in normal interactive Pi inside the new run directory.
- Ollama and oMLX models are unloaded after Pi exits.
- Inspect cleanup behavior does not regress.

### Phase 5: Add the background viewer manager

- [x] Add `src/viewers.mjs` with explicit Inspect and Visual descriptors.
- [x] Add loopback host and fixed-port configuration with documented defaults.
- [x] Add endpoint signature checks for both viewers.
- [x] Refuse occupied ports owned by unknown applications.
- [x] Spawn detached process groups with stdout/stderr redirected to `.bench-runtime/` logs.
- [x] Persist only non-secret viewer ownership metadata.
- [x] Wait for viewer health before reporting success or opening a browser.
- [x] Add `bench view inspect`, `visual`, `both`, `status`, and `stop` commands.
- [x] Add the equivalent TUI viewer selector.
- [x] Add the optional post-run `No`, `Relevant viewer`, or `Both viewers` choice.
- [x] Reuse healthy viewers instead of spawning duplicates.
- [x] Stop only validated Bench-owned process groups.

Exit criteria:

- `bench view both` returns after both viewers are healthy and leaves them running in the background.
- A later command reports and reuses the same processes.
- Unknown services and stale PID files are handled without killing unrelated processes.

### Phase 6: Cross-link the viewers

- [ ] Add an `Inspect results` header action to the local visual viewer.
- [ ] Open Inspect in a new tab with `noopener noreferrer`.
- [ ] Pass or derive the configured Inspect URL without hardcoding it into public output.
- [ ] Hide the link from static builds unless a public Inspect URL is explicitly configured.
- [ ] Add responsive and keyboard-accessible styles for the new action.
- [ ] Add a viewer test for link visibility, target, and static-build behavior.

Exit criteria:

- `bench view both` opens the visual viewer as the local hub.
- The visual viewer opens the running Inspect viewer in a new tab.
- The public gallery does not point visitors at localhost.

### Phase 7: End-to-end validation

- [ ] Run all Node syntax, TypeScript, Astro, Vitest, and Python compile checks.
- [ ] Run all Bench Node tests and visual unit tests.
- [ ] Add fake-child tests for Pi and both viewer processes.
- [ ] Test normal exit, nonzero exit, missing command, startup timeout, port collision, stale PID, and stop behavior.
- [ ] Mock Ollama and oMLX unload APIs for normal and interrupted Pi sessions.
- [ ] Verify no provider secret appears in metadata, viewer state, logs, or command previews.
- [ ] Run one local one-sample Inspect check.
- [ ] Run one inexpensive local visual benchmark through interactive Pi.
- [ ] Run the data-science preparation path without publishing credentials.
- [ ] Open both viewers, follow the cross-link, and verify each reads its native result format.
- [ ] Build the static gallery and inspect the export for local paths, URLs, prompts, raw responses, and secrets.
- [ ] Remove the temporary test run artifacts or keep them only in ignored directories.

Exit criteria:

- All automated tests pass.
- Both benchmark execution paths and both viewer paths have been exercised locally.
- No paid broad benchmark run is required for validation.

### Phase 8: Cut over to one maintained repository

- [ ] Retain the existing Inspect logs and task configs in the unified ignored directories.
- [ ] Verify that every historical visual/data-science run and comparison export was copied into the unified repository and remains unchanged in the original visual repository.
- [ ] Update README setup, run, viewer, publish, and troubleshooting instructions.
- [ ] Update internal context files after the implementation is complete.
- [ ] Install/link the unified `bench` executable from the canonical repository.
- [ ] Confirm `bench`, `bench view both`, `npm run publish`, and GitHub Pages deployment from a clean checkout.
- [ ] Create or rename the GitHub repository to `llm-benchmarks`, then update its remote, source links, package metadata, CNAME/base-path assumptions, and badges.
- [ ] Archive the old Inspect directory only after retained local data and the Kimi adapter are verified in the unified checkout.
- [ ] Remove documentation that instructs users to coordinate a second repository or external benchmark runner.

Exit criteria:

- One repository is authoritative.
- One installation provides `bench`.
- The old repository/directory is no longer required for running, viewing, capturing, scoring, or publishing benchmarks.

## 14. Acceptance criteria

- [ ] A user can run Inspect, Visual, or Data Science from one `bench` flow.
- [ ] The provider and model are selected once per run.
- [ ] Visual prompts and run metadata have one implementation shared with the viewer.
- [ ] Interactive Pi starts in the prepared run folder with the prompt submitted.
- [ ] Supported local models unload when the Pi session ends.
- [ ] Inspect continues writing native `.eval` logs and uses the native Inspect viewer.
- [ ] Visual and Data Science continue using their existing run folders and Astro viewer.
- [ ] `bench view both` starts or reuses both viewers in the background.
- [ ] The visual viewer links to Inspect in a new tab locally.
- [ ] Public builds contain no localhost Inspect link unless explicitly configured.
- [ ] Viewer process state contains no credentials and never authorizes killing unrelated processes.
- [ ] A fresh checkout can install, test, run, view, and publish without another repository.

## 15. Non-goals

- Combining Inspect `.eval` logs and visual runs into one new database or manifest
- Reimplementing or styling the Inspect viewer
- Proxying Inspect through Astro
- Embedding Inspect in an iframe
- Publishing private Inspect logs automatically
- Replacing Pi's provider/authentication system
- Restoring the external offgrid/minimal-ai benchmark preparation path
- Auto-selecting random free ports and hiding the resulting URLs
- Supporting automatic unload for local providers without explicit adapters
- Renaming and reorganizing every source directory during the functional merge

## 16. Main risks and controls

| Risk | Control |
|---|---|
| Overwriting uncommitted visual work | Phase 0 backup, no writes or Git mutations in the source repository, isolated baseline checks, and an isolated consolidation branch in `llm-benchmarks` |
| Losing the Kimi compatibility work | Copy current Inspect files as an inventory-verified unit and rerun mock translation tests |
| Schema drift between Bench and gallery | Directly call the existing visual preparation modules |
| Breaking existing Inspect users | Keep the Inspect branch intact and defer compatibility/auth checks rather than rewriting them |
| Orphaned viewer processes | Persist ownership state, health-check, provide status/stop commands, and use process groups |
| Killing an unrelated process | Validate state and endpoint identity; refuse unknown occupied ports |
| Exposing logs on the network | Bind both viewers to `127.0.0.1` only |
| Loading provider secrets into Inspect viewer | Run it from `.bench-runtime/` with an explicit uv project and absolute log path |
| Public localhost link | Render the Inspect link only for local server mode unless explicitly configured |
| Merge becoming a broad refactor | Preserve the visual root layout and current CLI module paths until behavior is validated |
