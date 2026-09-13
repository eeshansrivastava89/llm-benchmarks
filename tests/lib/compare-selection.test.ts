import { describe, expect, it } from "vitest";
import {
  selectedCompareRuns,
  toggleCompareSelection
} from "../../public/js/compare.js";

const runs = [
  { runId: "run-1", runDirectory: "/tmp/runs/a" },
  { runId: "run-2", runDirectory: "/tmp/runs/b" },
  { runId: "run-3", runDirectory: "/tmp/runs/c" },
  { runId: "run-4", runDirectory: "/tmp/runs/d" },
  { runId: "run-5", runDirectory: "/tmp/runs/e" },
  { runId: "run-6", runDirectory: "/tmp/runs/f" },
  { runId: "run-7", runDirectory: "/tmp/runs/g" }
];

describe("compare selection helpers", () => {
  it("toggles runs by stable run key while preserving selection order", () => {
    const first = toggleCompareSelection([], runs[1]);
    const second = toggleCompareSelection(first, runs[0]);
    const removed = toggleCompareSelection(second, runs[1]);

    expect(first).toEqual(["/tmp/runs/b"]);
    expect(second).toEqual(["/tmp/runs/b", "/tmp/runs/a"]);
    expect(removed).toEqual(["/tmp/runs/a"]);
    expect(selectedCompareRuns(runs, second).map((run: { runId: string }) => run.runId)).toEqual(["run-2", "run-1"]);
  });

  it("caps selection to the newest six chosen runs", () => {
    const selected = runs.reduce(
      (selection, run) => toggleCompareSelection(selection, run),
      [] as string[]
    );

    expect(selected).toEqual(["/tmp/runs/b", "/tmp/runs/c", "/tmp/runs/d", "/tmp/runs/e", "/tmp/runs/f", "/tmp/runs/g"]);
    expect(selectedCompareRuns(runs, selected).map((run: { runId: string }) => run.runId)).toEqual([
      "run-2",
      "run-3",
      "run-4",
      "run-5",
      "run-6",
      "run-7"
    ]);
  });
});
