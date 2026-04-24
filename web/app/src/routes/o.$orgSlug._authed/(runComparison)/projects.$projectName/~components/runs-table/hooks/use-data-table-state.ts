import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  getCoreRowModel,
  useReactTable,
  getPaginationRowModel,
  type SortingState,
  type ColumnDef,
} from "@tanstack/react-table";
import type { Run } from "../../../~queries/list-runs";
import type { ColumnConfig } from "../../../~hooks/use-column-config";
import type { RunFilter } from "@/lib/run-filters";
import { computeRowSelection, mergeSelectedRuns, ensureSelectedRunsIncluded } from "../selection-utils";
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

  // Resolve sort column: "name" is a base column, everything else is a custom column
  let sortCol: ColumnConfig | null = null;
  if (colId !== "name") {
    sortCol = customColumns.find((c) => {
      const tableId = c.source === "system"
        ? `custom-systemMetadata-${c.id}`
        : c.source === "metric" && c.aggregation
          ? `custom-metric-${c.id}-${c.aggregation}`
          : `custom-${c.source}-${c.id}`;
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
    const sa = String(va);
    const sb = String(vb);
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
 * Read a boolean from localStorage, defaulting to false on error or missing key.
 */
function readBoolFromStorage(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

/**
 * Persist a boolean to localStorage (remove key when false to keep storage clean).
 */
function writeBoolToStorage(key: string, value: boolean): void {
  try {
    if (value) {
      localStorage.setItem(key, "true");
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // localStorage unavailable
  }
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
}: UseDataTableStateParams) {
  const isExperiments = listMode === "experiments";

  // Internal pagination state (pageIndex only — pageSize is controlled by parent)
  const [pageIndex, setPageIndex] = useState(0);

  // Custom column resize — uses refs + direct DOM manipulation during drag
  const { getWidth, handleMouseDown, resizeGeneration } = useColumnResize();

  // Drag-and-drop column reordering (custom columns only)
  const { draggedId, dragOverId, handleDragStart, handleDragOver, handleDrop, handleDragEnd } =
    useColumnDrag(customColumns, onReorderColumns);

  // Visibility options state — persisted to localStorage per org/project
  const showOnlySelectedKey = `run-table-showOnlySelected:${orgSlug}:${projectName}`;
  const pinSelectedToTopKey = `run-table-pinSelectedToTop:${orgSlug}:${projectName}`;

  const [showOnlySelected, setShowOnlySelectedRaw] = useState(() => readBoolFromStorage(showOnlySelectedKey));
  const [pinSelectedToTop, setPinSelectedToTopRaw] = useState(() => readBoolFromStorage(pinSelectedToTopKey));

  const setShowOnlySelected = useCallback((value: boolean) => {
    setShowOnlySelectedRaw(value);
    writeBoolToStorage(showOnlySelectedKey, value);
    // Reset to page 0 when toggling to avoid landing on an empty page
    setPageIndex(0);
  }, [showOnlySelectedKey]);

  const setPinSelectedToTop = useCallback((value: boolean) => {
    setPinSelectedToTopRaw(value);
    writeBoolToStorage(pinSelectedToTopKey, value);
  }, [pinSelectedToTopKey]);

  // When pinning is active, split into pinned (sticky, always-visible) and unpinned (paginated).
  const isPinningActive = pinSelectedToTop && Object.keys(selectedRunsWithColors).length > 0;

  // Derive pinned runs from selected runs and sort client-side to match column sort.
  const pinnedRuns = useMemo(
    () => sortPinnedRuns(isPinningActive, selectedRunsWithColors, sorting, customColumns),
    [isPinningActive, selectedRunsWithColors, sorting, customColumns],
  );

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
    let base: Run[];
    if (isPinningActive) {
      const pinnedIds = new Set(Object.keys(selectedRunsWithColors));
      const merged = showOnlySelected
        ? mergeSelectedRuns(runs, selectedRunsWithColors)
        : ensureSelectedRunsIncluded(runs, selectedRunsWithColors);
      base = merged.filter((r) => !pinnedIds.has(r.id));
    } else if (showOnlySelected) {
      base = mergeSelectedRuns(runs, selectedRunsWithColors);
    } else {
      base = ensureSelectedRunsIncluded(runs, selectedRunsWithColors);
    }
    return sortRunsByColumn(base, sorting, customColumns);
  }, [runs, showOnlySelected, isPinningActive, selectedRunsWithColors, sorting, customColumns]);

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

  // Keep track of previous data length to maintain pagination position
  const prevDataLengthRef = useRef(runs.length);
  const lastPageIndexRef = useRef(pageIndex);

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

  // Get current page run IDs for "Select all on page" functionality
  const pageRunIds = useMemo(() => {
    const startIndex = pageIndex * pageSize;
    const endIndex = startIndex + pageSize;
    return displayedRuns.slice(startIndex, endIndex).map((run) => run.id);
  }, [displayedRuns, pageIndex, pageSize]);

  // Maintain pagination position when new data is loaded.
  // Clamp target page to the valid range so we never land on an empty page
  // (can happen when pageSize > RUNS_FETCH_LIMIT, e.g. pageSize=100 but
  // fetch only brings 40 new rows that still fit on page 0).
  useEffect(() => {
    if (runs.length > prevDataLengthRef.current) {
      const maxPage = Math.max(0, Math.ceil(displayedRuns.length / pageSize) - 1);
      const targetPage = Math.min(lastPageIndexRef.current, maxPage);
      if (targetPage !== pageIndex) {
        setPageIndex(targetPage);
      }
      prevDataLengthRef.current = runs.length;
    }
  }, [runs.length, pageIndex, displayedRuns.length, pageSize]);

  // Reset prevDataLengthRef when pageSize changes
  useEffect(() => {
    prevDataLengthRef.current = runs.length;
  }, [pageSize, runs.length]);

  // Reset to page 0 when filters or sorting change to avoid showing empty pages
  useEffect(() => {
    setPageIndex(0);
    prevDataLengthRef.current = 0;
    lastPageIndexRef.current = 0;
  }, [filters, searchQuery, sorting]);

  const table = useReactTable({
    data: finalDisplayedRuns,
    columns: memoizedColumns,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualSorting: true,
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? updater({ pageIndex, pageSize }) : updater;
      setPageIndex(next.pageIndex);
      if (next.pageSize !== pageSize) {
        onPageSizeChange(next.pageSize);
      }
    },
    state: {
      rowSelection: currentRowSelection,
      pagination: { pageIndex, pageSize },
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
  const pinnedColumnMap = useMemo(() => {
    const map: Record<string, { left: number; isLast: boolean }> = {};
    const headers = table.getHeaderGroups()[0]?.headers ?? [];
    let cumulativeLeft = 0;
    const pinnedHeaders = headers.filter((h) => pinnedColumnIds.has(h.column.id));
    pinnedHeaders.forEach((h, i) => {
      const def = h.column.columnDef;
      const isFixed = def.enableResizing === false;
      const w = isFixed ? (def.size ?? 150) : getWidth(h.column.id, def.size ?? 150);
      map[h.column.id] = { left: cumulativeLeft, isLast: i === pinnedHeaders.length - 1 };
      cumulativeLeft += w;
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, pinnedColumnIds, getWidth, resizeGeneration]);

  // Table width for fixed layout
  const tableWidth = useMemo(() =>
    table.getHeaderGroups()[0]?.headers.reduce((sum, h) => {
      const def = h.column.columnDef;
      const isFixed = def.enableResizing === false;
      return sum + (isFixed ? (def.size ?? 150) : getWidth(h.column.id, def.size ?? 150));
    }, 0) ?? 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table, getWidth, resizeGeneration],
  );

  return {
    // Pagination
    pageIndex,
    setPageIndex,
    lastPageIndexRef,
    prevDataLengthRef,
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
    setShowOnlySelected,
    pinSelectedToTop,
    setPinSelectedToTop,
    isPinningActive,
    // Derived data
    pinnedRuns,
    displayedRuns,
    displayedRunCount: finalDisplayedRuns.length,
    totalExperimentCount,
    pageRunIds,
    pinnedColumnMap,
    tableWidth,
    // Table instances
    table,
    pinnedTable,
    // Pass through for colSpan usage
    memoizedColumns,
  };
}
