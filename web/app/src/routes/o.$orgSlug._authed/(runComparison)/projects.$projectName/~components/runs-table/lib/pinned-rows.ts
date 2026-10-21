import type { SortingState } from "@tanstack/react-table";
import type { Run } from "../../../~queries/list-runs";
import type { ColumnConfig } from "../../../~hooks/use-column-config";
import { partitionMatchingFirst } from "../selection-utils";
import { columnTableId } from "../column-table-id";
import { getCustomColumnValue } from "../columns-utils";

/**
 * Client-side sort of a Run list by the active column sort. Used wherever
 * we've client-merged runs in a way the server-side sort no longer covers
 * (pinned runs, "Display only selected" out-of-page tail, etc.).
 *
 * Returns a new array; original is not mutated. When sorting is empty, the
 * input is returned as-is so callers can rely on reference stability when
 * the user hasn't picked a sort.
 */
export function sortRunsByColumn(
  runs: Run[],
  sorting: SortingState,
  customColumns: ColumnConfig[],
): Run[] {
  if (runs.length === 0 || sorting.length === 0) return runs;

  const { id: colId, desc } = sorting[0];
  const dir = desc ? -1 : 1;

  // Resolve sort column: "name" is a base column, everything else is a custom column.
  // Mirror the tableId formula in columns.tsx EXACTLY — any divergence here
  // makes sortRunsByColumn a no-op for system/createdAt/status/group/notes/tags
  // sorts, which lets the unsorted insertion order of pinned-selected runs leak
  // through and overrides the server's intended desc order.
  let sortCol: ColumnConfig | null = null;
  if (colId !== "name") {
    sortCol = customColumns.find((c) => {
      const tableId = columnTableId(c);
      return tableId === colId;
    }) ?? null;
    // Unknown column id — e.g. a server-side sort key the client doesn't
    // know how to evaluate. Leave the list in whatever order the server /
    // caller produced instead of collapsing it to "all equal".
    if (!sortCol) return runs;
  }

  const result = [...runs];
  result.sort((a, b) => {
    const va = colId === "name"
      ? a.name
      : sortCol ? getCustomColumnValue(a, sortCol) : undefined;
    const vb = colId === "name"
      ? b.name
      : sortCol ? getCustomColumnValue(b, sortCol) : undefined;
    // NULLS LAST regardless of direction — matches the backend's sort
    // (and how users expect tables to behave). Keeping the client's null
    // placement aligned with the server's is also what lets us apply
    // this helper to a server-sorted array safely: it's a no-op when
    // the server already ordered the list, so it doesn't corrupt the
    // offset-paginated pages when the user scrolls forward and back.
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "number" && typeof vb === "number") {
      return (va - vb) * dir;
    }
    // Dates as Date objects via superjson deserialization. String(Date) is
    // "Thu May 14 2026..." which sorts by day-of-week alphabetically — Mon
    // (May 18) ends up BEFORE Thu (May 14) because 'M' < 'T'. Normalize Date
    // objects to ISO strings so they sort chronologically alongside string
    // ISO timestamps from the same column.
    const sa = va instanceof Date ? va.toISOString() : String(va);
    const sb = vb instanceof Date ? vb.toISOString() : String(vb);
    return sa < sb ? -dir : sa > sb ? dir : 0;
  });
  return result;
}

/**
 * Sort pinned runs client-side to match the active column sort.
 * Exported for unit testing.
 */
export function sortPinnedRuns(
  isPinningActive: boolean,
  selectedRunsWithColors: Record<string, { run: Run; color: string }>,
  sorting: SortingState,
  customColumns: ColumnConfig[],
): Run[] {
  if (!isPinningActive) return [];
  const runs = Object.values(selectedRunsWithColors).map((v) => v.run);
  return sortRunsByColumn(runs, sorting, customColumns);
}

/**
 * Effective slice size for the unpinned table under pin-selected-to-top.
 * The user reads `pageSize` as the total rows on screen, so the unpinned
 * slice fills whatever pageSize leaves after the pinned block:
 *   - pinning off        → pageSize
 *   - pinned <  pageSize → pageSize - pinned
 *   - pinned >= pageSize → 0 (page collapses to just the pinned block)
 * Never negative. Callers floor the TanStack page size at 1 separately so
 * `getPaginationRowModel` doesn't divide by zero.
 * Exported for unit testing.
 */
export function computeEffectivePageSize(
  pageSize: number,
  pinnedCount: number,
  isPinningActive: boolean,
): number {
  return isPinningActive ? Math.max(0, pageSize - pinnedCount) : pageSize;
}

interface DerivePinnedRunsParams {
  isPinningActive: boolean;
  selectedRunsWithColors: Record<string, { run: Run; color: string }>;
  sorting: SortingState;
  customColumns: ColumnConfig[];
  filterActive: boolean;
  serverFilteredRunIds?: Set<string>;
}

/**
 * Pinned (sticky) rows under pin-selected-to-top: the selected runs sorted
 * client-side to match the column sort. Under an active filter, apply the
 * same matching-first partition as the unpinned list so the divider lands
 * at the true boundary between "selected + filter-matching" and
 * "selected + non-matching" instead of wherever the sort put the first
 * non-matching row.
 */
export function derivePinnedRuns({
  isPinningActive,
  selectedRunsWithColors,
  sorting,
  customColumns,
  filterActive,
  serverFilteredRunIds,
}: DerivePinnedRunsParams): Run[] {
  const sorted = sortPinnedRuns(isPinningActive, selectedRunsWithColors, sorting, customColumns);
  if (!filterActive || !isPinningActive) return sorted;
  return partitionMatchingFirst(sorted, serverFilteredRunIds);
}

/** The run whose display ID equals the search, leading the selected pins.
 *  It is dropped from them so it renders once. */
export function withExactMatchFirst(selectedPinnedRuns: Run[], exactMatchRun: Run | null): Run[] {
  if (!exactMatchRun) return selectedPinnedRuns;
  return [exactMatchRun, ...excludeRun(selectedPinnedRuns, exactMatchRun)];
}

export function excludeRun(runs: Run[], run: Run | null): Run[] {
  if (!run) return runs;
  return runs.filter((r) => r.id !== run.id);
}
