"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getPaginationRowModel,
  type PaginationState,
  type SortingState,
} from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Columns, GripVertical, Search } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { columns } from "./columns";
import type { Run } from "../../~queries/list-runs";
import type { ColumnConfig, BaseColumnOverrides } from "../../~hooks/use-column-config";
import { VisibilityOptions } from "./visibility-options";
import { ColumnPicker } from "./column-picker";
import { FilterButton } from "./filter-button";
import type { RunFilter, FilterableField } from "@/lib/run-filters";

const MIN_COL_WIDTH = 50;

// Hook for drag-and-drop column reordering (native HTML drag events)
function useColumnDrag(
  customColumns: ColumnConfig[],
  onReorder?: (fromIndex: number, toIndex: number) => void,
) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const getCustomIndex = useCallback(
    (columnId: string) => {
      // Column IDs are like "custom-config-lr", "custom-system-createdAt",
      // or "custom-metric-train/loss-LAST" (with aggregation suffix)
      const stripped = columnId.replace(/^custom-/, "");
      return customColumns.findIndex(
        (col) => {
          const key = col.source === "metric" && col.aggregation
            ? `${col.source}-${col.id}-${col.aggregation}`
            : `${col.source}-${col.id}`;
          return key === stripped;
        },
      );
    },
    [customColumns],
  );

  const handleDragStart = useCallback(
    (columnId: string, e: React.DragEvent) => {
      setDraggedId(columnId);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", columnId);
      // Make the drag image semi-transparent
      if (e.currentTarget instanceof HTMLElement) {
        e.currentTarget.style.opacity = "0.5";
      }
    },
    [],
  );

  const handleDragOver = useCallback(
    (columnId: string, e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverId(columnId);
    },
    [],
  );

  const handleDrop = useCallback(
    (columnId: string, e: React.DragEvent) => {
      e.preventDefault();
      const fromId = e.dataTransfer.getData("text/plain");
      if (fromId && fromId !== columnId && onReorder) {
        const fromIndex = getCustomIndex(fromId);
        const toIndex = getCustomIndex(columnId);
        if (fromIndex !== -1 && toIndex !== -1) {
          onReorder(fromIndex, toIndex);
        }
      }
      setDraggedId(null);
      setDragOverId(null);
    },
    [onReorder, getCustomIndex],
  );

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "";
    }
    setDraggedId(null);
    setDragOverId(null);
  }, []);

  return { draggedId, dragOverId, handleDragStart, handleDragOver, handleDrop, handleDragEnd };
}

