---
id: ab-test-analysis
kind: data-science
title: A/B Test Production Analysis
description: Run a full production A/B test analysis against live Supabase data, including statistical tests, guardrail checks, visualizations, and a grounded ship/don't-ship recommendation.
---

## Context

If you need Python packages, create a virtual environment and install them there — do not assume packages are pre-installed.

The A/B Simulator is a Pineapple Finder memory game. Variant A has 4 pineapples, Variant B has 5. Data lives in a Supabase `posthog_events` table that records player interactions from live randomized traffic.

Each row is one event. The important event types are `puzzle_started` and `puzzle_completed`. The `variant` column (A or B) is assigned per session. The `completion_time_seconds` column is only populated on `puzzle_completed` events. A single session can have multiple puzzle completions — treat each `puzzle_completed` event as a separate observation for the primary analysis, not one per session.

## Data Access

Supabase connection details are in `supabase.json` in this directory. Read it and query the API:

```python
import json, requests
with open("supabase.json") as f:
    cfg = json.load(f)
resp = requests.get(cfg["url"], headers=cfg["headers"])
data = resp.json()
```

Use `requests.get()` (or equivalent). Do not read environment variables.

## Required Outputs

Write these files into the current working directory:

1. **`analysis.ipynb`** — a Jupyter notebook with the full analysis
2. **`summary.json`** — a machine-readable summary (schema below)
3. **`chart-distribution.png`** — completion time distribution by variant
4. **`chart-treatment-effect.png`** — treatment effect confidence interval
5. **`chart-completion-rates.png`** — completion/repeat rate comparison

## Required Notebook Sections

1. **Setup & data pull** — imports, Supabase API query with provided URL and headers, DataFrames
2. **Metric definitions & sanity checks** — primary KPI, guardrails, SRM test, data quality
3. **Primary analysis** — Welch's t-test, CI, Cohen's d, interpretation
4. **Guardrail analysis** — completion rate χ² test, repeat rate z-test
5. **Visualizations** — the 3 charts listed above
6. **Conclusion & recommendation** — executive summary and `summary.json`

## Not Required

- OLS regression, CUPED variance reduction, power analysis
- Outlier detection detail, KDE, daily volume/trend charts
- Extended educational commentary

## summary.json Schema

```json
{
  "status": "significant | not_significant | inconclusive",
  "recommended_variant": "A | B | null",
  "decision": "string — optional human-readable recommendation",
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

## Scoring

Your output will be scored on:

- **Data access**: Did you query real Supabase data via the API (using credentials from `supabase.json`)?
- **Statistical correctness**: Correct SRM test, Welch's t-test, effect size, CI?
- **Guardrails**: Did you check completion rate and repeat rate, not just the primary metric?
- **Visualizations**: 3 clear, labeled, interpretable charts?
- **Decision quality**: Does `recommended_variant` match the data? If Variant B is worse on guardrails, recommended_variant should be "A", not "B".
- **Hallucination resistance**: All cited numbers come from queried data, not invented?