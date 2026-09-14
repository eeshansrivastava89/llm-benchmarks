# Phase 6: Viewer cross-link

Implemented on 2026-09-14 on `feat/unified-benchmark-suite`.

## Visual viewer action

The Visual viewer header now includes an `Inspect results` action. It opens Inspect in a new tab with `target="_blank"` and `rel="noopener noreferrer"`. The action uses the existing button system, retains a visible keyboard focus ring, and wraps without horizontal overflow on narrow screens.

Visual remains the hub opened by `bench view both`; Inspect is not embedded, proxied, or modified.

## URL configuration

`src/viewer-config.mjs` is the shared source of truth for loopback hosts, default ports, port validation, and viewer origins. Both the viewer manager and Astro header use it, so `BENCH_INSPECT_VIEWER_PORT` changes the local link and the managed Inspect process together.

Static builds omit the action by default. A public deployment may opt in at build time with:

```text
PUBLIC_INSPECT_VIEWER_URL=https://inspect.example/results
```

The public value must be a credential-free HTTP(S) URL. Localhost and loopback targets are rejected, preventing local Inspect links from entering public output accidentally.

## Validation

- `npm run check`: passed; the existing unused `cleanLines` TypeScript hint remains.
- `npm test`: passed with 64 Bench tests and 114 visual tests.
- `uv lock --check`: passed.
- `npm run build:static`: passed with 6 benchmarks and 159 runs; generated tracked export changes were restored afterward.
- Focused Playwright coverage for local visibility, configured href, new-tab attributes, keyboard focus, and mobile overflow: passed.
- A rendered local server with `BENCH_INSPECT_VIEWER_PORT=17575` produced the matching Inspect href.
- Static build tests cover omission by default and rendering with an explicit public URL.
- `git diff --check`: passed.

The broader legacy Playwright cases still contain pre-existing expectations for the old viewer title and Setup control. The focused Phase 6 case passes independently; updating unrelated E2E expectations remains outside this phase.
