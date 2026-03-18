import React, { useState, useEffect, useCallback } from "react";
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

        <PageInput
          table={table}
          runCount={runCount}
          pinnedRunCount={pinnedRunCount}
          isPinningActive={isPinningActive}
          hasNextPage={hasNextPage}
          onFetchNextPage={onFetchNextPage}
        />

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

interface PageInputProps {
  table: TanStackTable<Run>;
  runCount: number;
  pinnedRunCount: number;
  isPinningActive: boolean;
  hasNextPage?: boolean;
  onFetchNextPage: () => void;
}

function PageInput({
  table,
  runCount,
  pinnedRunCount,
  isPinningActive,
  hasNextPage,
  onFetchNextPage,
}: PageInputProps) {
  const effectiveCount = isPinningActive
    ? runCount - pinnedRunCount
    : runCount;
  const totalPages = Math.max(
    1,
    Math.ceil(effectiveCount / table.getState().pagination.pageSize),
  );
  const currentPage = Math.min(
    table.getState().pagination.pageIndex + 1,
    totalPages,
  );

  const [inputValue, setInputValue] = useState(String(currentPage));
  const [isEditing, setIsEditing] = useState(false);
  const cancelBlurRef = React.useRef(false);

  useEffect(() => {
    if (!isEditing) {
      setInputValue(String(currentPage));
    }
  }, [currentPage, isEditing]);

  const commitPage = useCallback(() => {
    setIsEditing(false);
    const parsed = parseInt(inputValue, 10);

    if (isNaN(parsed)) {
      setInputValue(String(currentPage));
      return;
    }

    const targetPageOneBased = Math.max(1, Math.min(parsed, totalPages));
    const targetPageIndex = targetPageOneBased - 1;
    const availablePages = table.getPageCount();

    if (targetPageIndex < availablePages) {
      table.setPageIndex(targetPageIndex);
    } else if (hasNextPage) {
      table.setPageIndex(availablePages - 1);
      onFetchNextPage();
    } else {
      table.setPageIndex(availablePages - 1);
    }
  }, [
    inputValue,
    totalPages,
    table,
    currentPage,
    hasNextPage,
    onFetchNextPage,
  ]);

  return (
    <span className="flex items-center gap-0.5 text-sm" data-testid="page-indicator">
      <input
        type="text"
        inputMode="numeric"
        data-testid="page-input"
        className="h-6 w-10 rounded border border-transparent bg-transparent text-center text-sm focus:border-border focus:outline-none"
        value={isEditing ? inputValue : String(currentPage)}
        onChange={(e) => setInputValue(e.target.value)}
        onFocus={(e) => {
          setIsEditing(true);
          e.target.select();
        }}
        onBlur={() => {
          if (cancelBlurRef.current) {
            cancelBlurRef.current = false;
            return;
          }
          commitPage();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commitPage();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            cancelBlurRef.current = true;
            setIsEditing(false);
            setInputValue(String(currentPage));
            e.currentTarget.blur();
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (currentPage < totalPages) {
              table.setPageIndex(currentPage); // currentPage is 1-based, so this goes to next
            }
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            if (currentPage > 1) {
              table.setPageIndex(currentPage - 2); // go to previous page
            }
          }
        }}
      />
      <span className="text-muted-foreground">/ {totalPages}</span>
    </span>
  );
}
