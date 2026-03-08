import { useState, useEffect, useRef, useMemo } from "react";
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
import { computeRowSelection, filterToSelected } from "../selection-utils";
import { computeColumnOrder } from "../lib/pinned-columns";
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
}: UseDataTableStateParams) {
  // Internal pagination state (pageIndex only — pageSize is controlled by parent)
  const [pageIndex, setPageIndex] = useState(0);

  // Custom column resize — uses refs + direct DOM manipulation during drag
  const { getWidth, handleMouseDown, resizeGeneration } = useColumnResize();

  // Drag-and-drop column reordering (custom columns only)
  const { draggedId, dragOverId, handleDragStart, handleDragOver, handleDrop, handleDragEnd } =
    useColumnDrag(customColumns, onReorderColumns);

  // Visibility options state
  const [showOnlySelected, setShowOnlySelected] = useState(false);
  const [pinSelectedToTop, setPinSelectedToTop] = useState(false);

  // When pinning is active, split into pinned (sticky, always-visible) and unpinned (paginated).
  const isPinningActive = pinSelectedToTop && Object.keys(selectedRunsWithColors).length > 0;

  const pinnedRuns = useMemo(() => {
    if (!isPinningActive) return [] as Run[];
    return Object.values(selectedRunsWithColors).map((v) => v.run);
  }, [isPinningActive, selectedRunsWithColors]);

  // The main table data: either filtered-to-selected minus pinned, unpinned only, or all runs
  const displayedRuns = useMemo(() => {
    if (isPinningActive) {
      const pinnedIds = new Set(Object.keys(selectedRunsWithColors));
      const base = showOnlySelected
        ? filterToSelected(runs, selectedRunsWithColors)
        : runs;
      return base.filter((r) => !pinnedIds.has(r.id));
    }
    if (showOnlySelected) {
      return filterToSelected(runs, selectedRunsWithColors);
    }
    return runs;
  }, [runs, showOnlySelected, isPinningActive, selectedRunsWithColors]);

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

  // Maintain pagination position when new data is loaded
  useEffect(() => {
    if (runs.length > prevDataLengthRef.current) {
      if (lastPageIndexRef.current !== pageIndex) {
        setPageIndex(lastPageIndexRef.current);
      }
      prevDataLengthRef.current = runs.length;
    }
  }, [runs.length, pageIndex]);

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
    data: displayedRuns,
    columns: memoizedColumns,
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
