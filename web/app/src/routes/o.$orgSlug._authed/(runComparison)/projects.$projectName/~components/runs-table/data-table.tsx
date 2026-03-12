"use client";

import React from "react";
import { flexRender, type SortingState } from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRef, useMemo, useCallback, useEffect } from "react";
import { GripVertical } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { columns } from "./columns";
import type { Run } from "../../~queries/list-runs";
import type { ColumnConfig, BaseColumnOverrides } from "../../~hooks/use-column-config";
import type { RunFilter, FilterableField } from "@/lib/run-filters";
import type { Header } from "@tanstack/react-table";
import { computePinnedColumnIds } from "./lib/pinned-columns";
import { MIN_COL_WIDTH } from "./hooks/use-column-resize";
import { useDataTableState } from "./hooks/use-data-table-state";
import { TableToolbar } from "./components/table-toolbar";
import { TablePagination } from "./components/table-pagination";
import { RunRow } from "./components/run-row";

type ViewMode = "charts" | "side-by-side";

interface DataTableProps {
  runs: Run[];
  orgSlug: string;
  projectName: string;
  organizationId?: string;
  onColorChange: (runId: string, color: string) => void;
  onSelectionChange: (runId: string, isSelected: boolean) => void;
  onToggleVisibility: (runId: string) => void;
  onTagsUpdate: (runId: string, tags: string[]) => void;
  onNotesUpdate: (runId: string, notes: string | null) => void;
  selectedRunsWithColors: Record<string, { run: Run; color: string }>;
  hiddenRunIds: Set<string>;
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
  panelLayout?: "both" | "list-only" | "graphs-only";
  onToggleListPanel?: () => void;
  onToggleGraphsPanel?: () => void;
  onSelectFirstN: (n: number) => void;
  onSelectAllByIds: (runIds: string[]) => void;
  onDeselectAll: () => void;
  onShuffleColors: () => void;
  onReassignAllColors: () => void;
  onShowAllRuns: () => void;
  onHideAllRuns: () => void;
  customColumns?: ColumnConfig[];
  availableConfigKeys?: string[];
  availableSystemMetadataKeys?: string[];
  availableMetricNames?: string[];
  onColumnToggle?: (col: ColumnConfig) => void;
  onClearColumns?: () => void;
  columnKeysLoading?: boolean;
  onColumnSearch?: (search: string) => void;
  isSearchingColumns?: boolean;
  onColumnRename?: (colId: string, source: string, newName: string, aggregation?: string) => void;
  onColumnSetColor?: (colId: string, source: string, color: string | undefined, aggregation?: string) => void;
  onColumnRemove?: (colId: string, source: string, aggregation?: string) => void;
  nameOverrides?: BaseColumnOverrides;
  onNameRename?: (newName: string) => void;
  onNameSetColor?: (color: string | undefined) => void;
  onReorderColumns?: (fromIndex: number, toIndex: number) => void;
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
  pageSize: number;
  onPageSizeChange: (pageSize: number) => void;
  viewSelector?: React.ReactNode;
  activeChartViewId?: string | null;
  onToggleColumnPin?: (colId: string, source: string, aggregation?: string) => void;
}

