import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type SortingState,
  type ColumnDef,
} from "@tanstack/react-table";
import type { Run } from "../../../~queries/list-runs";
import type { ColumnConfig } from "../../../~hooks/use-column-config";
import type { RunFilter } from "@/lib/run-filters";
import { computeRowSelection, mergeSelectedRuns, ensureSelectedRunsIncluded, intersectWithServerFilter, partitionMatchingFirst } from "../selection-utils";
import { columnTableId } from "../column-table-id";
import { computeColumnOrder } from "../lib/pinned-columns";
import { getCustomColumnValue } from "../columns-utils";
import { useColumnDrag } from "./use-column-drag";
import { useColumnResize } from "./use-column-resize";

interface UseDataTableStateParams {
  runs: Run[];
  selectedRunsWithColors: Record<string, { run: Run; color: string }>;
  customColumns: ColumnConfig[];
  onReorderColumns?: (fromIndex: number, toIndex: number) => void;
  filters: RunFilter[];
  searchQuery: string;
  sorting: SortingState;
  pageSize: number;
  onPageSizeChange: (pageSize: number) => void;
  memoizedColumns: ColumnDef<Run, any>[];
  pinnedColumnIds: Set<string>;
  orgSlug: string;
  projectName: string;
  listMode?: "experiments" | "runs";
  showOnlySelected: boolean;
  pinSelectedToTop: boolean;
  onPinSelectedToTopChange: (value: boolean) => void;
  /** IDs the current toolbar filter actually returned from runs.list.
   *  Under Filter alone (no DOS, no PSTT) we intersect `runs` with
   *  this set so cached / URL-prefetched / IndexedDB-hydrated
   *  selected runs that DON'T match the filter drop out of the
   *  table — otherwise `runs` (= allVisibleRuns upstream) carries
   *  them through and they render below the filter divider even
   *  though the user hasn't opted into "keep selection visible". */
  serverFilteredRunIds?: Set<string>;
  /** Extra pixels to add to the FIRST (leftmost) column's width when
   *  rendering the table in grouped mode. Widens the eye column so
   *  bucket tree's nesting shifts the eye / status dot / name to the
   *  right by the same `0.5rem + groupBy.length * 1.25rem` step the
   *  bucket headers use. Zero in flat mode. */
  groupedIndentPx?: number;
}

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


