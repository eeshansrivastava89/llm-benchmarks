# Phase 7 end-to-end validation

## Automated results

Validation completed on the `feat/unified-benchmark-suite` branch:

- `npm run check`: Node syntax, Python compilation, Astro, and TypeScript passed with no diagnostics.
- `npm test`: 68 Bench tests and 117 visual unit tests passed.
- `npm run test:e2e`: 23 Playwright tests passed against an isolated dev server.
- `uv lock --check` and `git diff --check` passed.
- `npm run build:static`: generated a 582-file build and passed the privacy audit.
- `STATIC_AUDIT_DIR=public npm run audit:static`: passed for all 435 files in the restored public snapshot.

Playwright now owns its dev server and uses isolated Inspect and Visual ports. The browser suite covers the local Inspect link, grouped views, comparison, capture progress and failures, static fallback, Data Science cards, mobile layouts, default cloud-run visibility, and source files that are already present when the viewer opens.

## Process and failure coverage

The test suite uses controllable child processes for Pi and both viewers. It covers successful and interrupted Pi exits, nonzero exits, missing commands, viewer startup timeouts, occupied ports, stale ownership records, reuse, and stop behavior. Mocked Ollama and authenticated oMLX APIs verify model unloading after normal and interrupted sessions without contacting a real service.

Both real viewer processes were also started on isolated ports. Their native APIs responded, Chromium followed the Visual header link to Inspect, and shutdown removed the listeners and viewer state.

The interactive Visual check exposed stale absolute `runDirectory` values in copied historical metadata. The run scanner now treats the discovered folder as authoritative, so reads, captures, deletes, and asset URLs remain inside the unified repository. A live sweep loaded all 435 historical preview and video assets without an HTTP failure. Cloud runs are visible by default, and a completed `index.html` is reported immediately even when it predates viewer startup.

## Local execution checks

A one-sample Inspect run completed with `ollama/qwen3.5:4b-mlx` and scored `1.0` on `benchmarks/smoke.py`. Its `.eval` log passed the credential scan, and the model was unloaded afterward.

An interactive Visual run completed with `deepseek-flash`. The viewer detected its `index.html`, captured its media, and displayed the resulting preview correctly.

The Data Science preparation path was exercised with a synthetic credential. The value appeared only in the temporary `supabase.json`, whose mode was `0600`; it did not appear in `prompt.md` or `metadata.json`. The temporary run was removed.

## Static export boundary

Static generation now replaces run-embedded benchmark prompts with the canonical benchmark definition. This prevents an old prompt from republishing data that has since been removed from the benchmark source.

The audit rejects private run artifacts, loopback and file URLs, local home paths, authorization headers, API-key fields, token-shaped values, and private runner fields. It reports file paths and rule names without printing matched values.

Validation found a credential-shaped Supabase value in an older tracked public metadata file and the manifest copy. Both copies were replaced with the canonical credential-free prompt. If that value is still active and is treated as private, rotate it because it remains in earlier Git history.

Generated build files and newly exported local runs were removed after validation. The intended public changes are limited to the sanitized metadata and manifest.

## Acceptance results

The interactive Visual run completed, its media rendered correctly, and both native viewers ran under Bench ownership. The Inspect result link was exercised against the local one-sample result.

A private Data Science run completed with `deepseek-flash`, produced every required artifact, and scored 100/100. Its temporary `supabase.json` was removed after Pi exited. The longer valid warning list exposed a nested-scroll layout bug in the detail view; the dashboard now scrolls as one surface, presents complete model warnings in a dedicated card below the charts, and keeps the full scoring card accessible.

Phase 7 is complete. No broad cloud benchmark run was needed.
