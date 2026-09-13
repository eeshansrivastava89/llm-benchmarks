# Plan: `bench` interface for Inspect AI

**Status:** Phase 7 complete

## 1. Product pitch

`bench` is a small interactive command for running Inspect AI evaluations without memorizing provider names, model IDs, task names, endpoints, or credentials.

The user flow is fixed:

1. Choose a provider from the providers available in Pi.
2. Choose one of that provider's models.
3. Choose an installed or local benchmark source.
4. Choose an Inspect benchmark.
5. Choose official defaults or a saved/generated Inspect task config.
6. Choose a bounded sample count.
7. Confirm the run, then let Inspect write the result to its normal log format.

A run should require only:

```bash
bench
```

Additional Inspect options pass through unchanged:

```bash
bench -- --limit 20 --epochs 3
```

### Requirements

- Pi owns provider, model, endpoint, transport, and credential data.
- Inspect owns benchmark discovery, evaluation execution, and logs.
- `bench` reads both systems live and stores no copied catalog or credentials.
- Provider, model, and benchmark lists are searchable.
- Loopback providers are visually distinct from cloud providers and report server reachability.
- Installed Inspect Evals tasks show official sample counts and one-sentence hints from package metadata.
- Sweep-backed recommendations remain separate from the full live catalog, and historical blockers are disclosed before launch.
- Partial runs use a reproducible sample shuffle rather than a dataset prefix.
- Local runs require an explicit static or adaptive model-concurrency choice.
- Models loaded by a benchmark are unloaded afterward when the local provider has an explicit lifecycle adapter; pre-existing loaded models are preserved.
- Editable task configs are generated lazily from installed task signatures and passed through Inspect's official `--task-config` interface.
- Every run requires an explicit final confirmation.
- The resolved command is printed before execution, with secrets omitted.
- Missing tools, authentication failures, unsupported transports, empty catalogs, and cancelled selections stop the run with a clear message.
- There are no guessed defaults or silent fallbacks.

### Non-goals

- Editing Pi configuration or credentials
- Maintaining a second provider or model catalog
- Replacing Inspect's evaluator, log format, or log viewer
- Building a benchmark results dashboard
- Solving dataset revision pinning in the first release
- Supporting multi-model campaigns in the first release

## 2. Architecture

### Source ownership

| Data | Source of truth | Access method |
|---|---|---|
| Providers and models | Pi | Pi SDK `ModelRuntime` through `createAgentSessionServices()` |
| Endpoints, transports, and credentials | Pi | Selected Pi model and live auth resolution |
| Packaged benchmarks | Inspect registry | Installed Inspect task entry points |
| Custom benchmarks | Inspect | `inspect list tasks ... --json` over configured local roots |
| Evaluation results | Inspect | `inspect eval` logs |
| Custom task roots, log directory, and task-config directory | This project | Explicit `[tool.bench]` settings in `pyproject.toml` |
| Saved benchmark options | Inspect task-config YAML | Lazily generated project files under `[tool.bench].task-config-dir` |

`bench` does not read Pi's `models.json`, `models-store.json`, plugin caches, or `auth.json` directly. The Pi SDK already merges those sources and applies Pi's authentication rules. It also includes models registered by Pi extensions.

The model picker uses `ModelRuntime.getAvailable()` so it matches the models Pi considers ready to use. `bench` does not refresh remote catalogs automatically; catalog updates remain an explicit Pi operation:

```bash
pi update --models
```

### Runtime flow

```text
Pi SDK
  -> available providers
  -> selected provider
  -> selected model
  -> resolved transport, endpoint, and auth

Inspect
  -> installed benchmark packages + configured custom tasks
  -> selected source
  -> selected benchmark
  -> task config + bounded sample selection
  -> local concurrency selection when applicable
  -> explicit run confirmation
  -> inspect eval
  -> Inspect log
```

The command uses `@earendil-works/pi-tui` as a direct dependency. Its alternate-screen renderer, layout stacks, text/input components, searchable selection lists, keyboard parser, and differential synchronized rendering provide the terminal primitives; Bench owns only domain-specific screen composition and workflow state. Inspect Evals descriptions come from the installed package's `eval.yaml` metadata. Providers with loopback endpoints are labeled as local, and their deduplicated host/port pairs receive a short parallel TCP reachability check; cloud endpoints are never probed.

### Minimal project structure

