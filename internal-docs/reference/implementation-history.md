# Unified benchmark suite implementation history

**Recorded implementation:** 2026-09-12 through 2026-09-14

**Current status:** Phases 0–8 complete; Phase 9 is implemented and production-validated on macOS, with Linux/Bubblewrap validation still pending

This is the historical record of how the Inspect, Visual, and Data Science benchmark projects became one suite. It replaces the original Inspect plan, the consolidation plan, and the per-phase completion notes. The root `README.md` is the current operating guide; this file explains the architecture, decisions, methods, tradeoffs, and validation history.

## 1. Product and ownership model

The project exposes one `bench` workflow:

```text
Provider → Model → Suite → Benchmark → Review → Execute
                         ├─ Inspect evals
                         ├─ Visual Bench
                         └─ Data Science
```

The implementation deliberately does not force all three suites into one runner or result schema.

| Concern | Source of truth |
|---|---|
| Provider/model discovery, endpoints, transport metadata, and authentication | Pi |
| Inspect task discovery and execution | Inspect and installed task registries |
| Inspect results | Native `.eval` logs |
| Visual/Data Science prompts | `benchmarks/*.md` frontmatter and body |
| Interactive run preparation and metadata | `src/lib/paths.ts`, `src/lib/prompt-prep.ts`, and `src/lib/runs.ts` |
| Visual capture, comparison, and Data Science scoring | Visual application modules under `src/lib/` and `src/server/` |
| Workflow, foreground processes, local-model cleanup, and viewers | `bench` modules under `src/` |
| Publish-safe gallery | Tracked `public/export/` snapshot |

This boundary avoids a duplicate model catalog, copied credentials, a second prompt registry, and a replacement for Inspect’s log format. It also keeps the Visual application responsible for the run format it already understands.

### Repository shape

The consolidation kept the Visual application at the repository root because its paths already assumed root-level `benchmarks/`, `runs/`, `public/`, and Astro configuration. Nesting it in a workspace would have increased configuration without creating a useful isolation boundary.

```text
bin/bench.mjs              unified CLI and TUI entry point
src/*.mjs                  discovery, planning, execution, lifecycle, viewers
src/bench_inspect/         project-local Inspect compatibility hooks
src/lib/                   shared Visual/Data Science domain modules
src/server/                local viewer API
src/pages, components,
    styles/                Astro application
benchmarks/*.py            local Inspect tasks
benchmarks/*.md            Visual/Data Science definitions
bench-data/                versioned Inspect compatibility annotations
logs/                      ignored native Inspect logs
runs/                      ignored Visual/Data Science runs
comparison-exports/        ignored local comparison media
public/export/             tracked public gallery snapshot
```

`test/` remains the Node CLI suite and `tests/` remains the Vitest/Playwright suite. They were not renamed during consolidation because that would have been an unrelated refactor.

## 2. Inspect Bench before consolidation

The original project began as a safer interface over Inspect AI. Its fixed flow selected a Pi provider and model, an installed or local Inspect task, task configuration, a bounded sample count, local concurrency, and final confirmation. Inspect remained the evaluator and log writer.

### Live discovery instead of copied catalogs

- Pi’s runtime supplied available providers, models, endpoints, API types, and authentication.
- Inspect supplied installed task entry points and local task discovery.
- Inspect Evals descriptions and defaults came from the installed package metadata.
- Project configuration only declared local task roots, the log directory, and the task-config directory.
- Catalog refresh remained an explicit Pi operation rather than an automatic Bench side effect.

This design traded offline predictability for correctness against the user’s actual Pi and Inspect installations. A versioned compatibility sweep augmented the live task list but never replaced it.

### Model translation and compatibility

Routing used Pi’s model `api` value rather than provider-name guesses:

| Pi API | Inspect transport |
|---|---|
| `openai-completions` | `openai-api/<pi-provider>/<model>`, Responses disabled |
| `openai-responses` | `openai-api/<pi-provider>/<model>`, Responses enabled |
| `anthropic-messages` | `anthropic/<pi-provider>/<model>` |
| `google-generative-ai` | `google/<model>` with Pi identity retained in metadata |

Unknown APIs failed explicitly. OpenCode Go received a named header/session adapter, and Kimi received a fixed-sampling compatibility hook. These were explicit exceptions for provider behavior Pi could not express in model metadata, not fallback routing.

