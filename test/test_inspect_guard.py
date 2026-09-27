import unittest
from types import SimpleNamespace
from unittest.mock import patch

from scripts import inspect_guard


class InspectGuardTest(unittest.TestCase):
    def test_outcome_requires_a_matching_successful_native_log(self):
        def log(run_id, status):
            return SimpleNamespace(eval=SimpleNamespace(metadata={"bench_run_id": run_id}), status=status)

        with patch.object(inspect_guard, "read_eval_log", side_effect=[log("other", "success"), log("ours", "error")]) as read:
            with self.assertRaisesRegex(ValueError, "Inspect log status: error"):
                inspect_guard.outcome("ours", ["unrelated.eval", "failed.eval"])
            self.assertTrue(all(call.kwargs["header_only"] for call in read.call_args_list))
        with patch.object(inspect_guard, "read_eval_log", return_value=log("other", "success")):
            with self.assertRaisesRegex(ValueError, "did not create a log"):
                inspect_guard.outcome("ours", ["unrelated.eval"])
        with patch.object(inspect_guard, "read_eval_log", return_value=log("ours", "success")):
            inspect_guard.outcome("ours", ["completed.eval"])


if __name__ == "__main__":
    unittest.main()
