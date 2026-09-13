---
title: "[Completed] Data Science Benchmark Plan"
lastmod: 2026-05-30
---


## Vision

The next benchmark category tests whether a local model can complete a real production-style data science workflow, not just answer a synthetic prompt. The first benchmark is the live A/B Simulator project: a real memory-game experiment with Variant A and Variant B, continuously randomized traffic, Supabase-backed event data, and an existing statistical analysis notebook that serves as the reference oracle.

This connects two projects: A/B Simulator provides the live data and product context, while Local LLM Visual Benchmark provides the comparison gallery and scoring infrastructure. The core question is practical: can a local model connect to a real data source, query the right data, analyze the experiment correctly, build useful visualizations, and make a grounded product recommendation without hallucinating?

The benchmark fits the existing framework as a new `data-science` run kind. It reuses the same run folder contract, metadata schema, prepare-run flow, workbench, and static export. The only additions are a new benchmark prompt, a new detail-rendering path for charts/summaries, and a scoring layer that compares model output against a canonical oracle.

## What This Benchmark Tests

| Capability | How tested |
|---|---|
| **Tool calling** | Must load env vars, make HTTP requests to Supabase |
| **API/data understanding** | Must find the right table, use correct filters, select correct columns |
| **Statistical procedure** | Must check SRM before trusting results, use Welch's t-test, compute effect size and CI |
| **Multi-metric reasoning** | Must weigh primary metric against guardrails |
| **Product judgment** | Must produce a grounded ship/don't-ship/inconclusive decision |
| **Hallucination resistance** | Must cite real numbers from queried data, not invent them |
| **Structured output** | Must produce valid `summary.json` with correct schema |
| **Notebook quality** | Must be runnable, ordered, documented, reproducible |
| **Visualization** | Must produce 3 clear, labeled, interpretable charts |
| **Python/coding** | Must write working Python that connects to a live API and produces correct statistical output |

## Benchmark Prompt: "A/B Test Production Analysis"

The model receives a benchmark prompt (from `benchmarks/ab-test-analysis.md`) that tells it:

1. **Context**: The A/B Simulator is a Pineapple Finder memory game. Variant A has 4 pineapples, Variant B has 5. Data lives in a Supabase `posthog_events` table.
2. **Data access pattern**: Use `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` env vars. Query via PostgREST: `GET {SUPABASE_URL}/rest/v1/posthog_events?select=...&session_id=not.is.null&variant=not.is.null`.
3. **Required outputs**: Write these files into the run folder:
   - `analysis.ipynb` — a Jupyter notebook with the full analysis
   - `summary.json` — a machine-readable summary with a defined schema
   - `chart-distribution.png` — completion time distribution by variant
   - `chart-treatment-effect.png` — treatment effect confidence interval
   - `chart-completion-rates.png` — completion/repeat rate comparison
4. **Required sections** in the notebook:
   - Setup & data pull (imports, env, Supabase API, query, DataFrames)
   - Metric definitions & sanity checks (primary KPI, guardrails, SRM test, data quality)
   - Primary analysis (Welch's t-test, CI, Cohen's d, interpretation)
   - Guardrail analysis (completion rate χ² test, repeat rate z-test)
   - Visualizations (3 charts listed above)
   - Conclusion & recommendation (executive summary + `summary.json`)
5. **Not required** (cut from the full reference notebook):
   - OLS regression (redundant with t-test for 2-variant experiment)
   - CUPED variance reduction (educational, not a decision requirement)
   - Power analysis (valuable but not needed for the decision itself)
   - Outlier detection detail, KDE, daily volume/trend charts
   - Extended educational commentary

## summary.json Schema

```json
{
  "status": "significant" | "not_significant" | "inconclusive",
  "decision": "string — one-line ship/don't-ship/inconclusive recommendation",
  "metrics": [
    { "label": "Completion Time", "value": "string", "delta": "string", "delta_direction": "up|down", "context": "string" },
    { "label": "Completion Rate", "value": "string", "delta": "string", "delta_direction": "up|down", "context": "string" },
    { "label": "Repeat Rate", "value": "string", "delta": "string", "delta_direction": "up|down", "context": "string" },
    { "label": "Effect Size", "value": "string", "context": "string" }
  ],
  "raw_stats": {
    "p_value": "number",
    "cohens_d": "number",
    "mean_a": "number",
    "mean_b": "number",
    "std_a": "number",
    "std_b": "number",
    "completion_rate_a": "number",
    "completion_rate_b": "number",
    "repeat_rate_a": "number",
    "repeat_rate_b": "number",
    "srm_p_value": "number"
  },
  "warnings": ["string"],
  "methodology": "string",
  "generated_at": "ISO 8601 timestamp"
}
```

This mirrors the existing `ab_test_analysis.summary.json` from the A/B Simulator notebook, which serves as the reference oracle.

## Run Folder Shape

```text
runs/
  ab-test-analysis/
    {model-slug}/
      {run-id}/
        metadata.json
        prompt.md
        analysis.ipynb
        summary.json
        chart-distribution.png
        chart-treatment-effect.png
        chart-completion-rates.png
```

