"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getPaginationRowModel,
  getFilteredRowModel,
  type PaginationState,
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
import { columns } from "./columns";
import type { Run } from "../../~queries/list-runs";
import { DEFAULT_PAGE_SIZE } from "./config";

interface DataTableProps {
  runs: Run[];
  orgSlug: string;
  projectName: string;
  onColorChange: (runId: string, color: string) => void;
  onSelectionChange: (runId: string, isSelected: boolean) => void;
  selectedRunsWithColors: Record<string, { run: Run; color: string }>;
  runColors: Record<string, string>;
  defaultRowSelection?: Record<number, boolean>;
  runCount: number;
  isLoading: boolean;
  fetchNextPage?: () => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
}

export function DataTable({
  runs,
  orgSlug,
  projectName,
  onColorChange,
  onSelectionChange,
  selectedRunsWithColors,
  runColors,
  defaultRowSelection = {},
  runCount,
  isLoading,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
}: DataTableProps) {
  // Internal pagination state
  const [{ pageIndex, pageSize }, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const [globalFilter, setGlobalFilter] = useState("");

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
        runColors,
      }),
    [orgSlug, projectName, onColorChange, onSelectionChange, runColors],
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
    state: {
      rowSelection,
      pagination: { pageIndex, pageSize },
      globalFilter,
    },
    enableRowSelection: true,
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

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  return (
    <div className="flex h-full w-52 flex-col">
      <div className="mb-2 space-y-2">
        <div className="mt-2 flex items-center gap-1 pl-1 text-sm text-muted-foreground">
          <span className="font-medium">
            {table.getSelectedRowModel().rows.length}
          </span>
          <span>of</span>
          <span className="font-medium">{runCount}</span>
          <span>runs selected</span>
        </div>
        <div className="relative">
          <Search className="absolute top-2.5 left-2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search runs..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            onKeyDown={handleKeyDown}
            className="pl-8"
          />
        </div>
      </div>

      <div className="flex-1 overflow-hidden rounded-md border">
        <div className="h-full overflow-y-auto">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className="sticky top-0 bg-background px-2 py-2 text-left text-sm font-medium whitespace-nowrap text-muted-foreground"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
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
                        className="truncate px-2 py-2 text-sm"
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
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
    <div className="flex h-full w-52 flex-col">
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
