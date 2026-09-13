# Front-end analysis — offgrid-ai-benchmark viewer

> A full audit of the current benchmark viewer from every user surface and angle, the metrics
> inventory, where the gaps are, and how the three mockups (`reels`, `telemetry`, `arena`)
> respond to them. Everything below is grounded in the actual codebase (`src/`, `public/js/`,
> `src/styles/global.css`) and real run data (`runs/**/metadata.json`).

## 1. What the viewer actually is today

`local-llm-visual-benchmark` (becoming **offgrid-ai-benchmark**) is one Astro site that serves two
modes from the same page:

- **Local dev** (`npm run dev`, server adapter) — reads live `runs/`, shows operational controls
  (prepare run, capture, recapture, delete, open folder, copy path).
- **Static public gallery** (`ASTRO_OUTPUT=static`, GitHub Pages at localai.eeshans.com) — reads
  only `public/export/manifest.json`; operational controls are hidden via
  `body[data-static-build="true"] .operational-control { display:none }`.

The whole front-end is **vanilla JS** (no framework): the page shell is `src/components/WorkbenchPage.astro`,
and all behavior lives in ~28 small controller modules under `public/js/`. Rendering is string-based
(`innerHTML` templates), state is a single object (`state.js`), and there is no virtual DOM.

### Surfaces (the things a user actually sees/does)

| Surface | Where | What it does |
|---|---|---|
| **Header** | `WorkbenchPage.astro` `.app-header` | Title, Source pill, "Pairs with offgrid-ai" pill, machine-profile pill, theme toggle, "Prepare run" |
| **Onboarding panel** | `#onboardingPanel` | 3-step getting-started strip (dismissable, persisted) |
| **Kind tabs** | `.kind-tabs` | Visual Benchmark ↔ Data Science Benchmark |
| **View tabs** | `.view-tabs` | By model · By prompt · Compare |
| **Filters** | `.toolbar-filter-group` | Model, Prompt, Harness dropdowns + search + "Include cloud models" toggle |
| **Summary bar** | `.gallery-summary` | Title, run count, "X with video, Y need capture…" line, cloud toggle, clear filters |
| **Runs surface** | `#runsSurface` | The main canvas. Cards (model/prompt modes) or table (compare mode) |
| **Run cards** | `renderRunCard()` | 16:10 preview, title, model/harness/backend pills, status dot, date |
| **Detail modal** | `#detailBackdrop` / `detail-ui.js` | Preview video/image + inspector (meta grid + prompt) |
| **Data-science detail** | `renderDataScienceArtifact()` | Summary card, 3 charts, scorecard, chart lightbox |
| **Prep modal** | `#prepBackdrop` | CLI commands + typical flow (the new offgrid-ai flow) |
| **Delete confirm** | `#deleteConfirmBackdrop` | Destructive confirmation |
| **Tooltips** | `tooltips.js` + `#helpTooltip` | Prompt preview, machine profile |

### Three view modes today
1. **By prompt** (default) — runs grouped by benchmark; each group is a 4-column card grid; card
   title = model.
2. **By model** — runs grouped by model; card title = prompt.
3. **Compare** — a dense table (checkbox per row) + side-by-side preview grid of selected runs.

## 2. The metrics inventory — what the data has vs. what the UI shows

This is the heart of the "I have a lot of metrics now" observation. Real `metadata.json` files
contain **far more than the UI surfaces**. From an actual oMLX run (`sakura` / Qwen3.6-35B-UD-MLX-4bit):

```jsonc
"runner": {
  "tokenMetrics": { "reported": true, "promptTokens": 75583, "completionTokens": 22717, "totalTokens": 98300 },
  "speedMetrics": { "prefillTokensPerSecond": 54.81, "generationTokensPerSecond": 63.56,
                    "ttftMs": 360, "kvCacheTokens": 0, "speculativeDecodeAcceptance": null,
                    "metricSource": "oMLX /v1/chat/completions streaming include_usage" },
  "modelSource": "omlx", "backendLabel": "oMLX", "intendedRunner": "Pi", "retries": 0
},
"results": { "wallClockMs": 619489, "agentTurns": 31, "toolCalls": 31, "success": true,
             "perTurn": [ /* 31 turns of {inputTokens, outputTokens, cacheRead, cacheWrite, wallClockMs, toolCalls} */ ] },
"capture": { "video": { "quality": { "measuredFps": 1.5, "minFps": 12, "sampleMs": 2033,
                                     "frames": 3, "viewport": {1600×900}, "launchArgs": [...] } } }
```

