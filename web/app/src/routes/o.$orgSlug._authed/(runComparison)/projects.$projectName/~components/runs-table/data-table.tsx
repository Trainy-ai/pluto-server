"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getPaginationRowModel,
  getFilteredRowModel,
  type PaginationState,
  type ColumnSizingState,
} from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
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
import { DEFAULT_PAGE_SIZE } from "./config";
import { TagsFilter } from "./tags-filter";
import { StatusFilter } from "./status-filter";

interface DataTableProps {
  runs: Run[];
  orgSlug: string;
  projectName: string;
  onColorChange: (runId: string, color: string) => void;
  onSelectionChange: (runId: string, isSelected: boolean) => void;
  onTagsUpdate: (runId: string, tags: string[]) => void;
  selectedRunsWithColors: Record<string, { run: Run; color: string }>;
  runColors: Record<string, string>;
  defaultRowSelection?: Record<number, boolean>;
  runCount: number;
  isLoading: boolean;
  isFetching?: boolean;
  fetchNextPage?: () => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  allTags: string[];
  selectedTags: string[];
  onTagFilterChange: (tags: string[]) => void;
  selectedStatuses: string[];
  onStatusFilterChange: (statuses: string[]) => void;
}

export function DataTable({
  runs,
  orgSlug,
  projectName,
  onColorChange,
  onSelectionChange,
  onTagsUpdate,
  selectedRunsWithColors,
  runColors,
  defaultRowSelection = {},
  runCount,
  isLoading,
  isFetching,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  allTags,
  selectedTags,
  onTagFilterChange,
  selectedStatuses,
  onStatusFilterChange,
}: DataTableProps) {
  // Internal pagination state
  const [{ pageIndex, pageSize }, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const [globalFilter, setGlobalFilter] = useState("");

  // Column sizing state for resizable columns
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});

  // Keep track of previous data length to maintain pagination position
  const prevDataLengthRef = useRef(runs.length);
  const lastPageIndexRef = useRef(pageIndex);

  // Calculate current row selection based on actual selectedRunsWithColors
  // This ensures the table checkboxes stay in sync with the actual selected runs
  const currentRowSelection = useMemo(() => {
    const selection: Record<number, boolean> = {};

    // Map through the runs array to find indices of selected runs
    if (runs && runs.length > 0) {
      runs.forEach((run, index) => {
        if (run && run.id && selectedRunsWithColors[run.id]) {
          selection[index] = true;
        } else {
          selection[index] = false;
        }
      });
    }

    return selection;
  }, [runs, selectedRunsWithColors]);

  // Memoize the columns configuration to prevent unnecessary recalculations
  const memoizedColumns = useMemo(
    () =>
      columns({
        orgSlug,
        projectName,
        onColorChange,
        onSelectionChange,
        onTagsUpdate,
        runColors,
        allTags,
      }),
    [orgSlug, projectName, onColorChange, onSelectionChange, onTagsUpdate, runColors, allTags],
  );

  // Initialize rowSelection with defaultRowSelection but keep it synced with incoming props
  const [rowSelection, setRowSelection] = useState(currentRowSelection);

  // Update rowSelection when currentRowSelection changes
  useEffect(() => {
    setRowSelection(currentRowSelection);
  }, [currentRowSelection]);

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
        setPagination((prev) => ({
          ...prev,
          pageIndex: lastPageIndexRef.current,
        }));
      }

      prevDataLengthRef.current = runs.length;
    }
  }, [runs.length, pageIndex]);

  // Reset prevDataLengthRef when pageSize changes
  useEffect(() => {
    prevDataLengthRef.current = runs.length;
  }, [pageSize, runs.length]);

  const table = useReactTable({
    data: runs,
    columns: memoizedColumns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: setPagination,
    onColumnSizingChange: setColumnSizing,
    state: {
      rowSelection,
      pagination: { pageIndex, pageSize },
      globalFilter,
      columnSizing,
    },
    enableRowSelection: true,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    // Prevent TanStack Table from auto-resetting pagination
    autoResetPageIndex: false,
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
    <div className="relative flex w-full min-w-[200px] flex-col">
      {/* Overlay spinner when refetching with existing data */}
      {isFetching && runs.length > 0 && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/50">
          <Spinner size="medium" />
        </div>
      )}
      <div className="mb-2 space-y-2">
        <div className="mt-2 flex items-center gap-1 pl-1 text-sm text-muted-foreground">
          <span className="font-medium">
            {table.getSelectedRowModel().rows.length}
          </span>
          <span>of</span>
          <span className="font-medium">{runCount}</span>
          <span>runs selected</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute top-2.5 left-2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search runs..."
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              onKeyDown={handleKeyDown}
              className="pl-8"
            />
          </div>
          <TagsFilter
            allTags={allTags}
            selectedTags={selectedTags}
            onTagFilterChange={onTagFilterChange}
          />
          <StatusFilter
            selectedStatuses={selectedStatuses}
            onStatusFilterChange={onStatusFilterChange}
          />
        </div>
      </div>

      <div className="rounded-md border overflow-x-auto">
        <Table className="w-full">
          <TableHeader className="sticky top-0 z-10 bg-background">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className="relative bg-background px-2 py-2 text-left text-sm font-medium whitespace-nowrap text-muted-foreground"
                      style={{
                        width: header.getSize(),
                        minWidth: header.column.columnDef.minSize,
                        maxWidth: header.column.columnDef.maxSize,
                      }}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                      {header.column.getCanResize() && (
                        <div
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          className={cn(
                            "absolute top-0 right-0 h-full w-1 cursor-col-resize select-none touch-none bg-border/50 hover:bg-primary/70 transition-colors duration-150",
                            header.column.getIsResizing() && "bg-primary shadow-sm"
                          )}
                        />
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() ? "selected" : ""}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className="px-2 py-2 text-sm"
                        style={{
                          width: cell.column.getSize(),
                          minWidth: cell.column.columnDef.minSize,
                          maxWidth: cell.column.columnDef.maxSize,
                        }}
                      >
                        <div className="truncate">
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </div>
                      </TableCell>
                    ))}
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

      <div className="mt-2 flex items-center justify-between">
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
            {[5, 10, 15, 20].map((pageSizeVal) => (
              <SelectItem key={pageSizeVal} value={`${pageSizeVal}`}>
                <span className="text-xs">{pageSizeVal} Rows</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

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

          <span className="w-14 text-center text-sm">
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
