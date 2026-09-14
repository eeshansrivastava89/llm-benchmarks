# Phase 5: Viewer manager

Completed on 2026-09-14 on `feat/unified-benchmark-suite`.

## Commands

Bench now supports:

```text
bench view inspect
bench view visual
bench view both
bench view status
bench view stop [inspect|visual|both]
```

`bench view` without a target opens the equivalent TUI selector. Successful benchmark runs also offer `No`, `Relevant viewer`, and `Both viewers`; `No` is selected by default.

`both` starts or reuses both services and opens Visual as the hub. Status and stop commands work without an interactive terminal.

## Endpoints and configuration

Both services bind to loopback with deterministic defaults:

```text
Inspect: http://127.0.0.1:7575
Visual:  http://127.0.0.1:4321
```

Ports can be changed with `BENCH_INSPECT_VIEWER_PORT` and `BENCH_VISUAL_VIEWER_PORT`. Bench rejects invalid values and refuses to use the same port for both services.

Inspect is started with an absolute project and log directory:

```text
uv run --project <repository> inspect view start --host 127.0.0.1 --port <port> --log-dir <repository>/logs
```

Its working directory is `.bench-runtime/`, which prevents Inspect from loading the repository `.env`. Visual runs from the repository root with:

```text
npm run dev -- --host 127.0.0.1 --port <port>
```

## Health and ownership

`src/viewers.mjs` checks application-specific endpoints before reuse:

- Inspect: `/api/app-config` must return an `inspect_version` string.
- Visual: `/api/benchmarks` must return a `benchmarks` array.

An open port with another response is treated as an unknown application and blocks startup. Matching external viewers may be reused, but are never recorded as Bench-owned and cannot be stopped by Bench.

Bench-owned state is stored in `.bench-runtime/viewers.json` with mode `0600`. The directory uses mode `0700`. State contains only the PID, process-group ID, URL, descriptor identity, start time, and log path. Viewer output goes to private append-only log files in the same directory.

## Process handling

Viewers are spawned as detached process groups and report healthy only after their endpoint signature passes. Startup failures and timeouts point to the relevant log. A timed-out child receives `SIGTERM`, followed by `SIGKILL` only when the same process identity is still present.

Stop operations require matching state, a live recorded process group, and matching process command markers. Unknown endpoints and changed process identities are not signaled. Stale ownership entries are removed without killing a process. Healthy external viewers are reported as external and left running.

## Validation

- `npm run check`: passed; the existing unused `cleanLines` TypeScript hint remains.
- `npm test`: passed with 63 Bench tests and 114 visual tests.
- Viewer unit tests cover descriptors, configurable ports, endpoint signatures, reuse, private state, unknown-port refusal, validated stop, stale ownership, missing commands, early exits, and startup timeout escalation.
- A local integration run started both real viewers on alternate ports, confirmed both as healthy and Bench-owned, then stopped both process groups. No listeners remained and the temporary `.bench-runtime/` directory was removed.
- `git diff --check`: passed.
