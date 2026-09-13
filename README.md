# local-llm-inspect-benchmarks

`bench` is a picker for running [Inspect AI](https://inspect.aisi.org.uk/) benchmarks against models configured in Pi. It offers sweep-backed **Recommended Inspect Evals**, the complete installed catalog under **All Inspect Evals**, and your own tasks under **Local tests**.

## Requirements

- Python 3.12
- [uv](https://docs.astral.sh/uv/)
- Node.js 22.19 or newer
- A provider configured in Pi

## Setup

```bash
uv sync
npm install --ignore-scripts
npm link
```

Configure credentials with Pi:

```bash
pi
/login
```

Custom and local providers belong in Pi's model configuration. See `docs/models.md` in the installed Pi package; `bench` does not read or maintain its own `.env` file.

## Configuration

`pyproject.toml` defines custom task roots, the Inspect log directory, and where saved benchmark options are stored:

```toml
[tool.bench]
custom-task-roots = ["benchmarks"]
log-dir = "logs"
task-config-dir = "bench-configs"
```

Inspect Evals tasks come from the installed `inspect-evals` package. Paths in `custom-task-roots` are relative to the project directory and appear under **Local tests**. Add your own `@task` files anywhere beneath `benchmarks/`; use an empty array if you do not want a local source.

## Usage

```bash
bench
```

`bench` opens a full-screen terminal interface with a Provider → Model → Benchmark → Configure → Samples → Concurrency → Review flow. Steps that do not apply are skipped. `Esc` returns to the previous decision, `Ctrl-C` cancels, `?` shows contextual help, and the footer lists the controls available on each screen.

Press `/` to search provider and model catalogs. Provider details explain whether requests run locally or through a remote API. The model browser describes supported inputs, reasoning, maximum input size, and where the model runs; raw IDs and API formats are kept under **Advanced**. Models that Bench already knows Inspect cannot use are marked before selection.

The provider browser checks loopback server reachability. An offline provider offers Retry or Choose another instead of failing later. Local status is a reachability check and does not guarantee that a particular model is loaded.

The benchmark browser offers three source tabs:

- **Recommended Inspect Evals** contains all 100 tasks that passed the project's one-sample DeepSeek Flash compatibility sweep, grouped into selectable official Inspect categories.
- **All Inspect Evals** contains the complete live catalog. Tasks that were blocked or inconclusive in that sweep carry a `⚠` marker.
- **Local tests** contains tasks discovered from the configured project roots and is not affected by sweep data.

Use `1`–`3` to switch source tabs, `Tab` to move between category and benchmark panes, `/` to search every category in the current source, and `Page Up`/`Page Down` to scroll details. Narrow terminals show one navigation pane at a time. Benchmark rows stay compact: name, compatibility marker, and abbreviated sample count. The highlighted task's official title, category, sample count, options, description, and sweep evidence appear in the detail pane.

Selecting a warned task shows the recorded blocker category and diagnostic, then offers **Choose another benchmark** or **Continue anyway**. These warnings are historical compatibility evidence from DeepSeek Flash, Inspect Evals 0.17.0, and the recorded sweep environment. They do not predict whether a different model or environment will fail. Newly installed tasks absent from the saved sweep are labeled as not swept.

After choosing a benchmark, select its task options and run size. Run-size choices are labeled by intent: **Quick check**, **Small**, **Standard**, **Large**, and **Full dataset**. Quick check is the safe default. Partial runs receive a deterministic `--sample-shuffle 42` before `--limit`, so repeated runs use the same random subset rather than a dataset prefix. A one-sample task skips the redundant run-size screen.

Local models also receive plain-language concurrency choices: **Safe**, **Balanced**, **Faster**, **Aggressive**, custom, and **Let Inspect decide**. Safe sends one request at a time and remains the recommended default. Cloud models continue to use Inspect's concurrency behavior.

For the built-in `ollama` and `omlx` local providers, `bench` checks whether the selected model was already resident immediately before launch. If the benchmark loads it, `bench` unloads it after Inspect exits, including failed runs; a model that was already loaded is left alone. Cleanup uses each server's native local API, is shown in final confirmation, and never changes the benchmark exit status if unloading fails. Other local providers remain loaded until they receive an explicit adapter.

Every run has a receipt-style confirmation screen showing model location, benchmark, run size, task options, historical compatibility, output directory, local concurrency, cleanup behavior, and command-line overrides. Large, unlimited, or historically warned runs select **Go back** by default. The redacted Inspect command is available from Review for advanced troubleshooting.

### Saved task configurations

For a configurable installed task, choose **Customize advanced options** to create a project-local YAML file under `task-config-dir`, for example:

```text
bench-configs/inspect_evals/bbq.yaml
```

The template is generated lazily from the selected task's live Python signature. It records all parameter names, types, and official defaults, links to the official benchmark and Inspect parameter documentation, and is passed directly to Inspect with `--task-config`. YAML-safe defaults are active; runtime Python objects that cannot be represented safely are documented but omitted.

`bench` does not take over your editor. It shows the absolute file path and waits while you edit it in another terminal or GUI editor. Choose **Use the edited file** to validate it, or **Return without using this file**. Invalid YAML and unknown parameters stay inside the configuration workflow with repair, regenerate, defaults, and Back available.

On later runs, Bench validates the saved file before offering it. It marks invalid files and package-version mismatches instead of failing after selection. Regeneration backs up the existing file. Files are never generated or applied silently. Documentation links are clickable in supported terminals.

After confirmation, Bench prints a short launch summary and gives inherited terminal I/O to Inspect. Set `BENCH_VERBOSE=1` to print the complete redacted command at launch as well.

Pass Inspect options after `--`:

```bash
bench -- --limit 20 --epochs 3
bench -- --max-connections 2
```

Arguments after `--` are appended unchanged. An explicit `--limit`, `--sample-id`, `--task-config`, `--max-connections`, or `--adaptive-connections` takes precedence over the corresponding interactive step and is shown under **Command-line overrides** in Review. Inspect owns evaluation output and writes logs under `[tool.bench].log-dir` unless a forwarded option overrides it.

Bench remembers only the last selected provider, model, source, and task in the project-local `.bench-state.json`; it never copies catalogs or credentials. Set the standard `NO_COLOR` environment variable for text-only styling.

Each log records:

- `pi_provider`
- `pi_model`
- `pi_api`

## Transport mapping

| Pi API | Inspect model |
|---|---|
| `openai-completions` | `openai-api/<provider>/<model>` with Responses disabled |
| `openai-responses` | `openai-api/<provider>/<model>` with Responses enabled |
| `anthropic-messages` | `anthropic/<provider>/<model>` |
| `google-generative-ai` | `google/<model>` |

OpenCode Go uses an explicit adapter that adds `x-opencode-client: inspect-ai` and a new `x-opencode-session` UUID to every run.

Kimi's coding API fixes its sampling values server-side and rejects benchmark settings such as `temperature=0`. For Pi's `kimi` provider, Bench enables a project-local Inspect hook that removes temperature, top-p, frequency-penalty, and presence-penalty settings before each request so Kimi can apply its required values. The Review screen discloses this compatibility behavior before launch.

Bench marks known incompatible models before selection and offers in-place recovery for offline local servers, setup failures, and authentication translation failures. It still refuses to guess when it encounters:

- an unknown Pi API
- subscription-backed OAuth
- provider IDs Inspect cannot represent
- custom credential headers or provider environment values without an adapter
- missing tools, task roots, models, credentials, or tasks after the user declines Retry
- a cancelled workflow

Refresh Pi's cached model catalogs explicitly when needed:

```bash
pi update --models
```

## Tests

```bash
npm run check
npm test
```

The test suite covers transport translation, model compatibility preflight, command construction, recent-selection persistence, official sample metadata, compact benchmark presentation, category grouping, sweep warnings, intent-based sample and local-concurrency presets, generated task configs and validation, ownership-aware Ollama and oMLX unloading, local/cloud endpoint classification, deduplicated server reachability checks, OpenCode Go session headers, Kimi fixed-sampling translation, missing commands, empty task listings, Inspect failures, and child exit-code propagation.

## Files

```text
bin/bench.mjs           CLI workflow, adapters, and run planning
src/catalog.mjs         recommendation and compatibility data model
src/errors.mjs          shared CLI errors
src/local-lifecycle.mjs ownership-aware local model cleanup
src/preferences.mjs     project-local recent selection state
src/providers.mjs       Pi model discovery and backend classification
src/run-plan.mjs        sample, concurrency, command, and metadata planning
src/ui/                 terminal interface and benchmark presentation
src/bench_inspect/      project-local Inspect compatibility hooks
bench-data/             versioned compatibility-sweep annotations
benchmarks/             your local Inspect tasks
bench-configs/          saved task configs, created lazily
pyproject.toml          Python dependencies and bench settings
package.json            bench executable and direct Pi dependencies
test/                   Node test suite
logs/                   Inspect logs (gitignored)
```