Credentials were resolved in memory and passed only through the Inspect child environment. They were not written to task configs, command arguments, or logs by Bench.

### Safe planning and terminal UX

The initial sequence of `fzf` subprocesses was replaced by a persistent Pi TUI with search, category navigation, responsive detail panes, keyboard and mouse handling, loading cancellation, contextual help, and `NO_COLOR` support. The UI was checked at 80, 120, and 160 columns.

Run planning added:

- official sample counts and task option counts;
- deterministic partial-run shuffle with seed `42`;
- explicit static or Inspect-adaptive local concurrency;
- lazy task-config generation from installed Python signatures;
- version and signature checks for saved configs;
- conservative confirmation defaults for costly or historically blocked tasks;
- redacted command previews and project-local recent-selection IDs only.

For Ollama and oMLX Inspect runs, Bench snapshots model residency and unloads only a model that the benchmark caused to load. It preserves models already resident before the run.

### Compatibility sweep

A complete one-sample smoke sweep of the installed Inspect Evals registry produced the compatibility data used by the Recommended and All views. Its retained report, CSV, and machine-readable data are described in `benchmark-sweep-deepseek-flash-2026-09-12.md` and `bench-data/inspect-evals-sweep-deepseek-flash-2026-09-12.json`.

The sweep was always decision support, not a quality leaderboard. A successful entry means one shuffled sample reached final Inspect log status `success`. Setup failures remain visible and selectable because missing Docker, dependencies, gated datasets, auxiliary models, or credentials do not make a benchmark intrinsically bad.

## 3. Consolidation chronology

### Phase 0: protect work and establish baselines

The existing Inspect project became the canonical target. The old Visual checkout was treated as a read-only migration source: no commits, stashes, cleaning, reformatting, generation, or other writes were allowed there.

The Visual checkout had four modified tracked files and one untracked file. Copies and hashes were stored in ignored `.bench-migration/` evidence before migration. Visual baseline commands ran from an isolated copy, not from the source checkout.

Baseline results:

| Project | Checks |
|---|---|
| Inspect | `npm run check`, 32/32 tests, and `uv lock --check` passed |
| Visual | checks passed, 109/109 tests passed, and static build completed with 6 benchmarks and 159 local runs |

A stale Inspect executable shebang still pointed to the pre-rename directory. Reinstalling only `inspect-ai` regenerated the local executable; no source change was needed.

The migration inventory distinguished durable data from disposable environments:

- 19 Inspect logs, one task config, and 523 sweep artifacts;
- 159 Visual/Data Science run directories, about 4.8 GB at the time;
- six comparison exports, about 45 MB;
- a 117-run tracked public export, about 448 MB.

Root dependencies, virtual environments, secrets, caches, generated builds, browser output, and agent context were excluded. Historical files nested inside run directories were preserved as part of those runs.

### Phase 1: create the unified tree

A dedicated consolidation branch was created before copying Visual source. Visual Git history was not imported; it remains in the archived source repository. Compatible source, benchmark definitions, scripts, tests, deployment files, local runs, comparison media, and the tracked export were copied into the root layout.

Conflicting root configuration was merged rather than overwritten:

- package dependencies and scripts were combined;
- `package-lock.json` was regenerated with npm;
- `.gitignore` and CI were unified;
- project instructions were rewritten around one repository and one command.

Checksum-mode `rsync` comparisons reported no differences for copied runs, comparison exports, or public assets. The source checkout’s branch, HEAD, working-tree state, and protected hashes remained unchanged.

A clean install then passed aggregate checks, 32 Bench tests, 109 Visual tests, and a static build from the existing 117-run export. npm audit findings were recorded but kept separate from the functional migration.

### Phase 2: share Visual/Data Science domain code

Markdown frontmatter gained validated `kind: visual` or `kind: data-science` metadata. Five Visual benchmarks and one Data Science benchmark were discovered from the shared catalog without hardcoded IDs.

`src/benchmark-suites.mjs` became the small Bench-facing adapter over the existing TypeScript modules. Node runtime imports gained explicit `.ts` extensions, and repository/run roots were derived from module location rather than caller working directory or an external repository setting.

Bench and the viewer now share:

- benchmark discovery;
- canonical run IDs and paths;
- prompt preparation;
- metadata serialization;
- expected asset contracts.

