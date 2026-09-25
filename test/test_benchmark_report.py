import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image, PngImagePlugin

from bench_analysis.report import (
    VisualRun, _copy_visual_assets, audit_report_output, build_report,
    parse_variant, scan_visual_runs, select_visual_runs,
)


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

    def test_output_does_not_delete_other_directories_or_ancestors(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repository"
            root.mkdir()
            output = Path(directory) / "existing"
            output.mkdir()
            sentinel = output / "important.txt"
            sentinel.write_text("preserve me")
            variant = parse_variant("example/model")
            with self.assertRaisesRegex(ValueError, "Refusing to replace"):
                build_report(root, "Test", [variant], output)
            self.assertEqual(sentinel.read_text(), "preserve me")
            with self.assertRaisesRegex(ValueError, "ancestor"):
                build_report(root, "Test", [variant], root.parent)
            self.assertTrue(sentinel.exists())

            safe = root / "reports" / "test"
            build_report(root, "Test", [variant], safe)
            build_report(root, "Test", [variant], safe)  # Regenerating a Bench report is allowed.
            (safe / "user-file.txt").write_text("preserve me")
            with self.assertRaisesRegex(ValueError, "exclusively a Bench report"):
                build_report(root, "Test", [variant], safe)
            self.assertEqual((safe / "user-file.txt").read_text(), "preserve me")
            (safe / "user-file.txt").unlink()
            nested = safe / "assets" / "visual" / "notes.txt"
            nested.parent.mkdir(parents=True)
            nested.write_text("preserve me")
            with self.assertRaisesRegex(ValueError, "exclusively a Bench report"):
                build_report(root, "Test", [variant], safe)
            self.assertEqual(nested.read_text(), "preserve me")

    def test_visual_preview_cannot_escape_its_run(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            private = root / "private.png"
            Image.new("RGB", (1, 1), "red").save(private)
            run = root / "runs" / "scene" / "model" / "run"
            run.mkdir(parents=True)
            metadata = {
                "runner": {"modelSource": "ollama"},
                "model": {"id": "a.b"},
                "benchmark": {"id": "scene", "prompt": "Prompt"},
                "runId": "run", "status": "completed",
                "assets": {"preview": "../../../../private.png"},
            }
            (run / "metadata.json").write_text(json.dumps(metadata))
            self.assertIsNone(scan_visual_runs(root)[0].preview_path)
            (run / "preview.png").symlink_to(private)
            metadata["assets"]["preview"] = "preview.png"
            (run / "metadata.json").write_text(json.dumps(metadata))
            self.assertIsNone(scan_visual_runs(root)[0].preview_path)

    def test_visual_assets_are_distinct_and_strip_embedded_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            red = root / "red.png"
            blue = root / "blue.png"
            metadata = PngImagePlugin.PngInfo()
            metadata.add_text("secret", "FAKE-PRIVATE-PAYLOAD")
            Image.new("RGB", (1, 1), "red").save(red, pnginfo=metadata)
            Image.new("RGB", (1, 1), "blue").save(blue)
            runs = [
                VisualRun("ollama/a.b", "scene", "Scene", "p", "a", "1", "completed", red, None, None, root),
                VisualRun("ollama/a-b", "scene", "Scene", "p", "b", "1", "completed", blue, None, None, root),
            ]
            rows = _copy_visual_assets(runs, root / "output")
            self.assertNotEqual(rows[0]["preview"], rows[1]["preview"])
            expected = {"ollama/a.b": (255, 0, 0), "ollama/a-b": (0, 0, 255)}
            for row in rows:
                asset = root / "output" / row["preview"]
                self.assertNotIn(b"FAKE-PRIVATE-PAYLOAD", asset.read_bytes())
                with Image.open(asset) as image:
                    self.assertEqual(image.getpixel((0, 0)), expected[row["variant"]])

    def test_prompt_selection_prioritizes_usable_evidence(self):
        preview = Path("preview.png")
        def run(variant, prompt, status, asset):
            return VisualRun(variant, "scene", "Scene", prompt, "run", "2026-01-01", status,
                             preview if asset else None, None, None, Path("metadata.json"))
        selected, coverage = select_visual_runs([
            run("a/model", "valid", "completed", True),
            run("b/model", "valid", "completed", True),
            run("a/model", "invalid", "failed", False),
            run("b/model", "invalid", "failed", False),
            run("c/model", "invalid", "failed", False),
        ], {"a/model", "b/model", "c/model"})
        self.assertEqual(len(selected), 2)
        self.assertEqual(coverage[("c/model", "scene")], "prompt-mismatch")

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