```text
bin/bench.mjs          workflow, adapters, and Inspect execution
src/catalog.mjs        recommendation and compatibility data model
src/errors.mjs         shared CLI errors
src/local-lifecycle.mjs ownership-aware local model cleanup
src/preferences.mjs    project-local recent selection state
src/providers.mjs      Pi model discovery and backend classification
src/run-plan.mjs       sample, concurrency, command, and metadata planning
src/ui/                 terminal screens and benchmark presentation
bench-data/             versioned compatibility annotations
package.json            `bench` command, Pi SDK, and Pi TUI dependencies
pyproject.toml          Inspect dependencies and `[tool.bench]` settings
benchmarks/             optional local Inspect tasks
```

No generated catalog, generated `.env`, sync command, doctor command, or copied provider data is required. Per-task YAML configs are created only when the user requests one.

### Model translation

Routing is based on each model's Pi `api` value, not its provider name.

| Pi model API | Inspect transport |
|---|---|
| `openai-completions` | `openai-api/<pi-provider>/<model>`, Responses API disabled |
| `openai-responses` | `openai-api/<pi-provider>/<model>`, Responses API enabled |
| `anthropic-messages` | `anthropic/<pi-provider>/<model>` |
| `google-generative-ai` | `google/<model>`; Pi provider identity remains in metadata |

The mapping is exhaustive. An unknown API produces an unsupported-transport error. Provider and model IDs are never maintained in code. Google's Inspect provider reserves the first model path segment for its `vertex` service, so custom Pi provider identity cannot be inserted into that model string; metadata preserves it instead.

Pi supplies the selected model's base URL and credentials. Credentials are passed only in the child process environment and never written to disk, printed, or included in command arguments.

Some providers require behavior that Pi does not expose as model metadata. Those cases need a small, named compatibility adapter. Adapters are explicit and must never act as fallbacks. OpenCode Go is the first known case because it requires client and per-run session headers.

### Benchmark discovery and execution

Packaged benchmarks come from task entry points registered with Inspect. The pinned `inspect-evals` dependency currently contributes the main catalog, and other installed packages can contribute additional sources without code changes.

Custom task roots are declared as `custom-task-roots` in `pyproject.toml`; `bench` does not search arbitrary project directories. It passes those roots to `uv run inspect list tasks ... --json` and groups the results under **Local tests**.

The source picker exposes **Recommended Inspect Evals**, **All Inspect Evals**, and **Local tests**. Recommendations and warnings are joined onto the live registry from a versioned compatibility-sweep artifact; they do not replace Inspect discovery. Recommended tasks are grouped by their current official category. A blocked or inconclusive task shows its historical diagnostic and requires an explicit continue decision before configuration. The selected registry name or local `file.py@task` spec is passed to `uv run inspect eval`. User arguments after `--` are appended without reinterpretation.

Each run adds the original Pi identity to Inspect metadata:

- `pi_provider`
- `pi_model`
- `pi_api`

Inspect remains responsible for task configuration, retries, scoring, display, log serialization, and exit status. `bench` writes no separate run records.

## 3. Phased implementation plan

### Phase 1: Live discovery

- [x] Add `package.json` with a `bench` executable and a direct Pi SDK dependency.
- [x] Add explicit task roots and log directory under `[tool.bench]` in `pyproject.toml`.
- [x] Pin `inspect-evals` and discover its installed task registry without a benchmark allowlist.
- [x] Load Pi through `createAgentSessionServices()`.
- [x] Read available models through `ModelRuntime.getAvailable()`.
- [x] Group models by provider without a provider or model allowlist.
- [x] Discover benchmarks through `uv run inspect list tasks ... --json`.
- [x] Fail clearly when Pi, Inspect, configured task roots, or available models are missing.

### Phase 2: Interactive execution

- [x] Add the initial provider picker using `fzf` (replaced by the Phase 6 TUI).
- [x] Distinguish loopback backends from cloud providers and report local server reachability.
- [x] Add the model picker with model ID, transport, context size, reasoning support, and input modalities.
- [x] Add separate benchmark-source and benchmark pickers for installed packages and local tests.
- [x] Show official one-sentence Inspect Evals descriptions in the benchmark picker.
- [x] Resolve the selected model's endpoint and credentials through Pi.
- [x] Implement the exhaustive Pi API to Inspect transport mapping.
- [x] Print the resolved command with credentials omitted.
- [x] Pass credentials only through the child environment.
- [x] Forward arguments supplied after `--` to `inspect eval` unchanged.
- [x] Add Pi provider, model, and API values to Inspect metadata.
- [x] Run Inspect with inherited terminal I/O and return its exit status.

### Phase 3: Compatibility and verification