Data Science access is validated before slot creation. Only Data Science preparation creates `supabase.json`, with mode `0600`; shell variables take precedence over ignored project `.env` values. The viewer stopped recognizing Data Science through a hardcoded benchmark ID and uses kind metadata instead.

The direct-import design was chosen over a local runner API because both callers now live in one process tree and repository. An API would have duplicated validation and introduced another service boundary without independent deployment needs.

### Phase 3: add suite selection

A Suite screen was inserted after model selection. Inspect discovery, model translation, compatibility checks, and task configuration now occur only after selecting Inspect. This lets Pi-capable models run Visual/Data Science work even when they cannot be translated to Inspect, and it prevents a missing Inspect installation from blocking interactive suites.

Model rows distinguish `Pi + Inspect` from `Pi only`; an offline local endpoint still blocks every suite. Arguments after `--` are accepted only by Inspect and produce a recoverable error if an interactive suite is selected.

Visual/Data Science review shows expected assets, the run root, Pi handoff, and cleanup behavior. No run directory is created until final confirmation. Preferences moved to schema 2 so each suite remembers its own recent benchmark without overwriting Inspect choices.

### Phase 4: foreground Pi execution

After confirmation, Bench restores the terminal, creates one canonical run slot, and starts Pi in that directory with the chosen provider and model. `@prompt.md` is submitted as the initial message. Bench remains the parent, forwards `SIGINT`/`SIGTERM`, waits for Pi to close, updates run status, and performs cleanup in `finally`.

The external Pi CLI was chosen over embedding Pi’s `InteractiveMode`. It preserved the normal interactive terminal with less integration code. Embedding remained an option only if the foreground handoff showed a concrete terminal limitation.

A zero exit leaves the run `prepared` for Visual capture or Data Science scoring. Nonzero exit becomes `failed`; handled termination becomes `cancelled`; launch errors are sanitized. Data Science access is removed after normal exit, failure, cancellation, or launch failure.

Local cleanup policies differ intentionally:

- Inspect retains ownership-aware unload behavior.
- Visual and Data Science always attempt to unload the selected local model after Pi exits.
- Ollama and oMLX have explicit adapters.
- Unsupported local providers remain usable but show that automatic unload is unavailable.

This avoids pretending a generic HTTP request can safely manage every local runtime.

### Phase 5: manage native viewers

Bench gained `view inspect`, `view visual`, `view both`, `view status`, and `view stop`. The TUI invokes the same service functions. Post-run viewer opening defaults to No to avoid unexpected browser tabs.

The two native viewers remain separate loopback services:

```text
Inspect: http://127.0.0.1:7575
Visual:  http://127.0.0.1:4321
```

Fixed, configurable ports make cross-links deterministic. Bench refuses an unknown application on either port rather than silently selecting another.

Each viewer descriptor defines its command, working directory, URL, signature check, startup timeout, and private log. Bench reuses only a matching healthy endpoint. Bench-owned viewers run as detached process groups and are recorded in mode-`0600` `.bench-runtime/viewers.json`; stop operations revalidate process and endpoint identity before signaling the group. External matching viewers may be reused but are never claimed or stopped.

Inspect starts with an absolute project and log path while its working directory is `.bench-runtime/`, preventing unnecessary loading of the repository `.env`. Visual uses the local Astro server because capture, deletion, folder opening, and Data Science scoring require its write APIs. Static production remains read-only.

Separate viewers were preferred over embedding, proxying, or restyling Inspect. This keeps Inspect upstream-owned and avoids translating `.eval` logs into the Visual schema.

### Phase 6: cross-link viewers

The Visual header gained an accessible `Inspect results` link that opens a new tab with `noopener noreferrer`. `src/viewer-config.mjs` owns local origins and port validation so the manager and UI cannot drift.

Static builds omit the link unless `PUBLIC_INSPECT_VIEWER_URL` is set to a credential-free public HTTP(S) URL. Loopback URLs are rejected. This prevents a public gallery from directing visitors to localhost.

### Phase 7: end-to-end validation and privacy repair

Aggregate syntax, Python compilation, Astro, TypeScript, Node, Vitest, Playwright, lockfile, diff, static-build, and privacy checks passed. Process tests covered Pi and viewer success, nonzero exit, interruption, missing commands, startup timeout, occupied ports, stale ownership, endpoint reuse, and stop behavior. Mocked Ollama and authenticated oMLX services verified cleanup without contacting real providers.

