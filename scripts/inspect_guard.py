"""Verify the native outcome of a Bench Inspect eval."""

import json
import sys
from pathlib import Path

from inspect_ai.log import read_eval_log


def outcome(run_id, filenames):
    matches = []
    for filename in filenames:
        log = read_eval_log(Path(filename), header_only=True)
        if log.eval.metadata and log.eval.metadata.get("bench_run_id") == run_id:
            matches.append(log)
    if not matches:
        raise ValueError("Inspect did not create a log for this Bench run")
    statuses = [log.status for log in matches]
    if any(status != "success" for status in statuses):
        raise ValueError(f"Inspect log status: {', '.join(statuses)}")


def main():
    try:
        if len(sys.argv) == 4 and sys.argv[1] == "outcome":
            outcome(sys.argv[2], json.loads(sys.argv[3]))
        else:
            raise ValueError("Invalid Inspect guard command")
    except Exception as error:
        if isinstance(error, ValueError):
            print(str(error), file=sys.stderr)
        else:
            print(f"Could not verify Inspect log ({type(error).__name__})", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
