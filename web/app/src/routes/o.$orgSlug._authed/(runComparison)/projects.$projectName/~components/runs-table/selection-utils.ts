import type { Run } from "../../~queries/list-runs";

/**
 * Compute the TanStack Table rowSelection record from the displayed runs.
 *
 * IMPORTANT: `displayedRuns` must be the same array passed to the table's
 * `data` prop.  When "Display only selected" is active, `displayedRuns` is a
 * filtered subset of all runs — so the indices here must correspond to that
 * filtered array, NOT the unfiltered `runs` array.  Using the wrong array
 * causes eye-icon state, series emphasis (hover highlighting), and shift-click
 * range selection to break.
 */
export function computeRowSelection(
  displayedRuns: Run[],
  selectedRunsWithColors: Record<string, { run: Run; color: string }>,
): Record<number, boolean> {
  const selection: Record<number, boolean> = {};

  if (displayedRuns.length > 0) {
    const selectedIds = new Set(Object.keys(selectedRunsWithColors));

    if (selectedIds.size > 0) {
      displayedRuns.forEach((run, index) => {
        if (run?.id && selectedIds.has(run.id)) {
          selection[index] = true;
        }
      });
    }
  }

  return selection;
}

/**
 * Sort runs so that selected (pinned) runs appear first, preserving
 * original order within each group. Returns the sorted array and the
 * count of pinned runs so the table can render a visual separator.
 */
export function sortPinnedToTop(
  runs: Run[],
  selectedRunsWithColors: Record<string, { run: Run; color: string }>,
): { sorted: Run[]; pinnedCount: number } {
  const pinned: Run[] = [];
  const unpinned: Run[] = [];
  for (const run of runs) {
    if (selectedRunsWithColors[run.id]) {
      pinned.push(run);
    } else {
      unpinned.push(run);
    }
  }
  return { sorted: [...pinned, ...unpinned], pinnedCount: pinned.length };
}

/**
 * Filter runs to only those that are selected.
 * Used when "Display only selected" toggle is active.
 */
export function filterToSelected(
  runs: Run[],
  selectedRunsWithColors: Record<string, { run: Run; color: string }>,
): Run[] {
  return runs.filter((run) => selectedRunsWithColors[run.id]);
}