Real validation included:

- a one-sample local Inspect run using `ollama/qwen3.5:4b-mlx`, scoring 1.0 and unloading afterward;
- an interactive Visual run using `deepseek-flash`, followed by HTML detection, capture, and viewer rendering;
- a Data Science run using `deepseek-flash`, producing all required assets and scoring 100/100;
- both native viewers under Bench ownership, including the Visual-to-Inspect link;
- loading all 435 historical preview/video assets without HTTP failure.

Copied historical metadata contained stale absolute `runDirectory` values. The scanner was changed to treat the discovered directory as authoritative, keeping reads, writes, deletes, and asset URLs inside the unified repository.

Static export was tightened in two ways. First, it replaces run-embedded prompts with the current canonical benchmark definition, preventing removed prompt content from being republished. Second, the privacy audit rejects private run artifacts, loopback/file URLs, home-directory paths, authorization headers, API-key fields, token-shaped values, and private runner fields without echoing matched secrets.

Validation found credential-shaped Supabase text in one historical public metadata file and its manifest entry. Both were replaced with the canonical credential-free prompt. Rotation was recommended if the historical value remained active because old Git history cannot be rewritten by a working-tree fix.

### Phase 8: repository cutover

The canonical package, Python project, repository, global executable, and deployment adopted the `llm-benchmarks` identity. The root README became the only operating guide. UI copy stopped referring to the retired external runner.

At cutover the unified checkout retained 20 Inspect logs, one task configuration, 165 Visual/Data Science metadata files, six comparison exports, and 117 published runs. Every source run metadata path existed in the unified checkout, with three additional unified runs. Comparison exports matched byte-for-byte. The only substantive public-export differences were the two privacy repairs from Phase 7.

`npm run build:static` was changed to build from the tracked export without refreshing it. `npm run publish` remains the only command that regenerates the public snapshot from ignored local runs before checks, tests, build, and audit. A clean worktree proved install, test, viewer status, publish, and build no longer depended on the old Visual checkout; its empty generated gallery was expected because ignored private runs are not present in a clean clone.

Cutover shipped in `813e188` (`chore: complete benchmark suite cutover`) with CI timeout follow-up `a078155`. GitHub Pages deployed successfully to the retained custom domain. The source Visual repository remained unchanged and is now historical only.

### Phase 9: OS-enforced interactive write confinement

The first confinement prototype used Anthropic Sandbox Runtime to limit reads, writes, network, process capabilities, ambient Pi resources, and each exposed tool. It blocked repository writes, sibling writes, symlink traversal, secrets, and unapproved network access, but it also removed Node, npm, npx, uv, ripgrep, user-installed tools, and normal temporary-file patterns. Playwright Chromium could not start on macOS even after broad reads, local binding, Unix-socket allowances, and unrestricted network were restored. A Snow Globe validation run produced only probe files, not `index.html`.

The product requirement was therefore narrowed from capability isolation to repository-integrity protection. The accepted boundary allows normal host reads, tools, IPC, authentication, and network while denying persistent writes outside the assigned run slot.

The current launcher wraps the complete Pi process tree:

- macOS uses a minimal Seatbelt profile: allow normal behavior, deny filesystem writes globally, then allow the run directory, required device files, and temporary storage;
- Linux uses Bubblewrap with a read-only host filesystem, a read-write run bind, ephemeral temporary storage, and the host network namespace;
- unsupported or unavailable confinement fails closed before Pi starts.

Pi’s built-in read, Bash, edit, and write tools were restored. A single OS policy now covers those tools and every descendant instead of maintaining parallel path checks. The host `PATH`, `HOME`, browser cache, runtimes, and provider configuration remain readable.

For reproducibility, interactive runs still disable ambient context, skills, templates, settings, discovered extensions, and session reuse. Bench creates writable private Pi scratch configuration containing only authentication and model catalogs; `settings.json` is excluded because it triggered extension/package installation. Every run gets a fresh session directory. Visual transcripts move to private `.bench-runtime/interactive-sessions/`; Data Science transcripts are discarded because tool output may contain temporary dataset credentials.

Behavioral tests on macOS prove:

- run and temporary writes succeed;
- repository, source, sibling-run, home, and symlink-target writes fail;
- Node, npm/npx, Python, uv, ripgrep, Pi model discovery, and Playwright Chromium remain usable;
- a real confined `qwen3.5:4b-mlx` Ollama request succeeds and unloads afterward.