Same folder contract as visual runs. `metadata.json` records `kind: "data-science"` and lists assets (notebook, summary, charts). The model writes analysis outputs into the prepared folder using its coding harness.

## How It Fits the Existing Framework

The data-science benchmark is not a new framework. It is a new `RunKind` that flows through the same pipes as visual runs.

### What changes

| Area | Change | Scope |
|---|---|---|
| **`RunKind` type** | Add `"data-science"` | `src/lib/types.ts` — one line |
| **Run discovery** | Stop filtering out `data-science` runs | `src/lib/runs.ts` — change `kind !== "visual"` to allowed-kinds check |
| **Export filter** | Include `data-science` runs in static export | `src/lib/export.ts` — same filter change |
| **Asset types** | Add `RunAssets` fields for notebook, summary, charts | `src/lib/types.ts` — optional fields on existing interface |
| **Prepare Run** | Allow `data-science` kind in API validation | `src/server/api-helpers.ts` — widen `readRunKind` |
| **Client: run filtering** | Filter runs by kind for workspace tabs | `public/js/runs.js` — extend `runKind()` and workspace filter |
| **Client: detail view** | Render charts/summary instead of HTML preview | `public/js/detail-ui.js` — conditional rendering by kind |
| **Client: compare** | Show chart comparison instead of video | `public/js/compare-ui.js` — conditional rendering by kind |
| **Client: prepare** | Show data-science prepare flow (env vars, output contract) | `public/js/prepare-controller.js` — conditional by benchmark category |
| **Benchmark prompt** | Add `benchmarks/ab-test-analysis.md` | New file |
| **Capture** | Skip Playwright capture for data-science runs | `src/lib/capture-media.ts` — guard on kind |

### What stays the same

- Same `runs/` folder structure and `metadata.json` contract
- Same Prepare Run flow (pick benchmark, pick model, pick harness, prepare folder)
- Same workbench with By-prompt, By-model, Table modes
- Same static export pipeline (different assets, same manifest)
- Same compare selection and side-by-side panel (different rendering, same UX)
- Same operational controls (local-only, hidden in static mode)

## Data-Science Run Detail: Visual Composition

The detail panel reuses the existing layout. The hero surface changes from HTML preview/video to a chart composition + metrics ribbon.

### Hero: Chart triptych (1-over-2 layout)

The treatment effect chart spans full width at top (the "verdict" chart — shows CI and zero line). Below it, two columns: distribution chart (left) and completion rates chart (right). This mirrors a real analysis dashboard: big finding up top, supporting evidence below. Mobile stacks all 3 vertically.

### Metrics ribbon

A horizontal strip below the triptych showing the verdict badge and key numbers from `summary.json`:

