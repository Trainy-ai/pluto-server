"use client";

import {
  type Column,
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type PaginationState,
  type OnChangeFn,
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

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  pageCount: number;
  pageSize?: number;
  pageIndex?: number;
  isLoading?: boolean;
  /**
   * Total rows across every page. Pagination is server-side, so `data` only
   * holds the current page and cannot be counted for the summary line.
   */
  totalCount?: number;
  /** Shown when there are no rows — lets callers explain an empty search. */
  emptyMessage?: string;
  /** Active sort. Ordering is server-side, so this is state, not an instruction. */
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  onPaginationChange?: (pagination: {
    pageIndex: number;
    pageSize: number;
  }) => void;
}

/**
 * `aria-sort` for a header cell, or undefined when the column isn't sortable —
 * the attribute is only meaningful on sortable columns.
 */
function getAriaSort<TData, TValue>(
  column: Column<TData, TValue>,
): "ascending" | "descending" | "none" | undefined {
  if (!column.getCanSort()) {
    return undefined;
  }

  const sorted = column.getIsSorted();
  if (sorted === "asc") return "ascending";
  if (sorted === "desc") return "descending";
  return "none";
}

export function DataTable<TData, TValue>({
  columns,
  data,
  pageCount,
  pageSize = 10,
  pageIndex = 0,
  isLoading = false,
  totalCount,
  emptyMessage = "No projects found.",
  sorting = [],
  onSortingChange,
  onPaginationChange,
}: DataTableProps<TData, TValue>) {
  const pagination: PaginationState = {
    pageIndex,
    pageSize,
  };

  const handlePaginationChange: OnChangeFn<PaginationState> = (
    updaterOrValue,
  ) => {
    const newPagination =
      typeof updaterOrValue === "function"
        ? updaterOrValue(pagination)
        : updaterOrValue;

    onPaginationChange?.(newPagination);
  };

  const table = useReactTable({
    data,
    columns,
    pageCount: pageCount,
    state: {
      pagination,
      sorting,
    },
    onPaginationChange: handlePaginationChange,
    onSortingChange,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    // The server orders the rows. Sorting client-side would only reorder the
    // current page, which for a 50-row page of a larger set is just wrong.
    manualSorting: true,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={getAriaSort(header.column)}
                      className="px-4 py-3 text-left text-sm font-medium whitespace-nowrap text-muted-foreground"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  data-testid="projects-table-loading"
                  className="h-24 text-center text-sm"
                >
                  <div className="flex items-center justify-center">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  </div>
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className="hover:bg-muted/50"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="px-4 py-3 text-sm">
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
                  colSpan={columns.length}
                  className="h-24 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between px-2">
        <div className="flex-1 text-sm text-muted-foreground">
          {totalCount ?? table.getFilteredRowModel().rows.length} project(s)
          total
        </div>
        <div className="flex items-center space-x-6 lg:space-x-8">
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              className="hidden h-8 w-8 p-0 lg:flex"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage() || isLoading}
            >
              <span className="sr-only">Go to first page</span>
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              className="h-8 w-8 p-0"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage() || isLoading}
            >
              <span className="sr-only">Go to previous page</span>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center justify-center text-sm font-medium">
              Page {table.getState().pagination.pageIndex + 1} of{" "}
              {/* A search with no matches yields 0 pages; the user is still
                  looking at page 1, so never render "Page 1 of 0". */}
              {Math.max(table.getPageCount(), 1)}
            </div>
            <Button
              variant="outline"
              className="h-8 w-8 p-0"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage() || isLoading}
            >
              <span className="sr-only">Go to next page</span>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              className="hidden h-8 w-8 p-0 lg:flex"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage() || isLoading}
            >
              <span className="sr-only">Go to last page</span>
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