| Metric (in data) | Where it lives | Currently surfaced in UI? |
|---|---|---|
| **Render FPS** `capture.video.quality.measuredFps` | local + published (72/80 runs) | ⚠️ Only as a buried "Video ready · slow render 1.5 FPS" string when *below* budget; never as a gauge/comparison |
| **FPS budget** `minFps` (the 30fps prompt budget → captured as 12) | local + published | ❌ Not shown as a target to compare against |
| **Frames sampled / viewport / launchArgs** | local + published | ❌ Hidden |
| **Token totals** `tokenMetrics.{prompt,completion,total}Tokens` | local; partially published (9/80) | ❌ Never shown anywhere |
| **Speed** `speedMetrics.{prefill,generation}TokensPerSecond` | **local only** (privacy) | ❌ Never shown |
| **TTFT** `speedMetrics.ttftMs` | local only | ❌ Never shown |
| **KV cache / spec-decode acceptance** | local only | ❌ Never shown |
| **Agent turns / tool calls** `results.{agentTurns,toolCalls}` | local only | ❌ Never shown |
| **Wall-clock** `results.wallClockMs` | local only | ❌ Never shown |
| **Per-turn timeline** `results.perTurn[]` (input/output/cache per turn) | local only | ❌ Never shown — and this is the richest signal of all |
| **Retries / fallbacksUsed** `runner.retries/fallbacksUsed` | local | ❌ Hidden |
| **Backend / harness** `modelSource / harnessLabel` | local + published | ✅ Shown as colored stack pills |
| **DS scorecard / summary** | local + published | ✅ Shown in DS detail modal (the one well-surfaced area) |

