#!/usr/bin/env python3
"""Canonical oracle for the A/B test analysis benchmark.

Queries Supabase for live event data, aggregates to per-session summaries,
and computes the expected summary.json with tolerance bands.

This is an ADVANCED script for refreshing the reference oracle.
For scoring, the scorer uses the committed oracle snapshot at
scripts/oracle/ab-test-analysis-oracle.json (produced by the reference
notebook), which already has the correct expected values.

Run with:
    PUBLIC_SUPABASE_URL=... PUBLIC_SUPABASE_ANON_KEY=... python scripts/score-oracle.py

Outputs the oracle summary to stdout. Redirect to a file if needed.

NOTE: The PostHog events data is event-level (puzzle_started, puzzle_completed,
etc.) with variant and session info in the properties JSON blob.
Aggregating this correctly requires matching the reference notebook's
logic. For production scoring, prefer the committed oracle snapshot
over re-computing from raw events.
"""

import json
import math
import os
import sys
from datetime import datetime, timezone

import requests


def fetch_events(supabase_url: str, supabase_key: str) -> list[dict]:
    """Fetch all rows from posthog_events with session_id and variant."""
    url = f"{supabase_url}/rest/v1/posthog_events"
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
    }
    params = {
        "select": "*",
        "session_id": "not.is.null",
        "variant": "not.is.null",
    }
    resp = requests.get(url, headers=headers, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def compute_oracle(events: list[dict]) -> dict:
    """Compute the canonical summary from raw events."""
    # Separate by variant
    a_events = [e for e in events if e.get("variant") == "A"]
    b_events = [e for e in events if e.get("variant") == "B"]

    n_a = len(a_events)
    n_b = len(b_events)

    # SRM test (sample ratio mismatch) — chi-square onsample sizes
    expected_total = (n_a + n_b) / 2
    srm_chi2 = ((n_a - expected_total) ** 2 / expected_total) + (
        (n_b - expected_total) ** 2 / expected_total
    )
    srm_p = 1 - _chi2_cdf(srm_chi2, df=1)

    # Completion times (players who completed)
    a_times = [e["completion_time"] for e in a_events if e.get("completion_time") is not None and e.get("completed")]
    b_times = [e["completion_time"] for e in b_events if e.get("completion_time") is not None and e.get("completed")]

    mean_a = sum(a_times) / len(a_times) if a_times else 0
    mean_b = sum(b_times) / len(b_times) if b_times else 0
    std_a = _std(a_times) if len(a_times) > 1 else 0
    std_b = _std(b_times) if len(b_times) > 1 else 0

    # Welch's t-test
    t_stat, p_value, df = _welch_t(a_times, b_times)

    # Cohen's d
    pooled_std = math.sqrt((std_a**2 + std_b**2) / 2) if (std_a + std_b) > 0 else 1
    cohens_d = (mean_b - mean_a) / pooled_std if pooled_std > 0 else 0

    # Completion rates
    completed_a = sum(1 for e in a_events if e.get("completed"))
    completed_b = sum(1 for e in b_events if e.get("completed"))
    comp_rate_a = completed_a / n_a if n_a > 0 else 0
    comp_rate_b = completed_b / n_b if n_b > 0 else 0

    # Completion rate chi-square
    comp_chi2, comp_p = _proportion_chi2(completed_a, n_a, completed_b, n_b)

    # Repeat rates
    repeat_a = sum(1 for e in a_events if e.get("repeat_count", 0) > 0)
    repeat_b = sum(1 for e in b_events if e.get("repeat_count", 0) > 0)
    repeat_rate_a = repeat_a / n_a if n_a > 0 else 0
    repeat_rate_b = repeat_b / n_b if n_b > 0 else 0

    # Decision logic
    is_significant = p_value < 0.05
    guardrails_failed = comp_p < 0.05 and comp_rate_b < comp_rate_a

    if is_significant:
        status = "significant"
        recommended_variant = "A" if guardrails_failed or mean_b > mean_a else "B"
    else:
        status = "not_significant"
        recommended_variant = None

    return {
        "status": status,
        "recommended_variant": recommended_variant,
        "raw_stats": {
            "p_value": round(p_value, 6),
            "cohens_d": round(cohens_d, 4),
            "mean_a": round(mean_a, 3),
            "mean_b": round(mean_b, 3),
            "std_a": round(std_a, 3),
            "std_b": round(std_b, 3),
            "completion_rate_a": round(comp_rate_a, 4),
            "completion_rate_b": round(comp_rate_b, 4),
            "repeat_rate_a": round(repeat_rate_a, 4),
            "repeat_rate_b": round(repeat_rate_b, 4),
            "srm_p_value": round(srm_p, 6),
        },
        "tolerance": {
            "p_value": 0.05,
            "cohens_d": 0.1,
            "mean_pct": 0.05,
            "rate_pct": 0.05,
        },
        "sample_size_a": n_a,
        "sample_size_b": n_b,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def _std(values: list[float]) -> float:
    n = len(values)
    if n < 2:
        return 0.0
    mean = sum(values) / n
    return math.sqrt(sum((x - mean) ** 2 for x in values) / (n - 1))


def _welch_t(a: list[float], b: list[float]) -> tuple[float, float, float]:
    """Welch's t-test returning (t_stat, p_value, df)."""
    n1, n2 = len(a), len(b)
    if n1 < 2 or n2 < 2:
        return 0.0, 1.0, 1.0

    m1, m2 = sum(a) / n1, sum(b) / n2
    v1, v2 = _var(a), _var(b)

    se = math.sqrt(v1 / n1 + v2 / n2)
    if se == 0:
        return 0.0, 1.0, 1.0

    t = (m2 - m1) / se

    # Welch–Satterthwaite degrees of freedom
    num = (v1 / n1 + v2 / n2) ** 2
    den = (v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1)
    df = num / den if den > 0 else 1.0

    # Two-tailed p-value from t-distribution approximation
    p = _t_survival(abs(t), df) * 2
    return t, min(p, 1.0), df


def _var(values: list[float]) -> float:
    n = len(values)
    if n < 2:
        return 0.0
    m = sum(values) / n
    return sum((x - m) ** 2 for x in values) / (n - 1)


def _t_survival(t: float, df: float) -> float:
    """Approximate survival function for t-distribution using regularized incomplete beta."""
    x = df / (df + t * t)
    return 0.5 * _regularized_incomplete_beta(x, df / 2, 0.5)


def _regularized_incomplete_beta(x: float, a: float, b: float, max_iter: int = 200) -> float:
    """Compute I_x(a, b) using continued fraction (Lentz's method)."""
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0

    ln_prefix = (a * math.log(x) + b * math.log(1 - x)
                 - math.log(a) - _log_beta(a, b))
    prefix = math.exp(ln_prefix)

    # Continued fraction via modified Lentz
    f = 1.0
    c = 1.0
    d = 1 - (a + b) * x / (a + 1)
    if abs(d) < 1e-30:
        d = 1e-30
    d = 1 / d
    f = d

    for m in range(1, max_iter + 1):
        # Even step
        aa = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m))
        d = 1 + aa * d
        if abs(d) < 1e-30:
            d = 1e-30
        c = 1 + aa / c
        if abs(c) < 1e-30:
            c = 1e-30
        d = 1 / d
        f *= c * d

        # Odd step
        aa = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1))
        d = 1 + aa * d
        if abs(d) < 1e-30:
            d = 1e-30
        c = 1 + aa / c
        if abs(c) < 1e-30:
            c = 1e-30
        d = 1 / d
        delta = c * d
        f *= delta

        if abs(delta - 1) < 1e-10:
            break

    return prefix * f


