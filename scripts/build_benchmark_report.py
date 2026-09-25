#!/usr/bin/env python3
"""Compile native Inspect and Visual evidence into a standalone safe report."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from bench_analysis.report import build_report, discover_variants, parse_variant, render_quarto_report


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="Build a benchmark report from all available artifacts for selected variants."
    )
    result.add_argument("--repository-root", type=Path, default=Path.cwd())
    result.add_argument("--list-variants", action="store_true", help="List discovered provider/model variants as JSON")
    result.add_argument("--model", help="Human-readable model family/report title")
    result.add_argument(
        "--variant",
        action="append",
        default=[],
        help="Exact provider/model selector; repeat to compare variants",
    )
    result.add_argument("--output", type=Path, help="Output directory (default: reports/<model-slug>)")
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    repository_root = args.repository_root.resolve()
    if args.list_variants:
        print(json.dumps(discover_variants(repository_root), indent=2))
        return 0
    if not args.model:
        parser().error("--model is required unless --list-variants is used")
    if not args.variant:
        parser().error("at least one --variant is required")

    try:
        variants = [parse_variant(value) for value in args.variant]
        output = args.output
        if output is not None and not output.is_absolute():
            output = repository_root / output
        report = build_report(repository_root, args.model, variants, output)
        index = render_quarto_report(
            repository_root,
            Path(report["outputDirectory"]),
            args.model,
        )
        report["index"] = str(index)
    except (OSError, RuntimeError, ValueError) as error:
        print(f"Report failed: {error}", file=sys.stderr)
        return 1

    print(f"Report: {report['index']}")
    print(f"Inspect results: {len(report['inspectResults'])}")
    print(f"Visual results: {len(report['visualResults'])}")
    print(f"Paired comparisons: {len(report['pairwise'])}")
    print(f"Evidence gaps: {len(report['evidenceGaps'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