**The gap in one line:** the viewer is a *gallery* that treats runs as pictures, but each run now
carries a *telemetry dossier* — tokens, speed, turns, per-turn cache behavior, render performance —
and almost none of it is visible. The public gallery can show FPS (it's published); the deep stats
(speed/per-turn) are local-only, which is itself a design constraint to honor.

## 3. User surfaces & angles (who, when, how)

1. **The casual browser** — wants to *see what the models made*, fast, visually. Doesn't care about
   tokens. → today: scroll the card grid. Pain: 4-up grid is fine but there's no "just keep
   scrolling through renders" flow.
2. **The nerd / the owner (you)** — wants to know *why* a run is good/bad: was it slow to render, did
   it burn tokens, how many turns, did spec-decode help? → today: must open the raw metadata.json.
   Pain: the dossier is invisible in-product.
3. **The comparer** — wants to *pick a winner* for a prompt across models. → today: Compare mode
   table + side-by-side. Pain: no stat-by-stat scoring; you eyeball the videos.
4. **The public visitor** (localai.eeshans.com) — static, no operational controls, no local-only
   metrics. Must still feel fast and rich using only what's published (FPS + partial tokens).
5. **The operator** (local only) — preparing/capturing/deleting runs. These controls must survive
   any redesign (they're `data-static-build` gated).

## 4. Gaps & opportunities

- **No feed/scrolling surface.** Browsing 101 runs is paging through 4-col grids. A dedicated
  immersive scroll surface would make "view runs really quickly" real.
- **No metrics-first surface.** The data is rich; there's no leaderboard/gauge/timeline view.
  Sorting by gen tok/s, FPS, TTFT, turns — or ranking models — isn't possible today.
- **FPS is under-sold.** The 30fps budget is now a *concrete* prompt requirement (commit 33d0cbe),
  captured as `minFps`. A 1.5fps sakura vs a 120fps snow-globe is a dramatic, honest story — but
  today it's a tiny text string.
- **Per-turn timeline is wasted.** 31 turns of input/output/cache data is a beautiful "how the
  agent actually worked" chart that exists in zero UI.
- **Comparison is eyeball-only.** No "tale of the tape" / scorecard to read a winner from stats.
- **Public vs local asymmetry.** Any redesign must degrade gracefully: static mode can show FPS +
  partial tokens; speed/per-turn are local-only and should hide cleanly (already a pattern via
  `data-static-build` / null checks).

## 5. The three mockups — three distinct answers

Each is a *complete alternative redesign* of the viewer, leaning on a different paradigm. All use
real data (`mockups/_data.js`, 14 real runs) and real preview images. None touches existing code.

### A · `reels.html` — "Reels" (the TikTokify direction)
Full-bleed vertical snap-scroll feed, one run per screen, autoplay-looping preview (real
`preview.png` + Ken Burns + play/MP4 affordance). Right-side action rail surfaces the headline stat
(FPS vs the 12fps budget) and a **Stats ↑** button that swipes up the full telemetry sheet — token
economics (stacked prompt/completion bar), inference speed (prefill/gen/TTFT/spec-accept), a radial
FPS gauge vs budget, and the per-turn activity timeline. Filter chips at top; right-edge progress
rail; keyboard ↑/↓ nav. **Answers use case 2 (scroll-fast) primarily, surfaces nerd stats on
demand.**

### B · `telemetry.html` — "Telemetry" (the nerd-stats direction)
Mission-control / Bloomberg-terminal take. A dense leaderboard where every run is a row with an
embedded mini FPS gauge, stacked token bar, speed chips (prefill vs gen tok/s), TTFT, turns,
wall-clock, and spec-decode acceptance. Columns are sortable; click a row to expand the per-turn
activity timeline + full spec sheet inline. Right rail ranks the field by each metric (fastest
gen, smoothest render, lowest TTFT, best spec-accept, fewest turns) with mini bars. **Answers use
case 1 (metrics) primarily; leaderboard sorting also makes browsing fast.**

### C · `arena.html` — "Arena" (the versus / comparison direction)
A head-to-head theater: pick a prompt, send 2–3 models into the ring at once. Each contender shows
its render large + a boxing-style **tale of the tape** — FPS, tokens, gen speed, TTFT, turns,
wall-clock, spec-accept — with the per-metric winner highlighted in gold. The smoothest render takes
the **champion** crown. A film-strip scrubber below flips the whole field for that prompt — click
to swap a contender in, 2-up/3-up toggle. **A third angle: the benchmark's purpose *is* comparison,
so the stats become a competitive scorecard. Balances both use cases.**

## 6. Design constraints carried forward (from AGENTS.md + ecosystem-vision)

- **Don't break the local/static split.** Operational controls are `.operational-control` +
  `data-static-build`; any redesign keeps that gating.
- **Privacy asymmetry.** Speed metrics, per-turn data, launch commands, raw paths stay local.
  The public gallery only ever sees FPS + partial tokens + benchmark text + previews. Mockups
  that show deep stats are explicitly *local-dev* surfaces.
- **offgrid-ai family.** This repo becomes `offgrid-ai-benchmark`, the visual+DS benchmark tool in
  the family (`offgrid-ai` = control center, `-sidequests` = dashboard, `-howiprompt` = prompt
  analyzer). The viewer is the showcase for the whole ecosystem's output, so it should feel like a
  flagship, not a side project.
- **Vanilla-JS-friendly.** The real codebase has no framework; the mockups are intentionally
  dependency-free vanilla JS too, so any chosen direction can be implemented with the existing
  architecture (controller modules under `public/js/`) rather than requiring a rewrite.

## 7. How to view

Open any of the three directly in a browser (they load `../runs/` and `../public/export/` images
relative to the repo), or serve the repo root and visit `/mockups/<name>.html`:

```bash
cd /Users/eeshans/dev/local-llm-visual-benchmark
npx serve .          # then open /mockups/reels.html  /mockups/telemetry.html  /mockups/arena.html
```