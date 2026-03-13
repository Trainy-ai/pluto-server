import React from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import type { Table as TanStackTable } from "@tanstack/react-table";
import type { Run } from "../../../~queries/list-runs";

interface TablePaginationProps {
  table: TanStackTable<Run>;
  runCount: number;
  pinnedRunCount: number;
  isPinningActive: boolean;
  pageIndex: number;
  pageSize: number;
  runsLength: number;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onFetchNextPage: () => void;
}

export function TablePagination({
  table,
  runCount,
  pinnedRunCount,
  isPinningActive,
  pageIndex,
  pageSize,
  runsLength,
  hasNextPage,
  isFetchingNextPage,
  onFetchNextPage,
}: TablePaginationProps) {
  return (
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
          {(() => {
            const effectiveCount = isPinningActive
              ? runCount - pinnedRunCount
              : runCount;
            const totalPages = Math.max(
              1,
              Math.ceil(effectiveCount / table.getState().pagination.pageSize),
            );
            return `${Math.min(table.getState().pagination.pageIndex + 1, totalPages)}/${totalPages}`;
          })()}
        </span>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            const nextPageEnd = (pageIndex + 2) * pageSize;
            const nextPageHasEnoughData = runsLength >= nextPageEnd;
            if (!nextPageHasEnoughData && hasNextPage) {
              // Next page doesn't have a full set of rows yet — fetch more
              // data first; the useEffect will advance to the target page
              // once the new data arrives.
              onFetchNextPage();
            } else {
              table.nextPage();
            }
          }}
          disabled={(!table.getCanNextPage() && !hasNextPage) || isFetchingNextPage}
          loading={isFetchingNextPage}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