- [x] Add an explicit OpenCode Go adapter with a fresh session ID per run.
- [x] Add a Kimi compatibility hook that removes sampling parameters fixed by the provider API.
- [x] Reject OAuth subscription models unless their Inspect transport has been verified.
- [x] Reject unsupported Pi APIs and untranslatable auth or header requirements.
- [x] Add unit tests for transport translation and command construction.
- [x] Add command-level tests for cancellation, missing dependencies, empty results, and Inspect failures.
- [x] Verify one local OpenAI-compatible model (`omlx/Qwen3.5-4B-OptiQ-4bit`, one sample, accuracy 1.0).
- [x] Verify one cloud OpenAI-compatible model (`deepseek/deepseek-flash`, one sample completed successfully through the API).
- [x] Verify one Anthropic Messages model (`opencode-go/minimax-m3`, one sample, accuracy 1.0).
- [x] Verify the OpenCode Go adapter through Inspect against a local HTTP server, including the generated wire headers.
- [x] Verify one live OpenCode Go request with a fresh session header.
- [x] Confirm that successful runs create Inspect logs containing the selected task and Pi metadata.
- [x] Remove obsolete generated-sync documentation and provider tables.
- [x] Document setup, normal use, pass-through options, catalog refresh, and failure behavior in `README.md`.

### Phase 4: Safe run planning and task configs

- [x] Show official default sample counts and task option counts in benchmark rows.
- [x] Ask for a sample budget before every run unless `--limit` or `--sample-id` was explicitly forwarded.
- [x] Deterministically shuffle bounded samples with seed 42 unless the user supplied `--sample-shuffle`.
- [x] Ask local-model users for a static 1/2/4/8, custom, or Inspect-adaptive connection limit.
- [x] Preserve explicit `--max-connections` and `--adaptive-connections` arguments without adding another limit.
- [x] Show local concurrency in final confirmation.
- [x] Snapshot Ollama and oMLX model residency before launch and show the cleanup decision in final confirmation.
- [x] Unload only models loaded by the benchmark, using each provider's native API in a `finally` cleanup path.
- [x] Keep cleanup best-effort so an unload failure cannot replace Inspect's exit status.
- [x] Add a final run confirmation.
- [x] Generate task-config YAML lazily from the installed Python task signature.
- [x] Print the generated path and wait for external editing instead of taking over the terminal with an editor.
- [x] Include every parameter, official defaults, source version, signature hash, and official documentation links.
- [x] Detect existing per-task configs and ask whether to use, ignore, edit, or regenerate them.
- [x] Back up regenerated configs and warn when their package version differs from the installed package.
- [x] Validate YAML mappings and unknown parameter names before launch.

### Phase 5: Sweep-backed benchmark navigation

- [x] Add **Recommended Inspect Evals** with all 100 successful sweep tasks grouped by official category.
- [x] Keep the complete live catalog under **All Inspect Evals**.
- [x] Mark blocked and inconclusive sweep results with a warning icon.
- [x] Show the historical blocker category and diagnostic after selection.
- [x] Let the user return to the benchmark list or continue anyway.
- [x] Preserve **Local tests** without sweep annotations.
- [x] Keep compatibility data versioned and separate from live task discovery.

### Phase 6: Full terminal UX

- [x] Replace sequential `fzf` subprocesses with a persistent Pi TUI application.
- [x] Add focused provider and model browsers with separate detail panes.
- [x] Add true category navigation with counts instead of repeated category metadata.
- [x] Keep benchmark rows to name, status, and abbreviated sample count.
- [x] Move descriptions, options, and compatibility diagnostics into a responsive detail pane.
- [x] Add source tabs, search, pane switching, and backward navigation.
- [x] Add TUI-native numeric input, warnings, task-config choices, and run review.
- [x] Restore the terminal before handing inherited I/O to Inspect.
- [x] Complete visual verification at 80-, 120-, and 160-column terminal sizes.

### Phase 7: Decision support and recovery

- [x] Add searchable provider and model browsers.
- [x] Replace technical provider/model metadata walls with plain-language decision support.
- [x] Mark known Inspect-incompatible and offline model choices before authentication.
- [x] Add Retry and Choose another paths for setup, local server, and authentication failures.
- [x] Make long detail and diagnostic content scrollable.
- [x] Add cancellable loading, mouse selection, clickable links, contextual help, and `NO_COLOR` support.
- [x] Make benchmark search global within the active source and hide meaningless category panes.
- [x] Replace raw sample and concurrency settings with intent-based safe defaults.
- [x] Keep invalid saved task configs inside a repairable configuration workflow.
- [x] Add a receipt-style Review screen with conservative defaults for risky runs.
- [x] Add command preview, concise launch/completion messages, and cleanup results.
- [x] Remember only recent selection IDs in a project-local ignored state file.
- [x] Repeat visual verification at 80, 120, and 160 columns, including search, narrow navigation, scrolling, unavailable models, invalid configs, local concurrency, risky-run review, loading cancellation, and no-color output.