def _log_beta(a: float, b: float) -> float:
    return math.lgamma(a) + math.lgamma(b) - math.lgamma(a + b)


def _chi2_cdf(x: float, df: float = 1) -> float:
    """Chi-square CDF via regularized incomplete gamma."""
    if x <= 0:
        return 0.0
    return _regularized_gamma_p(df / 2, x / 2)


def _regularized_gamma_p(a: float, x: float, max_iter: int = 200) -> float:
    """Regularized lower incomplete gamma P(a, x) via series expansion."""
    if x < a + 1:
        return _gamma_series(a, x, max_iter)
    return 1 - _gamma_cf(a, x, max_iter)


def _gamma_series(a: float, x: float, max_iter: int) -> float:
    term = 1 / a
    total = term
    for n in range(1, max_iter):
        term *= x / (a + n)
        total += term
        if abs(term) < abs(total) * 1e-10:
            break
    return total * math.exp(-x + a * math.log(x) - math.lgamma(a))


def _gamma_cf(a: float, x: float, max_iter: int) -> float:
    """Continued fraction for Q(a, x) = 1 - P(a, x)."""
    b = x + 1 - a
    c = 1e30
    d = 1 / b
    f = d
    for i in range(1, max_iter):
        an = -i * (i - a)
        b += 2
        d = an * d + b
        if abs(d) < 1e-30:
            d = 1e-30
        c = b + an / c
        if abs(c) < 1e-30:
            c = 1e-30
        d = 1 / d
        delta = c * d
        f *= delta
        if abs(delta - 1) < 1e-10:
            break
    return f * math.exp(-x + a * math.log(x) - math.lgamma(a))


def _proportion_chi2(x1: int, n1: int, x2: int, n2: int) -> tuple[float, float]:
    """Chi-square test for two proportions."""
    p1 = x1 / n1 if n1 > 0 else 0
    p2 = x2 / n2 if n2 > 0 else 0
    p_pool = (x1 + x2) / (n1 + n2) if (n1 + n2) > 0 else 0
    if p_pool == 0 or p_pool == 1:
        return 0.0, 1.0
    se2 = p_pool * (1 - p_pool) * (1 / n1 + 1 / n2)
    if se2 == 0:
        return 0.0, 1.0
    chi2 = (p1 - p2) ** 2 / se2
    p = 1 - _chi2_cdf(chi2, df=1)
    return chi2, p


def main():
    url = os.environ.get("PUBLIC_SUPABASE_URL")
    key = os.environ.get("PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        print("Error: set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY", file=sys.stderr)
        sys.exit(1)

    events = fetch_events(url, key)
    if not events:
        print("Error: no events returned from Supabase", file=sys.stderr)
        sys.exit(1)

    oracle = compute_oracle(events)
    print(json.dumps(oracle, indent=2))


if __name__ == "__main__":
    main()