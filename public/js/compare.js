export function compareRunKey(run) {
  return run?.runDirectory || run?.runId || "";
}

export const MAX_COMPARE_SELECTIONS = 6;

export function toggleCompareSelection(selection, run, maxSelections = MAX_COMPARE_SELECTIONS) {
  const key = compareRunKey(run);
  if (!key) return selection.slice();

  if (selection.includes(key)) {
    return selection.filter((item) => item !== key);
  }

  return [...selection, key].slice(-maxSelections);
}

export function selectedCompareRuns(runs, selection) {
  const runsByKey = new Map(runs.map((run) => [compareRunKey(run), run]));
  return selection.map((key) => runsByKey.get(key)).filter(Boolean);
}
