# offgrid-ai-benchmark viewer — redesign mockups

Three radically different redesign directions for the benchmark viewer, plus a full front-end
analysis. **Nothing here changes existing code** — these are standalone HTML mockups in `mockups/`,
built on real data and real preview images.

> Part of the **offgrid-ai family**: `offgrid-ai` (control center) · `offgrid-ai-benchmark`
> (this repo — visual + data-science benchmarks) · `offgrid-ai-sidequests` (dashboard) ·
> `offgrid-ai-howiprompt` (prompt analyzer). See
> [`../offgrid-ai` ecosystem vision](https://github.com/eeshansrivastava89/offgrid-ai).

## Two jobs these redesigns serve

1. **Nerd stats** — offgrid-ai now captures a lot of metrics on model runs that the current gallery
   never shows: token economics (prompt/completion), inference speed (prefill/gen tok/s, TTFT,
   KV-cache, speculative-decode acceptance), agent behavior (turns, tool calls, wall-clock), a full
   per-turn timeline, and render performance (measured FPS vs the new 30fps prompt budget).
2. **TikTokify** — make the gallery effortless to scroll through so people can flip between runs
   very, very quickly, instead of paging 4-column card grids.

## The three mockups

| File | Name | Paradigm | Leans toward |
|---|---|---|---|
| `reels.html` | **Reels** | TikTok-style full-bleed vertical snap-scroll feed; one run per screen; swipe-up telemetry sheet | TikTokify (stats on demand) |
| `telemetry.html` | **Telemetry** | Bloomberg-terminal / mission-control leaderboard; every metric as a gauge/bar/sparkline; sortable + expandable per-turn timeline | Nerd stats |
| `arena.html` | **Arena** | Head-to-head versus theater; 2–3 models in the ring with boxing "tale of the tape" scorecards + a film-strip scrubber to flip the field | Comparison (balances both) |

Each is a **complete, interactive, self-contained** mockup: filters, navigation, expandable stats,
real interactions (snap-scroll, sortable columns, swap contenders, champion crowning). Each has a
"Design notes" toggle in the corner explaining its concept and trade-offs.

## Data & images — all real

`_data.js` holds **14 real runs** extracted from actual `runs/**/metadata.json` files — real token
counts, FPS, speed metrics, turns, wall-clock, spec-decode acceptance. Preview images reference the
real `preview.png` files in `runs/` and `public/export/` (verified to exist). Nothing is fabricated.

The dataset deliberately spans the dramatic contrasts in the real data:
- **The render "fails":** sakura 1.5 fps (3 frames) and macro-wildflower 4.8 fps / 17 fps — all oMLX
  Qwen, decent gen tok/s but the animation is too heavy.
- **The champions:** snow-globe 120 fps in 8 turns / 3.9 min (llama.cpp MTP, 0.581 spec accept),
  macro-wildflower 120 fps (0.701 spec accept), GLM 5.2 cloud 120 fps.
- **The marathons:** sunset-ocean 111 turns / 65 min; sakura 62 turns / 42 min.
- **The token monster:** snow-globe 1.37M tokens.

## View them

```bash
cd /Users/eeshans/dev/local-llm-visual-benchmark
npx serve .   # open  /mockups/reels.html  /mockups/telemetry.html  /mockups/arena.html
```

Or just double-click any `.html` in this folder (they load images via relative `../` paths).

## Files

```
mockups/
├── _data.js            # shared real dataset (14 runs) + formatting helpers
├── reels.html          # Mockup A — Reels (TikTokify feed)
├── telemetry.html      # Mockup B — Telemetry (nerd-stats dashboard)
├── arena.html          # Mockup C — Arena (versus theater)
├── ANALYSIS.md         # full front-end analysis: surfaces, metrics inventory, gaps
├── README.md           # this file
└── (pre-existing) card-redesign.html, compare-tab.html, ds-cards*.html, modals.html
```

The pre-existing mockups in this folder are *incremental* refinements of the current design (same
Space Grotesk + teal neutral aesthetic). The three new ones are deliberately **radical** — each
commits to a different paradigm rather than polishing the current card grid.

## A note on public vs local

Deep stats (speed, per-turn, KV-cache) are **local-only** by the repo's privacy contract — the
published `public/export/manifest.json` keeps FPS and partial token metrics but strips speed and
per-turn data. So `telemetry` and the `reels` stats sheet are local-dev surfaces; any
public/static version degrades gracefully to FPS + whatever tokens are published (the mockups
already null-check every metric).