export function DataTable({
  runs,
  orgSlug,
  projectName,
  organizationId,
  onColorChange,
  onSelectionChange,
  onToggleVisibility,
  onTagsUpdate,
  onNotesUpdate,
  selectedRunsWithColors,
  hiddenRunIds,
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
  panelLayout = "both",
  onToggleListPanel,
  onToggleGraphsPanel,
  onSelectFirstN,
  onSelectAllByIds,
  onDeselectAll,
  onShuffleColors,
  onReassignAllColors,
  onShowAllRuns,
  onHideAllRuns,
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
  activeChartViewId,
  onToggleColumnPin,
}: DataTableProps) {
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);

  // Ref-based stable getters to avoid column recreation on every color/tag change
  const runColorsRef = useRef(runColors);
  useEffect(() => { runColorsRef.current = runColors; }, [runColors]);
  const getRunColor = useCallback((runId: string) => runColorsRef.current[runId], []);

  const allTagsRef = useRef(allTags);
  useEffect(() => { allTagsRef.current = allTags; }, [allTags]);
  const getAllTags = useCallback(() => allTagsRef.current, []);

  const hiddenRunIdsRef = useRef(hiddenRunIds);
  useEffect(() => { hiddenRunIdsRef.current = hiddenRunIds; }, [hiddenRunIds]);
  const getIsHidden = useCallback((runId: string) => hiddenRunIdsRef.current.has(runId), []);

  const pinnedColumnIds = useMemo(
    () => computePinnedColumnIds(customColumns),
    [customColumns],
  );

  // Build column definitions (depends on stable getters above)
  const memoizedColumns = useMemo(
    () =>
      columns({
        orgSlug,
        projectName,
        organizationId,
        onColorChange,
        onSelectionChange,
        onToggleVisibility,
        onTagsUpdate,
        onNotesUpdate,
        getRunColor,
        getIsHidden,
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
        activeChartViewId,
        pinnedColumnIds,
        onToggleColumnPin,
      }),
    [
      orgSlug, projectName, organizationId,
      onColorChange, onSelectionChange, onToggleVisibility, onTagsUpdate, onNotesUpdate,
      getRunColor, getIsHidden, getAllTags, customColumns,
      onColumnRename, onColumnSetColor, onColumnRemove,
      nameOverrides, onNameRename, onNameSetColor,
      sorting, onSortingChange, activeChartViewId,
      pinnedColumnIds, onToggleColumnPin,
    ],
  );

  // Delegate all table state management to the hook
  const {
    pageIndex,
    lastPageIndexRef,
    getWidth,
    handleMouseDown,
    resizeGeneration,
    draggedId,
    dragOverId,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
    showOnlySelected,
    setShowOnlySelected,
    pinSelectedToTop,
    setPinSelectedToTop,
    isPinningActive,
    pinnedRuns,
    displayedRuns,
    pageRunIds,
    pinnedColumnMap,
    tableWidth,
    table,
    pinnedTable,
  } = useDataTableState({
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
  });

  // Handle fetching more data without resetting pagination
  const handleFetchNextPage = async () => {
    if (fetchNextPage && !isFetchingNextPage) {
      lastPageIndexRef.current = pageIndex + 1;
      await fetchNextPage();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const isLastPage = pageIndex >= Math.ceil(displayedRuns.length / pageSize) - 1;
      if (isLastPage && hasNextPage) {
        handleFetchNextPage();
      } else if (!isLastPage) {
        table.nextPage();
      }
    }
  };

  const renderColGroup = useCallback(() =>
    table.getHeaderGroups()[0]?.headers.map((header) => {
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
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table, getWidth, resizeGeneration],
  );

  const renderHeaderCell = (header: Header<Run, unknown>) => {
    const def = header.column.columnDef;
    const isFixed = def.enableResizing === false;
    const canResize = !isFixed;
    const w = isFixed ? (def.size ?? 150) : getWidth(header.column.id, def.size ?? 150);

    const bgColor = (header.column.columnDef.meta as any)?.backgroundColor;
    const isCustom = header.column.id.startsWith("custom-");
    const isDragOver = isCustom && dragOverId === header.column.id && draggedId !== header.column.id;
    const pinned = pinnedColumnMap[header.column.id];

    return (
      <TableHead
        key={header.id}
        className={cn(
          "group overflow-hidden px-2 py-2 text-left text-sm font-medium whitespace-nowrap text-muted-foreground",
          pinned ? "sticky" : "relative",
          isCustom && "cursor-grab",
          isDragOver && "border-l-2 border-primary",
        )}
        style={{
          ...(bgColor
            ? pinned
              ? { background: `linear-gradient(${bgColor}20, ${bgColor}20), hsl(var(--background))` }
              : { backgroundColor: `${bgColor}20` }
            : { backgroundColor: 'hsl(var(--background))' }),
          ...(pinned && {
            left: pinned.left,
            zIndex: 20,
            ...(pinned.isLast && { boxShadow: '3px 0 6px -2px rgba(0,0,0,0.15)' }),
          }),
        }}
        draggable={isCustom}
        onDragStart={isCustom ? (e) => handleDragStart(header.column.id, e) : undefined}
        onDragOver={isCustom ? (e) => handleDragOver(header.column.id, e) : undefined}
        onDrop={isCustom ? (e) => handleDrop(header.column.id, e) : undefined}
        onDragEnd={isCustom ? handleDragEnd : undefined}
      >
        <div className="flex items-center">
          {isCustom && (
            <GripVertical className="h-3.5 w-0 shrink-0 group-hover:w-3.5 group-hover:mr-1 overflow-hidden text-muted-foreground/40 transition-all duration-150" />
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
  };

  if (isLoading && runs.length === 0) {
    return <LoadingSkeleton />;
  }

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-[200px] flex-col overflow-hidden">
      <TableToolbar
        selectedRunsWithColors={selectedRunsWithColors}
        runCount={runCount}
        totalRunCount={totalRunCount}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        onKeyDown={handleKeyDown}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        panelLayout={panelLayout}
        onToggleListPanel={onToggleListPanel}
        onToggleGraphsPanel={onToggleGraphsPanel}
        onSelectFirstN={onSelectFirstN}
        onSelectAllByIds={onSelectAllByIds}
        onDeselectAll={onDeselectAll}
        onShuffleColors={onShuffleColors}
        onReassignAllColors={onReassignAllColors}
        hiddenCount={hiddenRunIds.size}
        onShowAllRuns={onShowAllRuns}
        onHideAllRuns={onHideAllRuns}
        showOnlySelected={showOnlySelected}
        onShowOnlySelectedChange={setShowOnlySelected}
        pinSelectedToTop={pinSelectedToTop}
        onPinSelectedToTopChange={setPinSelectedToTop}
        pageRunIds={pageRunIds}
        filters={filters}
        filterableFields={filterableFields}
        onAddFilter={onAddFilter}
        onRemoveFilter={onRemoveFilter}
        onClearFilters={onClearFilters}
        onFieldSearch={onFieldSearch}
        isSearchingFields={isSearchingFields}
        customColumns={customColumns}
        availableConfigKeys={availableConfigKeys}
        availableSystemMetadataKeys={availableSystemMetadataKeys}
        availableMetricNames={availableMetricNames}
        onColumnToggle={onColumnToggle}
        onClearColumns={onClearColumns}
        columnKeysLoading={columnKeysLoading}
        onColumnSearch={onColumnSearch}
        isSearchingColumns={isSearchingColumns}
        viewSelector={viewSelector}
      />

      <div className="min-h-0 flex-1 flex flex-col overflow-hidden rounded-md border">
        {isPinningActive ? (
          <div ref={mainScrollRef} className="min-h-0 flex-1 overflow-auto" data-table-container>
            <div className="sticky top-0 z-10 border-b-2 border-primary/30 bg-background">
              <Table
                wrapperClassName="!overflow-x-visible"
                style={{ tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0, minWidth: "100%", width: tableWidth }}
              >
                <colgroup>{renderColGroup()}</colgroup>
                <TableHeader ref={theadRef} className="bg-background">
                  {table.getHeaderGroups().map((hg) => (
                    <TableRow key={hg.id}>{hg.headers.map((h) => renderHeaderCell(h))}</TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {pinnedTable.getRowModel().rows.map((row) => (
                    <RunRow key={row.id} row={row} pinnedColumnMap={pinnedColumnMap} tableBodyRef={tableBodyRef} isHidden={hiddenRunIds.has(row.original.id)} />
                  ))}
                </TableBody>
              </Table>
            </div>
            <Table
              wrapperClassName="!overflow-x-visible"
              style={{ tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0, minWidth: "100%", width: tableWidth }}
            >
              <colgroup>{renderColGroup()}</colgroup>
              <TableBody ref={tableBodyRef}>
                {table.getRowModel().rows.length ? (
                  table.getRowModel().rows.map((row) => (
                    <RunRow key={row.id} row={row} pinnedColumnMap={pinnedColumnMap} tableBodyRef={tableBodyRef} isHidden={hiddenRunIds.has(row.original.id)} />
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={memoizedColumns.length} className="h-16 text-center text-sm text-muted-foreground">
                      No unpinned runs on this page.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div ref={mainScrollRef} className="min-h-0 flex-1 overflow-auto" data-table-container>
            <Table style={{ tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0, minWidth: "100%", width: tableWidth }}>
              <colgroup>{renderColGroup()}</colgroup>
              <TableHeader ref={theadRef} className="sticky top-0 z-10 bg-background">
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>{hg.headers.map((h) => renderHeaderCell(h))}</TableRow>
                ))}
              </TableHeader>
              <TableBody ref={tableBodyRef}>
                {table.getRowModel().rows.length ? (
                  table.getRowModel().rows.map((row) => (
                    <RunRow key={row.id} row={row} pinnedColumnMap={pinnedColumnMap} tableBodyRef={tableBodyRef} isHidden={hiddenRunIds.has(row.original.id)} />
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={memoizedColumns.length} className="h-16 text-center text-sm text-muted-foreground">
                      No runs found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <TablePagination
        table={table}
        runCount={runCount}
        pinnedRunCount={pinnedRuns.length}
        isPinningActive={isPinningActive}
        pageIndex={pageIndex}
        pageSize={pageSize}
        runsLength={displayedRuns.length}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        onFetchNextPage={handleFetchNextPage}
      />
    </div>
  );
}

const LoadingSkeleton = () => (
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
