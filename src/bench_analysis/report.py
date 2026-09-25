"""Build a publish-safe benchmark report from native Inspect and Visual artifacts.

The native `.eval` logs and Visual `metadata.json` files remain the sources of
truth. This module selects a deterministic cohort, derives summary data, and
copies only public-safe preview images into a standalone report directory.
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from itertools import combinations
from pathlib import Path
from statistics import median
from typing import Any, Iterable


@dataclass(frozen=True)
class Variant:
    provider: str
    model: str
    label: str

    @property
    def id(self) -> str:
        return f"{self.provider}/{self.model}"


@dataclass(frozen=True)
class VisualRun:
    variant_id: str
    benchmark_id: str
    benchmark_title: str
    prompt_hash: str
    run_id: str
    created_at: str
    status: str
    preview_path: Path | None
    video_path: Path | None
    measured_fps: float | None
    metadata_path: Path


def parse_variant(value: str) -> Variant:
    """Parse `<provider>/<model>` while allowing slashes inside the model id."""
    provider, separator, model = value.strip().partition("/")
    if not separator or not provider or not model:
        raise ValueError(f"Invalid variant {value!r}; expected <provider>/<model>")
    provider = provider.lower()
    return Variant(provider=provider, model=model, label=f"{provider} · {model}")


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "benchmark-report"


def _json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value:
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _safe_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _prompt_hash(prompt: str) -> str:
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:16]


def _eval_variant(row: Any) -> str | None:
    metadata = _json_object(row.get("metadata"))
    provider = metadata.get("pi_provider")
    model = metadata.get("pi_model")
    if isinstance(provider, str) and isinstance(model, str) and provider and model:
        return f"{provider.lower()}/{model}"

    inspect_model = row.get("model")
    if not isinstance(inspect_model, str) or "/" not in inspect_model:
        return None
    parts = inspect_model.split("/")
    if parts[0] == "openai-api" and len(parts) >= 3:
        return f"{parts[1].lower()}/{'/'.join(parts[2:])}"
    return f"{parts[0].lower()}/{'/'.join(parts[1:])}"


def _visual_provider(metadata: dict[str, Any]) -> str | None:
    runner = metadata.get("runner") or {}
    source = runner.get("modelSource")
    backend = runner.get("backendLabel")
    if source == "cloud" and isinstance(backend, str) and backend.lower() != "cloud":
        return backend.lower()
    if isinstance(source, str) and source:
        return source.lower()
    return None


def _asset_path(metadata_path: Path, value: Any) -> Path | None:
    if not isinstance(value, str) or not value:
        return None
    run_root = metadata_path.parent.resolve()
    candidate = (run_root / value).resolve()
    # Run metadata is not a trusted path source: previews must belong to this
    # run, even when a relative path or symlink points elsewhere.
    return candidate if candidate.is_relative_to(run_root) and candidate.is_file() and candidate.suffix.lower() == ".png" else None


def scan_visual_runs(repository_root: Path) -> list[VisualRun]:
    runs_root = repository_root / "runs"
    if not runs_root.is_dir():
        return []

    rows: list[VisualRun] = []
    for metadata_path in sorted(runs_root.glob("*/*/*/metadata.json")):
        try:
            metadata = json.loads(metadata_path.read_text("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            continue
        provider = _visual_provider(metadata)
        model = (metadata.get("model") or {}).get("id")
        benchmark = metadata.get("benchmark") or {}
        benchmark_id = benchmark.get("id")
        prompt = benchmark.get("prompt")
        if not all(isinstance(value, str) and value for value in (provider, model, benchmark_id, prompt)):
            continue
        assets = metadata.get("assets") or {}
        capture = metadata.get("capture") or {}
        video_capture = capture.get("video") or {}
        quality = video_capture.get("quality") or {}
        rows.append(VisualRun(
            variant_id=f"{provider}/{model}",
            benchmark_id=benchmark_id,
            benchmark_title=benchmark.get("title") or benchmark_id.replace("-", " ").title(),
            prompt_hash=_prompt_hash(prompt),
            run_id=str(metadata.get("runId") or metadata_path.parent.name),
            created_at=str(metadata.get("createdAt") or ""),
            status=str(metadata.get("status") or "unknown"),
            preview_path=_asset_path(metadata_path, assets.get("preview")),
            video_path=_asset_path(metadata_path, assets.get("videoMp4") or assets.get("video")),
            measured_fps=_safe_float(quality.get("measuredFps")),
            metadata_path=metadata_path,
        ))
    return rows


def load_evals(repository_root: Path):
    import pandas as pd
    from inspect_ai.analysis import evals_df

    log_dir = repository_root / "logs"
    if not log_dir.is_dir() or not any(log_dir.glob("*.eval")) and not any(log_dir.glob("*.json")):
        return pd.DataFrame()
    result = evals_df(str(log_dir), strict=False, quiet=True)
    dataframe, _errors = result if isinstance(result, tuple) else (result, [])
    if not dataframe.empty:
        dataframe = dataframe.copy()
        dataframe["_variant"] = dataframe.apply(_eval_variant, axis=1)
    return dataframe


def discover_variants(repository_root: Path) -> list[dict[str, Any]]:
    evals = load_evals(repository_root)
    visual = scan_visual_runs(repository_root)
    counts: dict[str, dict[str, Any]] = {}

    if not evals.empty:
        for variant_id, group in evals.dropna(subset=["_variant"]).groupby("_variant"):
            counts.setdefault(variant_id, {"id": variant_id, "inspectLogs": 0, "visualRuns": 0})
            counts[variant_id]["inspectLogs"] = len(group)
    for run in visual:
        counts.setdefault(run.variant_id, {"id": run.variant_id, "inspectLogs": 0, "visualRuns": 0})
        counts[run.variant_id]["visualRuns"] += 1

    return sorted(counts.values(), key=lambda item: (-item["inspectLogs"] - item["visualRuns"], item["id"].lower()))


def _task_catalog(repository_root: Path) -> dict[str, dict[str, Any]]:
    script = repository_root / "scripts" / "inspect_registry_discovery.py"
    if not script.is_file():
        return {}
    try:
        completed = subprocess.run(
            [sys.executable, str(script)],
            cwd=repository_root,
            check=True,
            capture_output=True,
            text=True,
            timeout=120,
        )
        tasks = json.loads(completed.stdout)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return {}

    catalog: dict[str, dict[str, Any]] = {}
    for task in tasks:
        name = task.get("name")
        if not isinstance(name, str):
            continue
        short_name = name.split("/", 1)[-1]
        catalog[short_name] = {
            "category": task.get("group") or "Other",
            "title": task.get("title") or short_name.replace("_", " ").replace("-", " ").title(),
            "description": (task.get("description") or "").strip(),
            "packageVersion": task.get("packageVersion"),
        }
    return catalog


def _selected_evals(evals, variant_ids: set[str]):
    import pandas as pd

    if evals.empty:
        return evals, {}
    relevant = evals[evals["_variant"].isin(variant_ids)].copy()
    if relevant.empty:
        return relevant, {}
    relevant["_completed"] = pd.to_numeric(relevant.get("completed_samples"), errors="coerce").fillna(-1)
    relevant["_created_sort"] = relevant.get("created").astype(str)
    successful = relevant[relevant["status"].astype(str).str.lower() == "success"].copy()
    successful = successful.sort_values(
        ["_variant", "task_name", "_completed", "_created_sort"],
        ascending=[True, True, False, False],
    )
    selected = successful.drop_duplicates(["_variant", "task_name"], keep="first")

    coverage: dict[tuple[str, str], dict[str, int | str]] = {}
    for (variant_id, task), group in relevant.groupby(["_variant", "task_name"]):
        success_count = int((group["status"].astype(str).str.lower() == "success").sum())
        coverage[(variant_id, task)] = {
            "available": len(group),
            "successful": success_count,
            "status": "success" if success_count else "error",
        }
    return selected, coverage


def select_visual_runs(
    runs: Iterable[VisualRun], variant_ids: set[str]
) -> tuple[list[VisualRun], dict[tuple[str, str], str]]:
    """Select the prompt revision with the most usable previews per benchmark.

    Ties prefer broader recorded coverage, more completed runs, then recency.
    Within the selected revision, each variant contributes its latest completed
    run with a preview. This rule is deterministic and does not inspect quality.
    """
    relevant = [run for run in runs if run.variant_id in variant_ids]
    selected: list[VisualRun] = []
    coverage: dict[tuple[str, str], str] = {}

    for benchmark_id in sorted({run.benchmark_id for run in relevant}):
        benchmark_runs = [run for run in relevant if run.benchmark_id == benchmark_id]
        prompt_groups: dict[str, list[VisualRun]] = {}
        for run in benchmark_runs:
            prompt_groups.setdefault(run.prompt_hash, []).append(run)
        chosen_hash, chosen_runs = max(
            prompt_groups.items(),
            key=lambda item: (
                len({run.variant_id for run in item[1] if run.status == "completed" and run.preview_path is not None}),
                len({run.variant_id for run in item[1]}),
                sum(run.status == "completed" for run in item[1]),
                max((run.created_at for run in item[1]), default=""),
                item[0],
            ),
        )
        for variant_id in variant_ids:
            candidates = [
                run for run in chosen_runs
                if run.variant_id == variant_id and run.status == "completed" and run.preview_path is not None
            ]
            if candidates:
                choice = max(candidates, key=lambda run: (run.created_at, run.run_id))
                selected.append(choice)
                coverage[(variant_id, benchmark_id)] = "success"
            elif any(run.variant_id == variant_id for run in chosen_runs):
                coverage[(variant_id, benchmark_id)] = "no-preview"
            elif any(run.variant_id == variant_id for run in benchmark_runs):
                coverage[(variant_id, benchmark_id)] = "prompt-mismatch"
            else:
                coverage[(variant_id, benchmark_id)] = "missing"
    return selected, coverage


def _load_selected_samples(selected):
    import pandas as pd
    from inspect_ai.analysis import samples_df

    if selected.empty:
        return pd.DataFrame()
    paths = [str(value) for value in selected["log"].tolist()]
    result = samples_df(paths, strict=False, quiet=True)
    dataframe, _errors = result if isinstance(result, tuple) else (result, [])
    return dataframe


def _sample_scores(selected, samples) -> dict[tuple[str, str], dict[tuple[str, int], float]]:
    from inspect_ai.scorer import value_to_float

    convert = value_to_float()
    by_eval = {row["eval_id"]: row for _, row in selected.iterrows()}
    scores: dict[tuple[str, str], dict[tuple[str, int], float]] = {}
    if samples.empty:
        return scores
    for _, sample in samples.iterrows():
        eval_row = by_eval.get(sample.get("eval_id"))
        if eval_row is None:
            continue
        scorer = eval_row.get("score_headline_name")
        column = f"score_{scorer}" if isinstance(scorer, str) and scorer else None
        value = sample.get(column) if column else None
        if value is None or value != value:
            continue
        # Compound scorer payloads have no single scalar to compare. Asking
        # Inspect to convert them emits warnings with raw score payloads.
        if isinstance(value, (dict, list)) or isinstance(value, str) and value.lstrip().startswith(("{", "[")):
            continue
        try:
            numeric = float(convert(value))
        except (TypeError, ValueError):
            continue
        key = (str(sample.get("id")), int(sample.get("epoch") or 1))
        scores.setdefault((eval_row["_variant"], eval_row["task_name"]), {})[key] = numeric
    return scores


def _pairwise(selected, samples, variants: list[Variant]) -> list[dict[str, Any]]:
    score_maps = _sample_scores(selected, samples)
    rows: list[dict[str, Any]] = []
    tasks = sorted(set(selected.get("task_name", [])))
    for task in tasks:
        for left, right in combinations(variants, 2):
            left_scores = score_maps.get((left.id, task), {})
            right_scores = score_maps.get((right.id, task), {})
            shared = sorted(set(left_scores) & set(right_scores))
            if not shared:
                continue
            left_only = sum(left_scores[key] > right_scores[key] for key in shared)
            right_only = sum(right_scores[key] > left_scores[key] for key in shared)
            ties = len(shared) - left_only - right_only
            rows.append({
                "task": task,
                "left": left.id,
                "right": right.id,
                "sharedSamples": len(shared),
                "leftHigher": left_only,
                "rightHigher": right_only,
                "ties": ties,
                "meanDelta": sum(left_scores[key] - right_scores[key] for key in shared) / len(shared),
            })
    return rows


def _inspect_results(selected, samples, catalog: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    sample_groups = {}
    if not samples.empty:
        for eval_id, group in samples.groupby("eval_id"):
            sample_groups[eval_id] = group

    rows: list[dict[str, Any]] = []
    for _, row in selected.iterrows():
        task = row["task_name"]
        task_info = catalog.get(task, {})
        score = _safe_float(row.get("score_headline_value"))
        stderr = _safe_float(row.get("score_headline_stderr"))
        sample_group = sample_groups.get(row.get("eval_id"))
        times: list[float] = []
        tokens: list[float] = []
        if sample_group is not None:
            times = [value for value in (_safe_float(item) for item in sample_group.get("total_time", [])) if value is not None]
            tokens = [value for value in (_safe_float(item) for item in sample_group.get("total_tokens", [])) if value is not None]
        log_path = Path(str(row["log"]))
        lower = upper = None
        if score is not None and stderr is not None:
            lower, upper = score - 1.96 * stderr, score + 1.96 * stderr
            if 0 <= score <= 1:
                lower, upper = max(0.0, lower), min(1.0, upper)
        rows.append({
            "variant": row["_variant"],
            "task": task,
            "taskTitle": task_info.get("title") or task.replace("_", " ").replace("-", " ").title(),
            "category": task_info.get("category") or "Other",
            "taskVersion": row.get("task_version"),
            "packageVersion": task_info.get("packageVersion"),
            "status": row.get("status"),
            "completedSamples": int(row.get("completed_samples") or 0),
            "totalSamples": int(row.get("total_samples") or 0),
            "scoreName": row.get("score_headline_name"),
            "scoreMetric": row.get("score_headline_metric"),
            "score": score,
            "stderr": stderr,
            "ci95": [lower, upper] if lower is not None and upper is not None else None,
            "medianSecondsPerSample": median(times) if times else None,
            "medianTokensPerSample": median(tokens) if tokens else None,
            "evidenceId": log_path.stem,
            "evidenceSha256": _file_hash(log_path) if log_path.is_file() else None,
        })
    return sorted(rows, key=lambda item: (item["category"], item["task"], item["variant"]))


def _copy_visual_assets(selected: list[VisualRun], output_dir: Path) -> list[dict[str, Any]]:
    from PIL import Image

    rows: list[dict[str, Any]] = []
    for run in selected:
        # Slugs alone collide (a.b and a-b, for example). Hash the original
        # IDs so two configurations cannot overwrite one another's evidence.
        variant_key = f"{slugify(run.variant_id)}-{_prompt_hash(run.variant_id)}"
        benchmark_key = f"{slugify(run.benchmark_id)}-{_prompt_hash(run.benchmark_id)}"
        destination = Path("assets") / "visual" / variant_key / f"{benchmark_key}.png"
        absolute_destination = output_dir / destination
        absolute_destination.parent.mkdir(parents=True, exist_ok=True)
        if run.preview_path:
            # Re-encode the pixels rather than publishing uninspected PNG
            # metadata chunks (which could carry private run material).
            with Image.open(run.preview_path) as image:
                if image.format != "PNG":
                    raise ValueError(f"Invalid PNG preview for {run.variant_id}/{run.benchmark_id}")
                image.load()
                image.save(absolute_destination, format="PNG")
        rows.append({
            "variant": run.variant_id,
            "benchmark": run.benchmark_id,
            "benchmarkTitle": run.benchmark_title,
            "promptHash": run.prompt_hash,
            "runId": run.run_id,
            "createdAt": run.created_at,
            "measuredFps": run.measured_fps,
            "preview": destination.as_posix(),
        })
    return sorted(rows, key=lambda item: (item["benchmark"], item["variant"]))


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", "utf-8")
        return
    fieldnames = list(rows[0])
    with path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: json.dumps(value) if isinstance(value, (list, dict)) else value for key, value in row.items()})


def audit_report_output(output_dir: Path, repository_root: Path) -> None:
    """Fail if a generated report contains private operational material."""
    forbidden = {
        str(repository_root): "local repository path",
        str(repository_root.resolve()): "local repository path",
        "file://": "local file URL",
        "Authorization: Bearer": "authorization header",
        '"launchCommand"': "launch command",
        '"rawResponse"': "raw response metadata",
        "response.raw.txt": "raw response asset",
        "supabase.json": "private data access file",
    }
    loopback = re.compile(r"https?://(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?", re.IGNORECASE)
    for path in output_dir.rglob("*"):
        if path.suffix.lower() not in {".html", ".json", ".csv"} or not path.is_file():
            continue
        content = path.read_text("utf-8")
        for value, label in forbidden.items():
            if value in content:
                raise ValueError(f"Report privacy audit failed: {label} in {path.name}")
        if loopback.search(content):
            raise ValueError(f"Report privacy audit failed: loopback URL in {path.name}")


def render_quarto_report(
    repository_root: Path,
    output_dir: Path,
    title: str,
) -> Path:
    """Execute the tracked Quarto template against compiled report data."""
    template = repository_root / "analysis" / "benchmark-report.qmd"
    report_data = output_dir / "report.json"
    if not template.is_file():
        raise ValueError(f"Missing Quarto report template: {template}")

    command = [
        "quarto", "render", str(template),
        "--execute",
        "--execute-dir", str(repository_root),
        "--output-dir", os.path.relpath(output_dir, template.parent),
        "--execute-param", f"report_data:{json.dumps(str(report_data))}",
        "--metadata", f"title:{title}",
    ]
    try:
        completed = subprocess.run(
            command,
            cwd=repository_root,
            check=False,
            capture_output=True,
            text=True,
            timeout=300,
        )
    except FileNotFoundError as error:
        raise ValueError("Quarto is unavailable. Run the report through `bench report` or install the report dependency group.") from error
    except subprocess.TimeoutExpired as error:
        raise ValueError("Quarto report rendering exceeded five minutes") from error
    generated_paths = [
        template.parent / ".quarto",
        template.parent / "benchmark-report_files",
    ]
    if completed.returncode != 0:
        for path in generated_paths:
            shutil.rmtree(path, ignore_errors=True)
        detail = (completed.stderr or completed.stdout).strip()
        raise ValueError(f"Quarto report rendering failed:\n{detail}")

    # Inspect Viz stores immutable Arrow data beside the Quarto site rather than
    # embedding it in the HTML widget state. Keep that public-safe sidecar with
    # the report, then remove Quarto's project-local build artifacts.
    site_root = template.parent / "_site"
    site_data = site_root / "site_data"
    if site_data.is_dir():
        shutil.copytree(site_data, output_dir / "site_data", dirs_exist_ok=True)
    shutil.rmtree(site_root, ignore_errors=True)
    for path in generated_paths:
        shutil.rmtree(path, ignore_errors=True)

    rendered = output_dir / "benchmark-report.html"
    if not rendered.is_file():
        raise ValueError("Quarto completed without writing benchmark-report.html")
    index = output_dir / "index.html"
    rendered.replace(index)
    document = index.read_text("utf-8")
    if "site_data/" not in document:
        shutil.rmtree(output_dir / "site_data", ignore_errors=True)
    audit_report_output(output_dir, repository_root)
    return index


def _check_existing_output(output_dir: Path) -> None:
    """Overwrite only a prior report, never an arbitrary directory."""
    if not output_dir.exists():
        return
    marker = output_dir / "report.json"
    try:
        previous = json.loads(marker.read_text("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"Refusing to replace a directory without a valid report.json: {output_dir}") from error
    invalid = ValueError(f"Refusing to replace a directory that is not exclusively a Bench report: {output_dir}")
    if (not isinstance(previous, dict) or previous.get("schemaVersion") != 1
            or not isinstance(previous.get("variants"), list)
            or not isinstance(previous.get("selectionRules"), dict)
            or not isinstance(previous.get("visualResults"), list)):
        raise invalid
    expected_files = {"report.json", "index.html", "inspect-results.csv", "paired-results.csv", "evidence-gaps.csv"}
    for row in previous["visualResults"]:
        if not isinstance(row, dict) or not isinstance(row.get("preview"), str):
            raise invalid
        preview = Path(row["preview"])
        if not preview.parts[:2] == ("assets", "visual") or ".." in preview.parts or preview.suffix != ".png":
            raise invalid
        expected_files.add(preview.as_posix())
    for path in output_dir.rglob("*"):
        relative = path.relative_to(output_dir).as_posix()
        if path.is_symlink() or path.is_file() and relative not in expected_files:
            raise invalid
        if path.is_dir() and relative not in {"assets", "assets/visual"} and not any(
            expected.startswith(relative + "/") for expected in expected_files
        ):
            raise invalid


def build_report(
    repository_root: Path,
    title: str,
    variants: list[Variant],
    output_dir: Path | None = None,
) -> dict[str, Any]:
    repository_root = repository_root.resolve()
    if len(variants) < 1:
        raise ValueError("At least one variant is required")
    if len({variant.id for variant in variants}) != len(variants):
        raise ValueError("Variants must be unique")

    output_dir = (output_dir or repository_root / "reports" / slugify(title)).resolve()
    if repository_root.is_relative_to(output_dir):
        raise ValueError("Refusing to use the repository root or an ancestor as report output")
    _check_existing_output(output_dir)
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True)

    variant_ids = {variant.id for variant in variants}
    evals = load_evals(repository_root)
    selected_evals, inspect_coverage = _selected_evals(evals, variant_ids)
    samples = _load_selected_samples(selected_evals)
    catalog = _task_catalog(repository_root)
    inspect_results = _inspect_results(selected_evals, samples, catalog)
    pairwise = _pairwise(selected_evals, samples, variants)

    visual_runs = scan_visual_runs(repository_root)
    selected_visual, visual_coverage = select_visual_runs(visual_runs, variant_ids)
    visual_results = _copy_visual_assets(selected_visual, output_dir)

    inspect_tasks = sorted({task for variant, task in inspect_coverage if variant in variant_ids})
    visual_benchmarks = sorted({run.benchmark_id for run in visual_runs if run.variant_id in variant_ids})
    inspect_status = {
        f"{variant}::{task}": str(value["status"])
        for (variant, task), value in inspect_coverage.items()
    }
    visual_status = {
        f"{variant}::{benchmark}": status
        for (variant, benchmark), status in visual_coverage.items()
    }
    evidence_gaps = [
        {"suite": "inspect", "variant": variant.id, "benchmark": task, "reason": inspect_status.get(f"{variant.id}::{task}", "missing")}
        for variant in variants
        for task in inspect_tasks
        if inspect_status.get(f"{variant.id}::{task}") != "success"
    ] + [
        {"suite": "visual", "variant": variant.id, "benchmark": benchmark, "reason": visual_status.get(f"{variant.id}::{benchmark}", "missing")}
        for variant in variants
        for benchmark in visual_benchmarks
        if visual_status.get(f"{variant.id}::{benchmark}") != "success"
    ]
    report = {
        "schemaVersion": 1,
        "title": title,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "variants": [{"id": variant.id, "label": variant.label} for variant in variants],
        "selectionRules": {
            "inspect": "Most completed successful run per variant/task; newest breaks ties.",
            "visual": "Prompt revision with greatest usable selected-variant coverage; newest completed preview per variant.",
        },
        "coverage": {
            "inspectTasks": inspect_tasks,
            "visualBenchmarks": visual_benchmarks,
            "inspect": inspect_status,
            "visual": visual_status,
        },
        "evidenceGaps": evidence_gaps,
        "inspectResults": inspect_results,
        "visualResults": visual_results,
        "pairwise": pairwise,
        "privacy": {
            "included": ["derived aggregate scores", "evidence hashes", "visual preview images", "safe run identifiers"],
            "excluded": ["raw eval logs", "sample inputs", "sample outputs", "prompts", "generated HTML", "commands", "local paths", "local URLs", "credentials"],
        },
    }

    (output_dir / "report.json").write_text(json.dumps(report, indent=2, default=str) + "\n", "utf-8")
    _write_csv(output_dir / "inspect-results.csv", inspect_results)
    _write_csv(output_dir / "paired-results.csv", pairwise)
    _write_csv(output_dir / "evidence-gaps.csv", evidence_gaps)
    audit_report_output(output_dir, repository_root)
    return {**report, "outputDirectory": str(output_dir), "reportData": str(output_dir / "report.json")}
