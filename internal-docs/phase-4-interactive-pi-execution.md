# Phase 4: Interactive Pi execution

Completed on 2026-09-14 on `feat/unified-benchmark-suite`.

## Execution path

After the Visual or Data Science review is confirmed, Bench now:

1. Leaves its alternate screen.
2. Creates one canonical run slot through `prepareInteractiveBenchmarkRun()`.
3. Starts `pi` in the new run directory with the selected provider and model.
4. Submits `@prompt.md` as the initial message and waits for Pi to exit.
5. Updates failed or cancelled run metadata when Pi does not exit normally.
6. Runs local-model cleanup and deletes the temporary Data Science access file.

The generated Pi arguments are:

```text
--provider <provider> --model <model-id> --name "Bench: <benchmark title>" -- @prompt.md
```

No provider or Data Science credential is added to the arguments, prompt, launch command, or run metadata. Normal Pi configuration, sessions, tools, extensions, skills, context files, and project trust behavior remain active.

## Foreground process handling

`src/interactive-runner.mjs` owns Pi invocation construction, run preparation, foreground child execution, status updates, and final cleanup. The foreground coordinator keeps the Bench parent alive for `SIGINT` and `SIGTERM`, forwards the signal to Pi, waits for Pi to close, and removes its temporary signal handlers.

A zero exit leaves the run in `prepared` status for capture or scoring. A nonzero exit marks it `failed`; handled termination marks it `cancelled`. Failure to start Pi records a fixed, sanitized error instead of the underlying process error.

## Local model cleanup

`prepareLocalModelLifecycle()` now accepts provider connection data instead of an Inspect translation object.

- Inspect keeps the ownership-aware policy: models already loaded before Bench remain loaded.
- Visual and Data Science force the always-unload policy after Pi exits.
- Ollama and oMLX use their existing explicit adapters.
- Unsupported local providers remain selectable, but the review defaults to Go back and states that the model will remain loaded.
- oMLX cleanup authentication is resolved in memory through Pi's model runtime and is not passed to the Pi command or persisted.

The always-unload path attempts unload even when the status endpoint cannot be read.

## Data Science access cleanup

The private `supabase.json` file exists while Pi is running and is removed in `finally` after normal exit, nonzero exit, handled termination, or launch failure. Tests verify that its key does not appear in metadata or errors.

## Validation

- `npm run check`: passed; the existing unused `cleanLines` TypeScript hint remains.
- `npm test`: passed; the current suite contains 53 Bench tests and 114 visual tests. The final status-check fallback regression also passed in a focused run.
- `uv lock --check`: passed.
- Focused tests cover exact Pi arguments, foreground exit statuses, missing commands, signal forwarding, successful prepared runs, failed runs, cancelled runs, sanitized launch errors, Data Science access deletion, and local cleanup policy.
- `git diff --check`: passed.