Production macOS validation then exercised both interactive suites:

- A Qwen Snow Globe run proved that Node, npm/npx, the installed Playwright package, Chromium, file writes, and private diagnostic relocation work in a real model process. The user ended it early after the model rewrote its HTML with a JavaScript error. That failure exposed a capture-validation gap: browser-level `requestAnimationFrame` measurements could continue after the generated application crashed. Capture now listens for uncaught Playwright page errors, rejects the run, removes provisional media, and leaves the generated HTML unchanged.
- A subsequent DeepSeek Snow Globe run completed under Seatbelt, produced HTML plus PNG, WebM, and MP4 captures, reported 60 FPS at 1600×900, and retained its Visual transcript only under private `.bench-runtime/` storage.
- A DeepSeek Data Science run created a run-local virtual environment, fetched 942 Supabase rows, executed a 16-cell notebook without notebook errors, embedded all three charts, produced its summary, and scored 100/100. A home-directory Jupyter kernel install was denied as intended; the agent recovered by redirecting Jupyter and IPython state into the run slot. On exit, Bench removed `supabase.json` and discarded the Data Science session transcript.

Full checks, 76 Bench tests, 106 retained Visual tests, 23 Playwright tests, static build, privacy audit, diff check, and lock check passed after implementation and dead-code cleanup.

Remaining validation is the same confinement contract on a real Linux/Bubblewrap host.

The boundary is intentionally not confidentiality or network isolation. A benchmark process can read host-accessible files and communicate over the network; it cannot persist changes outside the run and temporary locations under the supported OS policy.

## 4. Durable architecture decisions and tradeoffs

| Decision | Reason | Accepted tradeoff |
|---|---|---|
| One canonical repository, without importing Visual Git history | Simplest supported workflow; history remains in the archived source | Historical commits are split across repositories |
| Pi owns model/auth discovery | Prevents copied catalogs and credentials | Availability depends on the live Pi installation |
| Inspect and Visual retain native result formats | Avoids a lossy replacement schema | Two viewers remain necessary |
| Directly import Visual run modules | Prevents duplicate prompts, paths, and metadata | Node must support direct TypeScript stripping |
| Select suite after model | Provider/model choice is shared while capability checks remain suite-specific | Model rows need `Pi + Inspect`/`Pi only` guidance |
| Foreground Pi CLI handoff | Preserves the native interactive terminal | Bench coordinates a child process rather than one embedded UI |
| Explicit local lifecycle adapters only | Avoids unsafe provider guesses | Some local providers cannot unload automatically |
| Fixed viewer ports with signature checks | Deterministic links and safe ownership | Port conflicts require user configuration |
| Visual viewer is the hub | Adds navigation without modifying Inspect | Cross-link is one-way |
| Explicit publish command | Protects the tracked gallery from accidental refresh | Publishing is a separate deliberate step |
| OS write confinement, not strict isolation | Keeps normal tools and Chromium working | Host reads and network remain available |
| Fresh private Pi sessions | Reproducibility and diagnostics without session reuse | Additional private runtime files require lifecycle handling |

## 5. Validation strategy

Validation was layered rather than relying only on mocked units:

1. Pure planning and metadata tests.
2. Child-process and signal tests with controllable fakes.
3. Mock provider lifecycle APIs.
4. Astro/TypeScript checks and Visual unit tests.
5. Playwright browser tests against isolated viewer ports.
6. Real viewer process start, signature, reuse, link, and stop checks.
7. Real low-cost Inspect, Visual, and Data Science executions.
8. Static export generation and content privacy audit.
9. Clean-checkout install/build/publish validation.
10. Platform write-confinement behavior and tool-capability probes.

Generated builds and temporary runs used for verification were removed afterward. Ignored historical runs, logs, comparison exports, sweep artifacts, credentials, and migration evidence were preserved.

## 6. Non-goals retained throughout

- Replacing Pi’s provider or authentication system.
- Combining `.eval` logs and Visual runs into a new database.
- Forking, proxying, embedding, or restyling the Inspect viewer.
- Restoring the old offgrid/minimal-ai runner.
- Publishing private Inspect logs or raw interactive artifacts.
- Guessing unload APIs for unsupported local providers.
- Full host confidentiality or network isolation for interactive Pi.
- Broad source-directory reorganization during the functional merge.
