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

  // Index directly into the selection Record (O(1) per lookup) rather than
  // materializing a Set of ALL selected ids just to call `.has`. This is
  // called once per expanded leaf bucket, so with a large selection the old
  // `new Set(Object.keys(...))` was an O(selection) allocation per call for
  // no benefit — we only ever probe the (bounded) displayed page's ids.
  for (const run of displayedRuns) {
    if (run?.id && selectedRunsWithColors[run.id]) {
      selection[run.id] = true;
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
  /** When true, drops the second pass (out-of-page selected). Used
   *  by the flat-mode displayedRuns memo when search is active so the
   *  table matches grouped mode's "search filters DOS too" behaviour
   *  — selected runs that don't match the search term are no longer
   *  appended to the bottom of the visible page. The full selection
   *  set is still in `selectedRunsWithColors` (counter, charts, etc.
   *  use it directly), and the "Other matches — outside current
   *  view" dropdown still surfaces non-selected hits. */
  restrictToInPage = false,
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

  if (restrictToInPage) return inPage;

  // Second: selected runs NOT in the paginated array (from cache / other pages)
  const outOfPage: Run[] = [];
  for (const [id, entry] of Object.entries(selectedRunsWithColors)) {
    if (!seenIds.has(id)) {
      outOfPage.push(entry.run);
    }
  }

  return [...inPage, ...outOfPage];
}

/**
 * Filter-alone reconciliation: drop `runs` whose id ISN'T in the
 * server's filter-matched ID set. `runs` upstream is really
 * `allVisibleRuns`, which merges getByIds (URL-prefetched + IndexedDB-
 * hydrated) selection runs — those bypass the toolbar filter, so a
 * plain "return runs" leaks selected-non-matching rows into the table
 * whenever a user has an active filter chip but NO viewport toggle.
 *
 * When `serverFilteredRunIds` is undefined (query hasn't landed yet
 * or filter is off), returns `runs` unchanged.
 */
export function intersectWithServerFilter<T extends { id: string }>(
  runs: T[],
  serverFilteredRunIds: ReadonlySet<string> | undefined,
): T[] {
  if (!serverFilteredRunIds) return runs;
  return runs.filter((r) => serverFilteredRunIds.has(r.id));
}

/**
 * Stable partition that promotes filter-matching rows to the front.
 *
 * Used to guarantee "all matching runs on page 1" under
 * Filter + DOS/PSTT with small pageSize. Without this, TanStack's
 * client sort could scatter matched runs across pages by whatever
 * column the user was sorting on, and the filter divider then landed
 * on page 1 with only a partial matching-set visible.
 *
 * Order within each half is preserved — so if `runs` was sorted by
 * batch_size desc, the matched half comes out sorted by batch_size
 * desc, and same for the unmatched half.
 *
 * No-op (returns the input reference untouched) when
 * `serverFilteredRunIds` is undefined or empty, or when `runs` is
 * empty, so callers can hand any set in without a preflight check.
 */
export function partitionMatchingFirst<T extends { id: string }>(
  runs: T[],
  serverFilteredRunIds: ReadonlySet<string> | undefined,
): T[] {
  if (!serverFilteredRunIds || serverFilteredRunIds.size === 0) return runs;
  if (runs.length === 0) return runs;
  const matched: T[] = [];
  const unmatched: T[] = [];
  for (const r of runs) {
    (serverFilteredRunIds.has(r.id) ? matched : unmatched).push(r);
  }
  return [...matched, ...unmatched];
}
