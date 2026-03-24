import type { Run } from "../../~queries/list-runs";

/**
 * Compute the TanStack Table rowSelection record from the displayed runs.
 *
 * Keys are run IDs (matching the table's `getRowId: (row) => row.id`).
 * This ensures `row.getIsSelected()` works correctly regardless of row
 * ordering, pagination, or filtering.
 */
export function computeRowSelection(
  displayedRuns: Run[],
  selectedRunsWithColors: Record<string, { run: Run; color: string }>,
): Record<string, boolean> {
  const selection: Record<string, boolean> = {};

  if (displayedRuns.length > 0) {
    const selectedIds = new Set(Object.keys(selectedRunsWithColors));

    if (selectedIds.size > 0) {
      displayedRuns.forEach((run) => {
        if (run?.id && selectedIds.has(run.id)) {
          selection[run.id] = true;
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

/**
 * Ensure all selected runs are present in the displayed runs array.
 * Unlike `mergeSelectedRuns` (which returns ONLY selected runs for "Display
 * only selected" mode), this preserves ALL paginated runs and just appends
 * any selected runs missing from the current page.
 *
 * Returns the same array reference when no runs are missing (memoization-friendly).
 */
export function ensureSelectedRunsIncluded(
  runs: Run[],
  selectedRunsWithColors: Record<string, { run: Run; color: string }>,
): Run[] {
  const selectedIds = Object.keys(selectedRunsWithColors);
  if (selectedIds.length === 0) return runs;

  const existingIds = new Set(runs.map((r) => r.id));
  const missing: Run[] = [];
  for (const id of selectedIds) {
    if (!existingIds.has(id)) {
      missing.push(selectedRunsWithColors[id].run);
    }
  }
  return missing.length > 0 ? [...runs, ...missing] : runs;
}

/**
 * Merge paginated runs with selected runs that may not be in the current page.
 * When "Display only selected" is active, selected runs stored in
 * selectedRunsWithColors may include runs from IndexedDB cache or previous
 * pages that aren't in the current paginated `runs` array.
 *
 * Returns only selected runs: those found in `runs` (preserving page order)
 * plus any remaining selected runs not in the page (appended at the end).
 */
export function mergeSelectedRuns(
  runs: Run[],
  selectedRunsWithColors: Record<string, { run: Run; color: string }>,
): Run[] {
  const selectedIds = new Set(Object.keys(selectedRunsWithColors));
  if (selectedIds.size === 0) return [];

  // First: selected runs that ARE in the paginated array (preserves page order)
  const inPage: Run[] = [];
  const seenIds = new Set<string>();
  for (const run of runs) {
    if (selectedIds.has(run.id)) {
      inPage.push(run);
      seenIds.add(run.id);
    }
  }

  // Second: selected runs NOT in the paginated array (from cache / other pages)
  const outOfPage: Run[] = [];
  for (const [id, entry] of Object.entries(selectedRunsWithColors)) {
    if (!seenIds.has(id)) {
      outOfPage.push(entry.run);
    }
  }

  return [...inPage, ...outOfPage];
}
