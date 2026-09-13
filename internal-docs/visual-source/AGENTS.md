# AGENTS.md

Project-specific notes for coding agents working in this repo.

## Publishing workflow

Use one command before committing benchmark/gallery updates:

```bash
npm run publish
```

Then use normal git:

```bash
git add .
git commit -m "..."
git push
```

Why: local benchmark runs are written to ignored `runs/`, but production reads tracked `public/export/`. `npm run publish` refreshes `public/export`, runs checks/tests, and builds the static site. Do not push benchmark updates without it.

## Data folders

- `runs/` — ignored local run source data. Do not commit.
- `public/export/` — tracked public gallery snapshot. Commit this after `npm run publish`.
- `comparison-exports/` — ignored local video exports. Preserve unless explicitly told otherwise.
- `dist/` and `dist-static/` — ignored build output.

## Runner

Benchmark runs are prepared and executed using [offgrid-ai](https://www.npmjs.com/package/offgrid-ai), an external npm package. The `local-llm` CLI that was previously in `scripts/local-llm/` has been removed — its functionality is now in offgrid-ai.

```bash
npm install -g offgrid-ai
offgrid-ai models          # select a model → run, benchmark, or inspect
offgrid-ai run <profile>   # start the model server and open Pi
offgrid-ai benchmark       # prepare a benchmark run (standalone)
```

## Supported backends

| Backend | Type | Server management | Model source |
|---|---|---|---|
| llama.cpp | local-server | Start/stop process | `~/.lmstudio/models/` GGUF |
| llama.cpp MTP | local-server | Start/stop with speculative decoding | `~/.lmstudio/models/` GGUF |
| Ollama | managed-server | Verify connectivity | Ollama API (`localhost:11434`) |
| oMLX | managed-server | Verify connectivity | oMLX API (`127.0.0.1:8000`) |

## Model source schema

- `modelSource` ∈ `{ollama, omlx, llama-cpp, llama-cpp-mtp, cloud}`
- Old values `custom`, `lmstudio`, `(none)` have been migrated to the new set
- `isCloudRun` in UI: `run.runner?.modelSource === "cloud"`
- `backendLabel` is display-only, not used for filtering

## Validation

Common checks:

```bash
npm run check
npm test
npm run build:static
```

`npm run publish` already runs check, tests, and a static build after refreshing `public/export`.

## GitHub Pages

- Production domain: `https://localai.eeshans.com/`.
- Pages deploy uses GitHub Actions and committed `public/export`.
- CI builds with:

```text
STATIC_USE_EXISTING_EXPORT=true
ASTRO_BASE=/
```

So CI will not read local ignored `runs/`; commit `public/export` or production will stay stale.

## Privacy / public export

The public export should include summary metadata, benchmark text, preview PNGs, and preview MP4s. It should not publish raw generated HTML, prepared prompts, raw responses, logs, command files, local service URLs, or local filesystem paths.

Production GitHub Pages enables PostHog through public env vars in `.github/workflows/deploy-pages.yml`; local builds keep analytics disabled unless those env vars are set.

## Keep changes small

Prefer one clear workflow over multiple commands. Avoid duplicate state, dead code, and broad provider/cloud management unless the user explicitly asks for it.