// Custom column resize hook — uses refs + direct DOM manipulation during drag
// to avoid React re-renders entirely. This prevents the "Maximum update depth
// exceeded" error caused by TanStack Table's internal state machine reacting
// to state changes during resize. Only triggers one React re-render on mouseup.
function useColumnResize() {
  const columnWidthsRef = useRef<Record<string, number>>({});
  const [, setRenderTrigger] = useState(0);

  // Stable getter — always reads latest from ref, never causes re-renders
  const getWidth = useCallback(
    (columnId: string, defaultWidth: number) =>
      columnWidthsRef.current[columnId] ?? defaultWidth,
    [],
  );

  const handleMouseDown = useCallback(
    (columnId: string, currentWidth: number, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = currentWidth;
      const handle = e.target as HTMLElement;

      // Visual feedback via DOM (no state)
      handle.classList.add("bg-primary", "shadow-sm");

      // Find DOM elements for direct manipulation during drag
      const container = handle.closest("[data-table-container]");
      const tableEl = container?.querySelector("table");

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const diff = moveEvent.clientX - startX;
        const newWidth = Math.max(MIN_COL_WIDTH, startWidth + diff);
        columnWidthsRef.current[columnId] = newWidth;

        // Direct DOM updates — no React re-renders during drag
        if (tableEl) {
          const colEl = tableEl.querySelector(
            `col[data-col-id="${CSS.escape(columnId)}"]`,
          );
          if (colEl) {
            (colEl as HTMLElement).style.width = `${newWidth}px`;
          }

          // Recalculate total table width from all <col> elements
          const allCols = tableEl.querySelectorAll("col");
          let total = 0;
          allCols.forEach((col) => {
            const w = (col as HTMLElement).style.width;
            total += w ? parseInt(w, 10) || 150 : 150;
          });
          tableEl.style.width = `${total}px`;
        }
      };

      const handleMouseUp = () => {
        handle.classList.remove("bg-primary", "shadow-sm");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        // Single React re-render to sync state with DOM
        setRenderTrigger((n) => n + 1);
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [],
  );

  return { getWidth, handleMouseDown };
}

type ViewMode = "charts" | "side-by-side";

interface DataTableProps {
  runs: Run[];
  orgSlug: string;
  projectName: string;
  organizationId?: string;
  onColorChange: (runId: string, color: string) => void;
  onSelectionChange: (runId: string, isSelected: boolean) => void;
  onTagsUpdate: (runId: string, tags: string[]) => void;
  onNotesUpdate: (runId: string, notes: string | null) => void;
  selectedRunsWithColors: Record<string, { run: Run; color: string }>;
  runColors: Record<string, string>;
  runCount: number;
  totalRunCount: number;
  isLoading: boolean;
  isFetching?: boolean;
  fetchNextPage?: () => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  allTags: string[];
  filters: RunFilter[];
  filterableFields: FilterableField[];
  onAddFilter: (filter: RunFilter) => void;
  onRemoveFilter: (filterId: string) => void;
  onClearFilters: () => void;
  onFieldSearch?: (search: string) => void;
  isSearchingFields?: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  // Visibility options
  onSelectFirstN: (n: number) => void;
  onSelectAllByIds: (runIds: string[]) => void;
  onDeselectAll: () => void;
  onShuffleColors: () => void;
  // Custom columns
  customColumns?: ColumnConfig[];
  availableConfigKeys?: string[];
  availableSystemMetadataKeys?: string[];
  availableMetricNames?: string[];
  onColumnToggle?: (col: ColumnConfig) => void;
  onClearColumns?: () => void;
  columnKeysLoading?: boolean;
  onColumnSearch?: (search: string) => void;
  isSearchingColumns?: boolean;
  // Column header dropdown callbacks
  onColumnRename?: (colId: string, source: string, newName: string, aggregation?: string) => void;
  onColumnSetColor?: (colId: string, source: string, color: string | undefined, aggregation?: string) => void;
  onColumnRemove?: (colId: string, source: string, aggregation?: string) => void;
  nameOverrides?: BaseColumnOverrides;
  onNameRename?: (newName: string) => void;
  onNameSetColor?: (color: string | undefined) => void;
  onReorderColumns?: (fromIndex: number, toIndex: number) => void;
  // Server-side sorting
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
  // Page size
  pageSize: number;
  onPageSizeChange: (pageSize: number) => void;
  // View selector slot
  viewSelector?: React.ReactNode;
  /** Callback when a run row is hovered (for chart highlighting). Passes the run's unique SQID. */
  onRunHover?: (runId: string | null) => void;
}

export function DataTable({
  runs,
  orgSlug,
  projectName,
  organizationId,
  onColorChange,
  onSelectionChange,
  onTagsUpdate,
  onNotesUpdate,
  selectedRunsWithColors,
  runColors,
  runCount,
  totalRunCount,
  isLoading,
  isFetching,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  allTags,
  filters,
  filterableFields,
  onAddFilter,
  onRemoveFilter,
  onClearFilters,
  onFieldSearch,
  isSearchingFields,
  searchQuery,
  onSearchChange,
  viewMode,
  onViewModeChange,
  onSelectFirstN,
  onSelectAllByIds,
  onDeselectAll,
  onShuffleColors,
  customColumns = [],
  availableConfigKeys = [],
  availableSystemMetadataKeys = [],
  availableMetricNames = [],
  onColumnToggle,
  onClearColumns,
  columnKeysLoading,
  onColumnSearch,
  isSearchingColumns,
  onColumnRename,
  onColumnSetColor,
  onColumnRemove,
  nameOverrides,
  onNameRename,
  onNameSetColor,
  onReorderColumns,
  sorting,
  onSortingChange,
  pageSize,
  onPageSizeChange,
  viewSelector,
  onRunHover,
}: DataTableProps) {
  // Internal pagination state (pageIndex only — pageSize is controlled by parent)
  const [pageIndex, setPageIndex] = useState(0);

  // Custom column resize — uses refs + direct DOM manipulation during drag
  const { getWidth, handleMouseDown } = useColumnResize();

  // Drag-and-drop column reordering (custom columns only)
  const { draggedId, dragOverId, handleDragStart, handleDragOver, handleDrop, handleDragEnd } =
    useColumnDrag(customColumns, onReorderColumns);

  // Track which run row is hovered (for highlight data attribute)
  const [hoveredRunId, setHoveredRunId] = useState<string | null>(null);

  // Visibility options state
  const [showOnlySelected, setShowOnlySelected] = useState(false);

  // Filter runs based on showOnlySelected
  const displayedRuns = useMemo(() => {
    if (!showOnlySelected) return runs;
    return runs.filter((run) => selectedRunsWithColors[run.id]);
  }, [runs, showOnlySelected, selectedRunsWithColors]);

  // Keep track of previous data length to maintain pagination position
  const prevDataLengthRef = useRef(runs.length);
  const lastPageIndexRef = useRef(pageIndex);

  // Ref for stable color lookup - avoids column recreation on color changes
  const runColorsRef = useRef(runColors);
  useEffect(() => {
    runColorsRef.current = runColors;
  }, [runColors]);

  // Stable getter function for colors - doesn't change reference
  const getRunColor = useCallback((runId: string) => {
    return runColorsRef.current[runId];
  }, []);

  // Ref for stable tag lookup - avoids column recreation on tag changes
  const allTagsRef = useRef(allTags);
  useEffect(() => {
    allTagsRef.current = allTags;
  }, [allTags]);

  // Stable getter function for tags - doesn't change reference
  const getAllTags = useCallback(() => allTagsRef.current, []);

  // Calculate current row selection based on actual selectedRunsWithColors
  // This ensures the table checkboxes stay in sync with the actual selected runs
  // Optimized: only include selected rows (TanStack Table treats missing keys as false)
  const currentRowSelection = useMemo(() => {
    const selection: Record<number, boolean> = {};

    // Only add entries for selected runs - much faster than iterating all runs
    if (runs && runs.length > 0) {
      // Create a Set of selected IDs for O(1) lookup
      const selectedIds = new Set(Object.keys(selectedRunsWithColors));

      // Only iterate if there are selected runs
      if (selectedIds.size > 0) {
        runs.forEach((run, index) => {
          if (run?.id && selectedIds.has(run.id)) {
            selection[index] = true;
          }
        });
      }
    }

    return selection;
  }, [runs, selectedRunsWithColors]);

  // Memoize the columns configuration to prevent unnecessary recalculations
  // Note: getRunColor is a stable callback that uses a ref internally,
  // so column definitions don't recreate when colors change
  // Note: Visibility-related props (runs, selectedRunsWithColors, etc.) are NOT included
  // because VisibilityOptions is now rendered separately in the toolbar for better performance
  const memoizedColumns = useMemo(
    () =>
      columns({
        orgSlug,
        projectName,
        organizationId,
        onColorChange,
        onSelectionChange,
        onTagsUpdate,
        onNotesUpdate,
        getRunColor,
        getAllTags,
        customColumns,
        onColumnRename,
        onColumnSetColor,
        onColumnRemove,
        nameOverrides,
        onNameRename,
        onNameSetColor,
        sorting,
        onSortingChange,
      }),
    [
      orgSlug,
      projectName,
      organizationId,
      onColorChange,
      onSelectionChange,
      onTagsUpdate,
      onNotesUpdate,
      getRunColor,
      getAllTags,
      customColumns,
      onColumnRename,
      onColumnSetColor,
      onColumnRemove,
      nameOverrides,
      onNameRename,
      onNameSetColor,
      sorting,
      onSortingChange,
    ],
  );

  // Get current page run IDs for "Select all on page" functionality
  const pageRunIds = useMemo(() => {
    const startIndex = pageIndex * pageSize;
    const endIndex = startIndex + pageSize;
    return displayedRuns.slice(startIndex, endIndex).map((run) => run.id);
  }, [displayedRuns, pageIndex, pageSize]);

  // Row selection is derived directly from currentRowSelection
  // No separate state needed - this eliminates an extra render cycle on pagination

  // Handle fetching more data without resetting pagination
  const handleFetchNextPage = async () => {
    if (fetchNextPage && !isFetchingNextPage) {
      // Store current page index before fetching
      lastPageIndexRef.current = pageIndex + 1;

      // Fetch next page of data
      await fetchNextPage();

      // We'll rely on the useEffect below to maintain the page position
    }
  };

  // Maintain pagination position when new data is loaded
  useEffect(() => {
    if (runs.length > prevDataLengthRef.current) {
      // New data was loaded, restore the page index we saved before fetching
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
    manualSorting: true, // sorting is done server-side
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
    },
    enableRowSelection: true,
    // Prevent TanStack Table from auto-resetting pagination
    autoResetPageIndex: false,
    // IMPORTANT: Do NOT add onSortingChange here — it causes infinite re-render
    // loops with the ref-based column resize. Sorting is managed manually via
    // onSortingChange called from column header dropdown menus.
  });

  // Handle Enter key press for search and pagination
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      // If on the last page and there are more pages to load, fetch next page
      const isLastPage = pageIndex >= Math.ceil(runs.length / pageSize) - 1;
      if (isLastPage && hasNextPage) {
        handleFetchNextPage();
      } else if (!isLastPage) {
        // Otherwise, just go to the next page of the currently loaded data
        table.nextPage();
      }
    }
  };

  // Only show skeleton on initial load (no data yet)
  if (isLoading && runs.length === 0) {
    return <LoadingSkeleton />;
  }

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-[200px] flex-col overflow-hidden">
      {/* Overlay spinner when refetching with existing data */}
      {isFetching && runs.length > 0 && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/50">
          <Spinner size="medium" />
        </div>
      )}
      {/* Header section - shrink-0 prevents shrinking */}
      <div className="mb-2 shrink-0 space-y-2">
        <div className="mt-2 flex items-center justify-between gap-x-3">
          <div className="min-w-0 truncate pl-1 text-sm text-muted-foreground">
            <span className="font-medium">{Object.keys(selectedRunsWithColors).length}</span>
            {" of "}
            <span className="font-medium">{totalRunCount}</span>
            {" runs selected"}
            {runCount < totalRunCount && (
              <>
                {" "}
                <span className="text-muted-foreground/50">·</span>
                {" "}
                <span className="text-muted-foreground/80">
                  Filtered to {runCount} runs
                </span>
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-9 gap-1",
                viewMode === "side-by-side" && "border-primary"
              )}
              onClick={() => onViewModeChange(viewMode === "charts" ? "side-by-side" : "charts")}
            >
              <Columns className="h-4 w-4" />
              <span className="hidden sm:inline">Side-by-side</span>
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute top-2.5 left-2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search runs..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={handleKeyDown}
              className="pl-8"
            />
          </div>
          <VisibilityOptions
            selectedRunsWithColors={selectedRunsWithColors}
            onSelectFirstN={onSelectFirstN}
            onSelectAllOnPage={onSelectAllByIds}
            onDeselectAll={onDeselectAll}
            onShuffleColors={onShuffleColors}
            showOnlySelected={showOnlySelected}
            onShowOnlySelectedChange={setShowOnlySelected}
            pageRunIds={pageRunIds}
            totalRunCount={runCount}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="shrink-0">
            {viewSelector}
          </div>
          <div className="flex items-center gap-2">
          <FilterButton
            filters={filters}
            filterableFields={filterableFields}
            activeColumnIds={customColumns}
            metricNames={availableMetricNames}
            onAddFilter={onAddFilter}
            onRemoveFilter={onRemoveFilter}
            onClearFilters={onClearFilters}
            onFieldSearch={onFieldSearch}
            isSearching={isSearchingFields}
          />
          {onColumnToggle && onClearColumns && (
            <ColumnPicker
              columns={customColumns}
              configKeys={availableConfigKeys}
              systemMetadataKeys={availableSystemMetadataKeys}
              metricNames={availableMetricNames}
              onColumnToggle={onColumnToggle}
              onClearColumns={onClearColumns}
              isLoading={columnKeysLoading}
              onColumnSearch={onColumnSearch}
              isSearching={isSearchingColumns}
            />
          )}
          </div>
        </div>
      </div>

      {/* Table section - flex-1 takes remaining space, min-h-0 allows shrinking */}
      <div className="min-h-0 flex-1 overflow-auto rounded-md border" data-table-container>
        <Table
          style={{
            tableLayout: "fixed",
            borderCollapse: "separate",
            borderSpacing: 0,
            minWidth: "100%",
            width: table.getHeaderGroups()[0]?.headers.reduce((sum, h) => {
              const def = h.column.columnDef;
              const isFixed = def.enableResizing === false;
              return sum + (isFixed ? (def.size ?? 150) : getWidth(h.column.id, def.size ?? 150));
            }, 0) ?? 0,
          }}
        >
          <colgroup>
            {table.getHeaderGroups()[0]?.headers.map((header) => {
              const def = header.column.columnDef;
              const isFixed = def.enableResizing === false;
              const w = isFixed ? (def.size ?? 150) : getWidth(header.column.id, def.size ?? 150);
              return (
                <col
                  key={header.id}
                  data-col-id={header.column.id}
                  style={{ width: w, minWidth: def.minSize ?? MIN_COL_WIDTH }}
                />
              );
            })}
          </colgroup>
          <TableHeader className="sticky top-0 z-10 bg-background">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const def = header.column.columnDef;
                    const isFixed = def.enableResizing === false;
                    const canResize = !isFixed;
                    const w = isFixed ? (def.size ?? 150) : getWidth(header.column.id, def.size ?? 150);

                    const bgColor = (header.column.columnDef.meta as any)?.backgroundColor;
                    const isCustom = header.column.id.startsWith("custom-");
                    const isDragOver = isCustom && dragOverId === header.column.id && draggedId !== header.column.id;

                    return (
                      <TableHead
                        key={header.id}
                        className={cn(
                          "group relative overflow-hidden px-2 py-2 text-left text-sm font-medium whitespace-nowrap text-muted-foreground",
                          isCustom && "cursor-grab",
                          isDragOver && "border-l-2 border-primary",
                        )}
                        style={bgColor ? { backgroundColor: `${bgColor}20` } : { backgroundColor: 'var(--background)' }}
                        draggable={isCustom}
                        onDragStart={isCustom ? (e) => handleDragStart(header.column.id, e) : undefined}
                        onDragOver={isCustom ? (e) => handleDragOver(header.column.id, e) : undefined}
                        onDrop={isCustom ? (e) => handleDrop(header.column.id, e) : undefined}
                        onDragEnd={isCustom ? handleDragEnd : undefined}
                      >
                        <div className="flex items-center gap-1">
                          {isCustom && (
                            <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                          )}
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                        </div>
                        {canResize && (
                          <div
                            onMouseDown={(e) => handleMouseDown(header.column.id, w, e)}
                            className="absolute top-0 right-0 h-full w-1 cursor-col-resize select-none touch-none bg-transparent transition-colors hover:bg-primary/50"
                          />
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-run-id={row.original.id}
                    data-run-name={row.original.name}
                    data-state={row.getIsSelected() ? "selected" : ""}
                    data-hover-highlight={hoveredRunId === row.original.id ? "true" : undefined}
                    onMouseEnter={() => {
                      // Only highlight selected runs (those with visible chart curves)
                      if (row.getIsSelected()) {
                        setHoveredRunId(row.original.id);
                        onRunHover?.(row.original.id);
                      }
                    }}
                    onMouseLeave={() => {
                      setHoveredRunId(null);
                      onRunHover?.(null);
                    }}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const cellBgColor = (cell.column.columnDef.meta as any)?.backgroundColor;
                      return (
                        <TableCell
                          key={cell.id}
                          className="px-2 py-2 text-sm"
                          style={cellBgColor ? { backgroundColor: `${cellBgColor}10` } : undefined}
                        >
                          <div className="truncate">
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </div>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={memoizedColumns.length}
                    className="h-16 text-center text-sm text-muted-foreground"
                  >
                    No runs found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
      </div>

      {/* Paginator section - shrink-0 prevents shrinking, stays at bottom */}
      <div className="flex shrink-0 items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          <Select
            value={`${table.getState().pagination.pageSize}`}
            onValueChange={(value) => table.setPageSize(Number(value))}
          >
            <SelectTrigger className="">
              <span className="text-xs">
                {table.getState().pagination.pageSize}
              </span>
            </SelectTrigger>
          <SelectContent side="top">
            {[5, 10, 15, 20, 50, 100].map((pageSizeVal) => (
              <SelectItem key={pageSizeVal} value={`${pageSizeVal}`}>
                <span className="text-xs">{pageSizeVal} Rows</span>
              </SelectItem>
            ))}
          </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <span className="w-28 text-center text-sm">
            {Math.min(
              table.getState().pagination.pageIndex + 1,
              Math.max(
                1,
                Math.ceil(runCount / table.getState().pagination.pageSize),
              ),
            )}
            /
            {Math.max(
              1,
              Math.ceil(runCount / table.getState().pagination.pageSize),
            )}
          </span>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              // If on the last page and there are more pages to load, fetch next page
              const isLastPage =
                pageIndex >= Math.ceil(runs.length / pageSize) - 1;
              if (isLastPage && hasNextPage) {
                handleFetchNextPage();
              } else {
                table.nextPage();
              }
            }}
            disabled={!table.getCanNextPage() && !hasNextPage}
            loading={isFetchingNextPage}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

const LoadingSkeleton = () => {
  return (
    <div className="flex h-full w-full min-w-[200px] flex-col">
      <div className="mb-2 space-y-2">
        <div className="mt-2 flex items-center gap-1 pl-1">
          <Skeleton className="h-5 w-24" />
        </div>
        <div className="relative">
          <Skeleton className="h-9 w-full" />
        </div>
      </div>

      <div className="flex-1 overflow-hidden rounded-md border">
        <div className="h-full overflow-y-auto">
          <Skeleton className="h-full w-full" />
        </div>
      </div>
    </div>
  );
};
