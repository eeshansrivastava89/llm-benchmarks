import tempfile
import unittest
from pathlib import Path

from bench_analysis.report import VisualRun, audit_report_output, parse_variant, select_visual_runs


class BenchmarkReportTest(unittest.TestCase):
    def test_variant_splits_only_the_provider_prefix(self):
        variant = parse_variant("openrouter/meta-llama/model")
        self.assertEqual(variant.provider, "openrouter")
        self.assertEqual(variant.model, "meta-llama/model")
        self.assertEqual(variant.id, "openrouter/meta-llama/model")

    def test_visual_selection_prefers_prompt_coverage_then_latest_run(self):
        with tempfile.TemporaryDirectory() as directory:
            preview = Path(directory) / "preview.png"
            preview.write_bytes(b"image")

            def run(variant, prompt, run_id, created):
                return VisualRun(
                    variant_id=variant,
                    benchmark_id="solar-system",
                    benchmark_title="Solar System",
                    prompt_hash=prompt,
                    run_id=run_id,
                    created_at=created,
                    status="completed",
                    preview_path=preview,
                    video_path=None,
                    measured_fps=60,
                    metadata_path=Path(directory) / run_id / "metadata.json",
                )

            selected, coverage = select_visual_runs([
                run("ollama/model", "old", "old-a", "2026-01-01"),
                run("ollama/model", "shared", "shared-a-old", "2026-01-02"),
                run("ollama/model", "shared", "shared-a-new", "2026-01-04"),
                run("omlx/model", "shared", "shared-b", "2026-01-03"),
            ], {"ollama/model", "omlx/model"})

            self.assertEqual({item.prompt_hash for item in selected}, {"shared"})
            self.assertEqual(
                next(item.run_id for item in selected if item.variant_id == "ollama/model"),
                "shared-a-new",
            )
            self.assertEqual(coverage[("ollama/model", "solar-system")], "success")
            self.assertEqual(coverage[("omlx/model", "solar-system")], "success")

    def test_visual_selection_reports_prompt_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            preview = Path(directory) / "preview.png"
            preview.write_bytes(b"image")
            runs = [
                VisualRun("ollama/model", "scene", "Scene", "a", "a", "2026-01-02", "completed", preview, None, None, Path("a")),
                VisualRun("omlx/model", "scene", "Scene", "b", "b", "2026-01-01", "completed", preview, None, None, Path("b")),
            ]
            selected, coverage = select_visual_runs(runs, {"ollama/model", "omlx/model"})
            self.assertEqual(len(selected), 1)
            mismatches = [status for status in coverage.values() if status == "prompt-mismatch"]
            self.assertEqual(len(mismatches), 1)

    def test_privacy_audit_rejects_local_paths_and_loopback_urls(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repository"
            output = Path(directory) / "report"
            root.mkdir()
            output.mkdir()
            report = output / "report.json"
            report.write_text('{"safe": true}', "utf-8")
            audit_report_output(output, root)

            report.write_text(f'{{"path": "{root}/logs/run.eval"}}', "utf-8")
            with self.assertRaisesRegex(ValueError, "local repository path"):
                audit_report_output(output, root)

            report.write_text('{"url": "http://127.0.0.1:7575"}', "utf-8")
            with self.assertRaisesRegex(ValueError, "loopback URL"):
                audit_report_output(output, root)


if __name__ == "__main__":
    unittest.main()