export function useDataTableState({
  runs,
  selectedRunsWithColors,
  customColumns,
  onReorderColumns,
  filters,
  searchQuery,
  sorting,
  pageSize,
  onPageSizeChange,
  memoizedColumns,
  pinnedColumnIds,
  orgSlug,
  projectName,
  listMode,
  showOnlySelected,
  pinSelectedToTop,
  onPinSelectedToTopChange,
  serverFilteredRunIds,
  groupedIndentPx = 0,
}: UseDataTableStateParams) {
  const isExperiments = listMode === "experiments";

  // Internal pagination state (pageIndex only — pageSize is controlled by parent)
  const [pageIndex, setPageIndex] = useState(0);

  // Custom column resize — uses refs + direct DOM manipulation during drag
  const { getWidth, handleMouseDown, resizeGeneration } = useColumnResize();

  const wrappedOnReorderColumns = useCallback(
    (fromIndex: number, toIndex: number) => {
      onReorderColumns?.(fromIndex, toIndex);
    },
    [onReorderColumns],
  );
  const { draggedId, dragOverId, handleDragStart, handleDragOver, handleDrop, handleDragEnd } =
    useColumnDrag(customColumns, wrappedOnReorderColumns);

  // pinSelectedToTop and showOnlySelected are both lifted to the parent — see
  // UseDataTableStateParams. The parent enforces the group-by mutual exclusion.

  // Reset to page 0 when the user toggles "Display only selected" so they
  // don't land on an empty page (filtered dataset is smaller than full list).
  // Guard skips the initial mount so we only reset on actual user toggles.
  const isFirstShowOnlySelectedRender = useRef(true);
  useEffect(() => {
    if (isFirstShowOnlySelectedRender.current) {
      isFirstShowOnlySelectedRender.current = false;
      return;
    }
    setPageIndex(0);
  }, [showOnlySelected]);

  // When pinning is active, split into pinned (sticky, always-visible) and unpinned (paginated).
  const isPinningActive = pinSelectedToTop && Object.keys(selectedRunsWithColors).length > 0;

  // Derive pinned runs from selected runs and sort client-side to
  // match column sort. Under an active filter, apply the same
  // matching-first partition as `displayedRuns` so the divider lands
  // at the true boundary between "selected + filter-matching" and
  // "selected + non-matching" instead of wherever the sort put the
  // first non-matching row.
  const pinnedRuns = useMemo(() => {
    const sorted = sortPinnedRuns(isPinningActive, selectedRunsWithColors, sorting, customColumns);
    if (!filters.length || !isPinningActive) return sorted;
    return partitionMatchingFirst(sorted, serverFilteredRunIds);
  }, [isPinningActive, selectedRunsWithColors, sorting, customColumns, filters.length, serverFilteredRunIds]);

  // The main table data: either filtered-to-selected minus pinned, unpinned only, or all runs.
  // When "Display only selected" is active, use mergeSelectedRuns to include
  // selected runs that may not be in the current paginated page (e.g., from
  // IndexedDB cache or previous browsing sessions).
  //
  // Both merge helpers can produce rows the server's sort didn't order:
  //   - mergeSelectedRuns appends out-of-page selected runs in insertion
  //     order (Object.entries(selectedRunsWithColors)). Visible as a
  //     scrambled tail under "Display only selected".
  //   - ensureSelectedRunsIncluded appends missing selected runs at the
  //     end of the page regardless of the sort.
  // In either case, re-sort client-side so the user sees a coherent order.
  // When the merge didn't touch the list (reference-equal to runs), the
  // client sort is redundant but cheap — sortRunsByColumn short-circuits
  // on empty sorting and returns a shallow copy otherwise.
  const displayedRuns = useMemo(() => {
    // When search is active and the user is in Display-Only-Selected
    // mode, drop the out-of-page selected pass AND name-filter the
    // remainder so non-matching selected runs disappear from the
    // table — matches the grouped-mode behaviour where
    // `distinctGroupValues` honours search server-side and DOS
    // narrows the result. The name-match is necessary because `runs`
    // (= tableRuns) carries URL-prefetched + cached selected runs
    // regardless of the search filter, so `restrictToInPage` alone
    // would let those slip through. See GROUPING_V2_PR_NOTES.md
    // "Flat vs grouped" table.
    const trimmedSearch = searchQuery?.trim() ?? "";
    const restrictDOSToSearch = showOnlySelected && trimmedSearch.length > 0;
    const applyNameMatch = (rs: Run[]): Run[] =>
      restrictDOSToSearch
        ? rs.filter((r) => (r.name ?? "").toLowerCase().includes(trimmedSearch.toLowerCase()))
        : rs;
    // Filter chips + no viewport toggles: trust the filter chips
    // and DON'T sticky-append selected-non-matching runs. The user
    // hasn't opted into keeping selection visible via DOS/PSTT, so
    // leaking selected runs from outside the filter would fight
    // what the filter chip promises. Under DOS or PSTT the toggle
    // IS the "keep selection visible" opt-in and the sticky-append
    // stays.
    const filterActive = filters.length > 0;
    let base: Run[];
    if (isPinningActive) {
      const pinnedIds = new Set(Object.keys(selectedRunsWithColors));
      const merged = showOnlySelected
        ? mergeSelectedRuns(runs, selectedRunsWithColors, restrictDOSToSearch)
        : ensureSelectedRunsIncluded(runs, selectedRunsWithColors);
      base = applyNameMatch(merged).filter((r) => !pinnedIds.has(r.id));
    } else if (showOnlySelected) {
      base = applyNameMatch(mergeSelectedRuns(runs, selectedRunsWithColors, restrictDOSToSearch));
    } else if (filterActive) {
      // Filter alone: drop cached / URL-prefetched / IndexedDB-
      // hydrated rows that don't match the current filter (see
      // `intersectWithServerFilter` doc for the leak this fixes).
      base = intersectWithServerFilter(runs, serverFilteredRunIds);
    } else {
      base = ensureSelectedRunsIncluded(runs, selectedRunsWithColors);
    }
    const sorted = sortRunsByColumn(base, sorting, customColumns);
    // Under Filter + DOS/PSTT, promote filter-matching rows to the
    // front BEFORE TanStack paginates. Without this, a small page
    // size can slice matching rows onto later pages and the divider
    // renders as if there were fewer matches than there really are —
    // e.g. pageSize=10 with 4 matches spread by sort across page 1
    // and page 3 shows only 2 above the divider on page 1. Stable
    // partition (preserves the user's sort order within each half),
    // gated on filterActive so it's a no-op when there's no filter.
    // Filter-alone case has no non-matching rows to promote against
    // (base is already intersected with the server filter above), so
    // skip.
    if (filterActive && (showOnlySelected || isPinningActive)) {
      return partitionMatchingFirst(sorted, serverFilteredRunIds);
    }
    return sorted;
  }, [runs, showOnlySelected, searchQuery, isPinningActive, selectedRunsWithColors, sorting, customColumns, filters, serverFilteredRunIds]);

  // In "experiments" mode, collapse same-name runs into one row per experiment.
  // Keeps the first occurrence (most recent) as the representative.
  const finalDisplayedRuns = useMemo(() => {
    if (!isExperiments) return displayedRuns;
    const seen = new Set<string>();
    return displayedRuns.filter((r) => {
      if (seen.has(r.name)) return false;
      seen.add(r.name);
      return true;
    });
  }, [displayedRuns, isExperiments]);

  // Total unique experiment count across all loaded runs
  const totalExperimentCount = useMemo(() => {
    return new Set(runs.map((r) => r.name)).size;
  }, [runs]);


  // Compute column ordering: pinned columns first, then unpinned
  const columnOrder = useMemo(
    () => computeColumnOrder(customColumns),
    [customColumns],
  );

  // Calculate current row selection based on actual selectedRunsWithColors.
  const currentRowSelection = useMemo(
    () => computeRowSelection(displayedRuns, selectedRunsWithColors),
    [displayedRuns, selectedRunsWithColors],
  );

  // Row selection for pinned table (all rows are selected by definition)
  const pinnedRowSelection = useMemo(
    () => computeRowSelection(pinnedRuns, selectedRunsWithColors),
    [pinnedRuns, selectedRunsWithColors],
  );

  // Effective slice size for the unpinned table when pin-selected-to-top
  // is active. The user's mental model is that `pageSize` is the total
  // number of rows on screen, so the unpinned slice should fill whatever
  // pageSize leaves over after the pinned rows. Two cases:
  //   - pinned <  pageSize → unpinned per page = pageSize - pinned
  //   - pinned >= pageSize → unpinned per page = 0 (page count collapses
  //     to 1; user sees only the pinned rows until they deselect down
  //     below pageSize).
  // We floor the table-state value at 1 so TanStack's getPaginationRowModel
  // doesn't divide by zero; the indicator math below treats the 0 case
  // specially.
  const effectivePageSize = computeEffectivePageSize(
    pageSize,
    pinnedRuns.length,
    isPinningActive,
  );
  const tablePageSize = Math.max(1, effectivePageSize);

  // IDs in the current unpinned page slice — what "Select all on page"
  // operates on. Returns [] when effectivePageSize is 0 (pin-to-top is
  // on and pinned rows already fill the user's pageSize budget), since
  // there are no unpinned slots to select into.
  const pageRunIds = useMemo(() => {
    if (effectivePageSize === 0) return [];
    const startIndex = pageIndex * tablePageSize;
    const endIndex = startIndex + tablePageSize;
    return displayedRuns.slice(startIndex, endIndex).map((run) => run.id);
  }, [displayedRuns, pageIndex, tablePageSize, effectivePageSize]);

  // IDs the "Deselect all on page" button acts on. In pin-to-top mode
  // the user's "page" includes the pinned block (which is the entire
  // selected set, scrolled in place above the unpinned slice), so we
  // surface all pinned IDs — count matches `# selected` and the
  // function matches "Deselect all" when pinned >= pageSize. In flat
  // mode it's the same page slice as Select-all-on-page.
  const deselectablePageRunIds = useMemo(() => {
    if (isPinningActive) return pinnedRuns.map((run) => run.id);
    return pageRunIds;
  }, [isPinningActive, pinnedRuns, pageRunIds]);

  // Note: page advance after a click-driven fetch is handled
  // explicitly in DataTable's `handleFetchNextPage` (setPageIndex after
  // await fetchNextPage). The old growth-detection effect that lived
  // here was redundant for clicks AND actively warped the user back to
  // `lastPageIndexRef` whenever runs.length grew for any non-click
  // reason — e.g. React Query refetching runs.list after a window-
  // focus invalidation when another SDK had created a run. Removed.
  //
  // Reset to page 0 when filters or sorting change to avoid showing empty pages
  useEffect(() => {
    setPageIndex(0);
  }, [filters, searchQuery, sorting]);

  const table = useReactTable({
    data: finalDisplayedRuns,
    columns: memoizedColumns,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualSorting: true,
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? updater({ pageIndex, pageSize: tablePageSize }) : updater;
      setPageIndex(next.pageIndex);
      // TanStack-driven pageSize changes only come from explicit
      // setPageSize calls; the user-facing dropdown bypasses table
      // state and calls onPageSizeChange directly, so this branch
      // is currently dead but kept for completeness.
      if (next.pageSize !== tablePageSize) {
        onPageSizeChange(next.pageSize);
      }
    },
    state: {
      rowSelection: currentRowSelection,
      pagination: { pageIndex, pageSize: tablePageSize },
      sorting,
      columnOrder,
    },
    enableRowSelection: true,
    autoResetPageIndex: false,
    // IMPORTANT: Do NOT add onSortingChange here — it causes infinite re-render
    // loops with the ref-based column resize. Sorting is managed manually via
    // onSortingChange called from column header dropdown menus.
  });

  // Separate table instance for pinned (sticky) rows — always called, empty data when off
  const pinnedTable = useReactTable({
    data: pinnedRuns,
    columns: memoizedColumns,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    state: {
      rowSelection: pinnedRowSelection,
      columnOrder,
    },
    enableRowSelection: true,
  });

  // Compute dynamic pinned column map from the actual rendered header order + widths.
  // The FIRST column gets `groupedIndentPx` added to its width when
  // grouping is active — same widening renderColGroup applies — so
  // subsequent sticky `left:` offsets land in the same place the
  // colgroup paints column boundaries.
  const pinnedColumnMap = useMemo(() => {
    const map: Record<string, { left: number; isLast: boolean }> = {};
    const headers = table.getHeaderGroups()[0]?.headers ?? [];
    let cumulativeLeft = 0;
    const pinnedHeaders = headers.filter((h) => pinnedColumnIds.has(h.column.id));
    pinnedHeaders.forEach((h, i) => {
      const def = h.column.columnDef;
      const isFixed = def.enableResizing === false;
      const baseW = isFixed ? (def.size ?? 150) : getWidth(h.column.id, def.size ?? 150);
      const w = i === 0 ? baseW + groupedIndentPx : baseW;
      map[h.column.id] = { left: cumulativeLeft, isLast: i === pinnedHeaders.length - 1 };
      cumulativeLeft += w;
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, pinnedColumnIds, getWidth, resizeGeneration, groupedIndentPx]);

  // Table width for fixed layout
  const tableWidth = useMemo(() => {
    const headers = table.getHeaderGroups()[0]?.headers ?? [];
    return headers.reduce((sum, h, i) => {
      const def = h.column.columnDef;
      const isFixed = def.enableResizing === false;
      const baseW = isFixed ? (def.size ?? 150) : getWidth(h.column.id, def.size ?? 150);
      return sum + (i === 0 ? baseW + groupedIndentPx : baseW);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, getWidth, resizeGeneration, groupedIndentPx]);

  return {
    // Pagination
    pageIndex,
    setPageIndex,
    /** Slice size used internally by the unpinned table when pin-
     *  selected-to-top is on. Equals `pageSize - pinnedCount` (floored
     *  at 0). When 0, the unpinned section is empty by design (pinned
     *  rows already fill the user's pageSize budget) and `totalPages`
     *  should collapse to 1. */
    effectivePageSize,
    // Resize
    getWidth,
    handleMouseDown,
    resizeGeneration,
    // Drag
    draggedId,
    dragOverId,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
    // Visibility
    showOnlySelected,
    isPinningActive,
    // Derived data
    pinnedRuns,
    displayedRuns,
    displayedRunCount: finalDisplayedRuns.length,
    totalExperimentCount,
    pageRunIds,
    deselectablePageRunIds,
    pinnedColumnMap,
    tableWidth,
    // Table instances
    table,
    pinnedTable,
    // Pass through for colSpan usage
    memoizedColumns,
    columnOrder,
  };
}
