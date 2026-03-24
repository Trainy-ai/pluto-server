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

/**
 * Pure decision logic for resolving a typed page number into a navigation action.
 * Extracted for testability — no React deps.
 */
export type PageCommitAction =
  | { type: "navigate"; relativeIndex: number }
  | { type: "jump"; absoluteIndex: number }
  | { type: "fallback"; relativeIndex: number }
  | { type: "noop" };

export function resolvePageCommit(input: {
  inputValue: string;
  totalPages: number;
  currentPage: number;
  pageBase: number;
  runsLength: number;
  pageSize: number;
  hasJumpSupport: boolean;
}): PageCommitAction {
  const parsed = parseInt(input.inputValue, 10);
  if (isNaN(parsed)) {
    return { type: "noop" };
  }

  const targetPageOneBased = Math.max(1, Math.min(parsed, input.totalPages));
  const targetAbsoluteIndex = targetPageOneBased - 1;
  const relativeIndex = targetAbsoluteIndex - input.pageBase;
  const loadedTablePages = Math.ceil(input.runsLength / input.pageSize);

  if (relativeIndex >= 0 && relativeIndex < loadedTablePages) {
    return { type: "navigate", relativeIndex };
  } else if (input.hasJumpSupport) {
    return { type: "jump", absoluteIndex: targetAbsoluteIndex };
  } else {
    return { type: "fallback", relativeIndex: Math.max(0, loadedTablePages - 1) };
  }
}

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
  pageBase?: number;
  onJumpToPage?: (absolutePageIndex: number) => void;
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
  pageBase = 0,
  onJumpToPage,
}: TablePaginationProps) {
  const effectiveCount = isPinningActive
    ? runCount - pinnedRunCount
    : runCount;
  const totalPages = Math.max(
    1,
    Math.ceil(effectiveCount / pageSize),
  );
  // Absolute display page (1-based)
  const absolutePage = pageBase + pageIndex + 1;
  const isLastAbsolutePage = absolutePage >= totalPages;

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
          onClick={() => {
            if (table.getCanPreviousPage()) {
              table.previousPage();
            } else if (pageBase > 0 && onJumpToPage) {
              // At the start of the jumped-to data — jump back
              onJumpToPage(Math.max(0, pageBase - 1));
            }
          }}
          disabled={!table.getCanPreviousPage() && pageBase === 0}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <PageInput
          table={table}
          runCount={runCount}
          pinnedRunCount={pinnedRunCount}
          isPinningActive={isPinningActive}
          hasNextPage={hasNextPage}
          runsLength={runsLength}
          pageSize={pageSize}
          onFetchNextPage={onFetchNextPage}
          pageBase={pageBase}
          onJumpToPage={onJumpToPage}
        />

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            const nextPageEnd = (pageIndex + 2) * pageSize;
            const nextPageHasEnoughData = runsLength >= nextPageEnd;
            if (!nextPageHasEnoughData && hasNextPage) {
              onFetchNextPage();
            } else {
              table.nextPage();
            }
          }}
          disabled={(isLastAbsolutePage && !hasNextPage) || isFetchingNextPage}
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
  runsLength: number;
  pageSize: number;
  onFetchNextPage: () => void;
  pageBase: number;
  onJumpToPage?: (absolutePageIndex: number) => void;
}

function PageInput({
  table,
  runCount,
  pinnedRunCount,
  isPinningActive,
  hasNextPage,
  runsLength,
  pageSize,
  onFetchNextPage,
  pageBase,
  onJumpToPage,
}: PageInputProps) {
  const effectiveCount = isPinningActive
    ? runCount - pinnedRunCount
    : runCount;
  const totalPages = Math.max(
    1,
    Math.ceil(effectiveCount / table.getState().pagination.pageSize),
  );
  // Absolute current page (1-based) accounting for the jump offset
  const tablePageIndex = table.getState().pagination.pageIndex;
  const currentPage = Math.min(pageBase + tablePageIndex + 1, totalPages);

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
    const action = resolvePageCommit({
      inputValue,
      totalPages,
      currentPage,
      pageBase,
      runsLength,
      pageSize,
      hasJumpSupport: !!onJumpToPage,
    });

    switch (action.type) {
      case "navigate":
        table.setPageIndex(action.relativeIndex);
        break;
      case "jump":
        onJumpToPage!(action.absoluteIndex);
        break;
      case "fallback":
        table.setPageIndex(action.relativeIndex);
        break;
      case "noop":
        setInputValue(String(currentPage));
        break;
    }
  }, [
    inputValue,
    totalPages,
    table,
    currentPage,
    pageBase,
    runsLength,
    pageSize,
    onJumpToPage,
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
              // Move to next absolute page
              const nextRelative = tablePageIndex + 1;
              const loadedPages = Math.ceil(runsLength / pageSize);
              if (nextRelative < loadedPages) {
                table.setPageIndex(nextRelative);
              } else if (hasNextPage) {
                // Progressive fetch — consistent with Next button behavior
                onFetchNextPage();
              } else if (onJumpToPage) {
                onJumpToPage(pageBase + nextRelative);
              }
            }
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            if (currentPage > 1) {
              if (tablePageIndex > 0) {
                table.setPageIndex(tablePageIndex - 1);
              } else if (pageBase > 0 && onJumpToPage) {
                onJumpToPage(pageBase - 1);
              }
            }
          }
        }}
      />
      <span className="text-muted-foreground">/ {totalPages}</span>
    </span>
  );
}
