# llm-benchmarks

[Live gallery](https://localai.eeshans.com/) · [Source](https://github.com/eeshansrivastava89/llm-benchmarks)

`bench` runs three benchmark families from one terminal workflow:

- **Inspect evals** use Inspect tasks and produce native `.eval` logs.
- **Visual Bench** asks Pi to build browser artifacts, then captures them in the local workbench.
- **Data Science** asks Pi to analyze the project dataset and produce a notebook, charts, and scored summaries.

Pi supplies providers, models, and authentication. Inspect owns Inspect task execution and logs. The visual application owns Markdown prompts, visual and Data Science run folders, capture, scoring, comparisons, and the publish-safe gallery export.

## Requirements

- Node.js 22.19 or newer
- Python 3.12
- [uv](https://docs.astral.sh/uv/)
- [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent), installed and authenticated
- Chromium for visual capture and Playwright tests
- Optional local model servers configured through Pi

## Install from a clean checkout

```bash
npm ci
uv sync --locked
npx playwright install chromium
npm link
```

`npm link` installs `bench` for the active Node installation. If you switch Node versions, run it again from this repository.

Authenticate providers through Pi:

```bash
pi
/login
```

Custom and local providers belong in Pi's model configuration. `bench` does not copy provider credentials into project configuration, run metadata, commands, or viewer state.

Verify the installation:

```bash
command -v bench
bench view status
```

## Data Science private configuration

Data Science runs need read access to the benchmark dataset. Set these values in the shell or in an ignored project-local `.env`:

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

A template is available at `.env.example`. Do not commit the populated `.env`.

When a Data Science run starts, Bench writes the access values to `supabase.json` inside that run directory with mode `0600`. It removes the file when Pi exits or if launch fails. The values are not written to `prompt.md`, `metadata.json`, or the public gallery.

## Run a benchmark

```bash
bench
```

The picker follows this path:

```text
Provider → Model → Suite → Benchmark → Review → Execute
```

Choose one suite:

| Suite | Execution | Local result |
|---|---|---|
| Inspect evals | Bench launches `inspect eval` | `logs/*.eval` |
| Visual Bench | Bench creates a run slot and launches interactive Pi there | `runs/<benchmark>/<model>/<run>/` |
| Data Science | Same Pi handoff, with temporary dataset access | `runs/<benchmark>/<model>/<run>/` |

Visual and Data Science run slots are created only after confirmation. Pi opens in the slot with `@prompt.md` submitted. When Pi exits, Bench removes temporary Data Science access and unloads supported local models. Ollama and oMLX have unload adapters; other local providers show a warning and may remain loaded.

Bench can start the relevant results viewer after a successful run. The default is **No**, so runs do not open browser tabs unexpectedly.

### Inspect options

Pass Inspect CLI arguments after `--`:

```bash
bench -- --limit 20 --epochs 3
bench -- --max-connections 2
```

Arguments after `--` are accepted only when the Inspect suite is selected. Explicit `--limit`, `--sample-id`, `--task-config`, `--max-connections`, and `--adaptive-connections` values override the corresponding interactive step and appear in Review.

Inspect provides three task sources:

- **Recommended Inspect Evals**: tasks that passed the saved one-sample compatibility sweep
- **All Inspect Evals**: the installed Inspect Evals catalog, including saved blocker warnings
- **Local tests**: project tasks found under `[tool.bench].custom-task-roots`

Saved task configurations are created lazily under `bench-configs/`. Partial sample choices use deterministic shuffle seed `42`. For Ollama and oMLX Inspect runs, Bench unloads a model only when Bench caused it to load.

Set `BENCH_VERBOSE=1` to print the complete redacted launch command.

## View results

```bash
bench view inspect
bench view visual
bench view both
bench view status
bench view stop inspect
bench view stop visual
bench view stop both
```

`bench view both` starts or reuses both loopback services, then opens the Visual viewer as the hub. Its header opens Inspect results in a new tab.

Default endpoints:

```text
Inspect: http://127.0.0.1:7575
Visual:  http://127.0.0.1:4321
```

Override fixed ports when needed:

```bash
BENCH_INSPECT_VIEWER_PORT=17575 \
BENCH_VISUAL_VIEWER_PORT=14321 \
bench view both
```

Viewer ownership and private logs live under ignored `.bench-runtime/`. Bench reuses a healthy matching service, refuses an unknown application on the configured port, and stops only a process group whose identity still matches its ownership record.

The Visual viewer reads Visual and Data Science runs. In local mode it can:

- detect a completed `index.html` and capture its preview image and video
- recapture a selected visual run
- score a completed Data Science run
- open or delete local run folders
- compare runs and export comparison videos

The static gallery is read-only and excludes those operational controls.

## Project configuration

`pyproject.toml` defines Inspect-specific project paths:

```toml
[tool.bench]
custom-task-roots = ["benchmarks"]
log-dir = "logs"
task-config-dir = "bench-configs"
```

Markdown benchmarks live beside local Python tasks under `benchmarks/`. Each Markdown file must declare `kind: visual` or `kind: data-science` in its frontmatter. Both Bench and the viewer load this same catalog.

Bench remembers recent selections in ignored `.bench-state.json`. Set the standard `NO_COLOR` variable for text-only terminal styling.

## Checks and tests

```bash
npm run check:bench
npm run check:visual
npm run check
npm run test:bench
npm run test:visual
npm test
npm run test:e2e
uv lock --check
```

## Build and publish the gallery

Build the static site from the tracked `public/export/` snapshot:

```bash
npm run build:static
```

This writes the audited site to ignored `dist-static/` without refreshing the public snapshot.

When new local runs should be published:

```bash
npm run publish
git diff -- public/export
git add public/export
git commit -m "data: publish gallery update"
```

`npm run publish` deliberately regenerates `public/export/` from local `runs/`, runs aggregate checks and tests, builds the static site, and applies the privacy audit. Review the export diff before committing it.

Public exports may contain captured media, benchmark definitions, safe summary metadata, and a build-time machine profile. They must not contain generated HTML, prepared prompts, raw responses, logs, command files, local URLs, local filesystem paths, authorization headers, or credentials.

The GitHub Pages workflow builds from the committed export. Optional production analytics use repository variables and secrets; local builds leave analytics disabled unless they are explicitly configured.

## Troubleshooting

### `bench` is missing or points at another checkout

```bash
npm link
command -v bench
```

Run `npm link` under the same Node installation used by your shell.

### Pi has no authenticated models

Open Pi, run `/login`, then retry. Refresh Pi's model catalog when needed:

```bash
pi update --models
```

### A local provider is offline

Start the server configured for that provider in Pi, then choose **Retry**. Bench checks loopback reachability before launch; this does not guarantee that a specific model is already loaded.

### A viewer port is occupied

Check ownership first:

```bash
bench view status
```

Stop Bench-owned viewers with `bench view stop`. If another application owns the port, stop it yourself or set `BENCH_INSPECT_VIEWER_PORT` and `BENCH_VISUAL_VIEWER_PORT` to two distinct free ports. Bench will not kill an unknown process or silently choose another port.

### A viewer fails to start

Inspect the private logs:

```text
.bench-runtime/inspect-viewer.log
.bench-runtime/visual-viewer.log
```

Then run `bench view stop both` to clear validated ownership or stale state before retrying.

### Data Science access is missing

Set both `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the shell or project `.env`. Bench validates both before creating the run slot.

### Visual capture cannot launch Chromium

```bash
npx playwright install chromium
```

Install `ffmpeg` as well if MP4 conversion is required. The viewer can still retain WebM capture when MP4 conversion is unavailable.

## Repository layout

```text
bin/bench.mjs          unified CLI and TUI
src/*.mjs              provider, workflow, lifecycle, and viewer management
src/bench_inspect/     Inspect compatibility hooks
src/lib/               visual/Data Science domain modules
src/server/            local viewer API
src/pages/             Astro routes
src/components/        workbench UI
benchmarks/*.py        local Inspect tasks
benchmarks/*.md        Visual and Data Science definitions
logs/                  ignored Inspect logs
bench-configs/         ignored Inspect task configuration
runs/                  ignored private Visual/Data Science runs
comparison-exports/    ignored local comparison videos
public/export/         tracked publish-safe gallery snapshot
```