- **Verdict pill**: large colored pill — red "Don't Ship", amber "Inconclusive", green "Ship"
- **Completion Time delta**: colored directional indicator
- **Effect Size** (Cohen's d)
- **p-value / significance**

Uses the same stack-pill and badge styling already in the app. The ribbon is above the fold; you see verdict + charts at the same glance.

### Notebook section

Below the metadata strip: cell count summary and a "View notebook" action (same as "Open HTML" for visual runs). The full prompt text remains scrollable below. No inline notebook rendering — the charts are the visual output, the notebook is source code.

### Score bar (Phase 3)

If a scorecard exists: compact progress bar with total score (e.g. "128/150 85%") and small pass/warn indicators per dimension (Data access, Stats, Charts, Grounding).

### Compare panel

Same side-by-side layout as visual runs. Each column shows the chart triptych + metrics ribbon for one model. Charts and verdicts align visually for easy comparison.

### Workbench cards

Thumbnail: the treatment-effect chart as a small preview (same role as preview.png for visual cards). Status line: "3 charts · summary ready" instead of "video ready". Verdict pill on the card.

## Scoring

### Layer 1: Deterministic checks (automated, objective)

| Check | Points | Method |
|---|---|---|
| `summary.json` exists and parses | 5 | File read + JSON parse |
| `summary.json` has required fields | 10 | Schema validation |
| `summary.json.status` matches oracle | 10 | String match |
| `p_value` within tolerance (±0.05) | 10 | Numeric comparison against oracle |
| `cohens_d` within tolerance (±0.1) | 10 | Numeric comparison against oracle |
| Data accessed from real Supabase | 15 | Check notebook code for actual API calls vs hardcoded data |
| Key hypothesis tests present | 10 | Grep notebook for scipy.stats calls (t-test, chi-square) |
| 3 chart files exist | 10 | Check for .png files in run folder |
| SRM test performed | 5 | Grep for chi-square / SRM / sample ratio |
| `recommended_variant` matches oracle | 15 | "A" or "B" — exact match against oracle |

**Subtotal: 100 points**

### Layer 2: LLM-as-judge (qualitative, nuanced)

| Dimension | Points | Rubric |
|---|---|---|
| Notebook structure & runnability | 0–10 | Can you execute it top-to-bottom? Ordered, documented? |
| Visualization quality | 0–10 | Readable, properly labeled, appropriate chart types? |
| Statistical interpretation | 0–10 | Does the model interpret correctly (not just compute)? |
| Grounding & hallucination | 0–10 | All claims backed by computed numbers? No invented data? |
| Product recommendation quality | 0–10 | Decision justified, clear, consistent with the data? |

**Subtotal: 50 points**

**Total: 150 points**

### Oracle / ground truth

The existing `ab_test_analysis.summary.json` from the A/B Simulator repo is the first reference oracle. A lightweight canonical script will query Supabase at scoring time, compute primary metrics with tolerant bounds (±5% for means, ±0.05 for p-values), and output the expected `summary.json` shape with a snapshot timestamp.

Since the data is live and may grow, scoring compares within tolerance bands rather than exact match.

## Implementation Phases

### Phase 1: Benchmark definition and run-kind plumbing

Goal: add the `data-science` run kind to the framework, write the benchmark prompt, and make Prepare Run work for data-science benchmarks.

- [x] Add `"data-science"` to `RunKind` type in `src/lib/types.ts`
- [x] Add optional asset fields to `RunAssets`: `notebook`, `summary`, `chartDistribution`, `chartTreatmentEffect`, `chartCompletionRates`
- [x] Update `readMetadataIfPresent` in `runs.ts` to accept `data-science` runs (change `kind !== "visual"` to allowed-kinds check)
- [x] Update export filter in `export.ts` to include `data-science` runs (same filter change)
- [x] Widen `readRunKind` in `api-helpers.ts` to accept `"data-science"`
- [x] Write `benchmarks/ab-test-analysis.md` benchmark prompt
- [x] Update Prepare Run client to handle data-science benchmark (show env var setup, output file contract)
- [x] Skip Playwright capture for data-science runs in `capture-media.ts`
- [x] Add unit tests for the new run kind and asset fields
- [x] Run check + existing tests to confirm nothing breaks

Acceptance: user can Prepare Run for ab-test-analysis; `metadata.json` records `kind: "data-science"`; existing visual runs unaffected.

### Phase 2: Gallery detail, chart rendering, and compare

Goal: data-science runs display beautifully in the detail panel, compare panel, and workbench cards.

- [x] Add data-science detail rendering in `detail-ui.js`: chart triptych (1-over-2 layout), notebook link
- [x] Add data-science detail rendering: metrics ribbon with verdict pill
- [x] Add CSS for chart triptych layout (1-top/2-bottom, mobile stack)
- [x] Add CSS for metrics ribbon (verdict pill, metric badges)
- [x] Update workbench cards for data-science runs: treatment-effect chart as thumbnail
- [x] Update workbench cards for data-science runs: "3 charts · summary ready" status, verdict pill
- [x] Update compare panel for data-science runs: chart image rendering
- [x] Update compare panel for data-science runs: metrics ribbon
- [x] Update `runKind()` client helper to return `"data-science"` for new runs
- [x] Extend workspace filter to show data-science runs alongside visual runs
- [x] Update static export to copy chart PNGs and summary JSON for data-science runs
- [x] Add E2E tests for data-science detail and compare rendering
- [x] Visual QA — chart triptych, metrics ribbon, compare panel, mobile (structural: verified via E2E; pixel QA pending real chart artifacts)

Acceptance: data-science run renders chart triptych + metrics ribbon in detail; side-by-side compare works; static export includes charts + summary; visual runs render exactly as before.

### Phase 3: Scoring infrastructure

Goal: build the automated scoring pipeline that compares model outputs against the canonical oracle.

- [x] Write canonical oracle script (`scripts/score-oracle.py`) that queries Supabase and produces expected `summary.json` with tolerance bands
- [x] Write scoring script (`scripts/score-ds-run.py`) that takes a run directory and produces a Layer 1 deterministic scorecard
- [x] Add LLM-as-judge prompt template for Layer 2 qualitative scoring
- [x] Test scoring against the existing A/B Simulator notebook output
- [x] Document scoring rubric in the benchmark prompt
- [x] Surface score bar in run detail view (if scorecard exists)

Acceptance: scorer produces a deterministic scorecard from a run directory; oracle produces correct expected values; reference notebook scores ≥130/150; scoring works from CLI.

### Phase 4: Real model runs and gallery population

Goal: run the benchmark against local models, score results, and populate the gallery.

- [ ] Run ab-test-analysis benchmark against at least 3 local models
- [ ] Score all runs and verify scorecards
- [ ] Publish runs to the public gallery via `npm run publish`
- [ ] Compare model scores side-by-side in the workbench

### Phase 5: Expand the benchmark set (future)

- Add an advanced "full notebook recreation" variant (OLS, CUPED, power analysis)
- Add additional data-science benchmarks: segmentation, retention, anomaly detection, forecasting
- Add standalone hallucination/grounding benchmarks reusing the scoring patterns
