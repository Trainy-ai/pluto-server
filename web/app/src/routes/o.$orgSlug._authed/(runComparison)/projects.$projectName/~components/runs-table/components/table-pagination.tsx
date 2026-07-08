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
  /** Slice size for the *unpinned* table when pin-selected-to-top is on
   *  (= `pageSize - pinnedCount`, floored at 0). Used for totalPages /
   *  next-page-fetch math so the user sees exactly `pageSize` rows total
   *  per page (pinned + unpinned). When 0, `totalPages` collapses to 1
   *  because the pinned rows already fill the user's pageSize budget. */
  effectivePageSize?: number;
  /** When "display only selected" is on, the table renders just the
   *  selected runs (mergeSelectedRuns), so the server's `runCount` is
   *  irrelevant for pagination — `totalPages` should derive from
   *  `runsLength` only. Without this, the indicator inherits the
   *  server's filter total (e.g. "1 / 3" for 59 filtered runs even
   *  though only 16 are actually displayed). */
  displayOnlySelected?: boolean;
  runsLength: number;
  /** Rows the server has actually returned across all fetched
   *  runs.list pages. Drives the *fetch trigger* (Next button +
   *  typed-page-input) — decoupled from `runsLength`, which is
   *  inflated by URL-prefetched / cached selection runs and would
   *  otherwise falsely satisfy the threshold. Defaults to `runsLength`
   *  when omitted so callers that don't yet pass it keep working. */
  serverFetchedCount?: number;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onFetchNextPage: () => void;
  pageBase?: number;
  onJumpToPage?: (absolutePageIndex: number) => void;
  /** "runs" (default) shows X Rows in the dropdown and drives the
   *  TanStack table's flat pagination. "groups" shows X Groups and
   *  drives an external page-index controlled by the parent
   *  (GroupedBucketTree's root-level offset). The two paths share
   *  the same UI shell but route prev/next + totals differently. */
  mode?: "runs" | "groups";
  /** Required when mode="groups". Current zero-based page of top-level
   *  bucket values. */
  groupPageIndex?: number;
  /** Required when mode="groups". True if the root bucket query
   *  returned `hasMore` (server uses LIMIT+1 to avoid a COUNT). */
  groupHasMore?: boolean;
  /** Required when mode="groups". Setter for the group page index;
   *  the bucket tree's root-level offset is `groupPageIndex *
   *  pageSize`. */
  onGroupPageIndexChange?: (next: number) => void;
  /** Required when mode="groups". Total top-level bucket count from
   *  `distinctGroupValues.totalCount` — drives the `1 / N` indicator
   *  + editable page-input. Falls back to `Page N` when 0 (still
   *  loading first response). */
  groupTotalCount?: number;
}

export function TablePagination({
  table,
  runCount,
  pinnedRunCount,
  isPinningActive,
  pageIndex,
  pageSize,
  effectivePageSize,
  displayOnlySelected,
  runsLength,
  serverFetchedCount,
  hasNextPage,
  isFetchingNextPage,
  onFetchNextPage,
  pageBase = 0,
  onJumpToPage,
  mode = "runs",
  groupPageIndex = 0,
  groupHasMore = false,
  onGroupPageIndexChange,
  groupTotalCount = 0,
}: TablePaginationProps) {
  const isGroupsMode = mode === "groups";
  // ceil(N / pageSize), floored at 1 so an empty result still shows
  // "1 / 1" rather than divide-by-zero noise.
  const groupTotalPages = Math.max(
    1,
    Math.ceil(groupTotalCount / pageSize),
  );
  // `runCount` is the server-side filter total. `runsLength` is the size of
  // the actual table-data array (= filter-matching rows + sticky-selected
  // rows that fall outside the filter and were appended client-side). When
  // the latter exceeds the former, the trailing sticky rows live past the
  // filter's last page — bump effectiveCount so the user can reach them.
  const baseCount = isPinningActive
    ? runCount - pinnedRunCount
    : runCount;
  // With display-only-selected on, the table only contains selected
  // runs — `runCount` (= server filter total) doesn't bound pagination
  // anymore. Use just `runsLength` so totalPages reflects only what
  // the user can actually navigate to.
  const effectiveCount = displayOnlySelected
    ? runsLength
    : Math.max(baseCount, runsLength);
  // When pin-to-top fills the user's pageSize budget entirely (pinned
  // >= pageSize), the unpinned section has no room left and pagination
  // collapses to 1/1 until the user deselects below the cap.
  // Otherwise, each page renders `pageSize - pinned` unpinned rows on
  // top of the always-on pinned block, so total pages = ceil(unpinned /
  // (pageSize - pinned)).
  const slicePerPage = isPinningActive
    ? (effectivePageSize ?? Math.max(0, pageSize - pinnedRunCount))
    : pageSize;
  const totalPages = isPinningActive && slicePerPage === 0
    ? 1
    : Math.max(1, Math.ceil(effectiveCount / Math.max(1, slicePerPage)));
  // Absolute display page (1-based)
  const absolutePage = pageBase + pageIndex + 1;
  const isLastAbsolutePage = absolutePage >= totalPages;

  // Groups mode: prev/next operate on the externally-controlled
  // `groupPageIndex`. We don't know total pages (no COUNT) so the
  // disable conditions key on `groupHasMore` and `groupPageIndex>0`.
  const canGoPrev = isGroupsMode
    ? groupPageIndex > 0
    : table.getCanPreviousPage() || pageBase > 0;
  // Prefer the authoritative totalCount when we have it (totalCount>0
  // means the root query has landed). Falls back to `groupHasMore`
  // during the first load so Next isn't dead before totalCount
  // arrives.
  // Don't enable Next on the last UI page even if hasNextPage is still
  // true — a click there fetches but doesn't visibly advance the page,
  // which read as a UX bug (lit arrow that does nothing). Any
  // pre-fetching is the auto-fill effect's job.
  const canGoNext = isGroupsMode
    ? (groupTotalCount > 0
      ? groupPageIndex + 1 < groupTotalPages
      : groupHasMore)
    : !isLastAbsolutePage && !isFetchingNextPage;
  const onPrev = isGroupsMode
    ? () => onGroupPageIndexChange?.(Math.max(0, groupPageIndex - 1))
    : () => {
        if (table.getCanPreviousPage()) {
          table.previousPage();
        } else if (pageBase > 0 && onJumpToPage) {
          onJumpToPage(Math.max(0, pageBase - 1));
        }
      };
  // Server-fetched runs count, used for the fetch trigger decision so
  // URL-prefetched / cached selection runs (which inflate `runsLength`)
  // don't trick us into skipping a needed runs.list fetch. Falls back
  // to `runsLength` when the caller hasn't wired the new prop yet.
  const fetchThreshold = serverFetchedCount ?? runsLength;

  const onNext = isGroupsMode
    ? () => onGroupPageIndexChange?.(groupPageIndex + 1)
    : () => {
        // Use slicePerPage so the prefetch trigger matches the unpinned
        // slice size (the per-page advance) — not the user's chosen
        // pageSize. Otherwise pin-to-top under-prefetches the table.
        const nextPageEnd = (pageIndex + 2) * Math.max(1, slicePerPage);
        const nextPageHasEnoughData = fetchThreshold >= nextPageEnd;
        if (!nextPageHasEnoughData && hasNextPage) {
          onFetchNextPage();
        } else {
          table.nextPage();
        }
      };

  return (
    <div className="flex shrink-0 items-center justify-between pt-2">
      <div className="flex items-center gap-2">
        <Select
          // Use the user-facing `pageSize` prop, not table state — when
          // pin-to-top is active, table state is the (smaller) unpinned
          // slice size and we don't want the dropdown to flicker between
          // numbers as the user (de)selects.
          value={`${pageSize}`}
          onValueChange={(value) => table.setPageSize(Number(value))}
        >
          <SelectTrigger className="">
            <span className="text-xs">
              {pageSize}
            </span>
          </SelectTrigger>
          <SelectContent side="top">
            {[5, 10, 15, 20, 50, 100].map((pageSizeVal) => (
              <SelectItem key={pageSizeVal} value={`${pageSizeVal}`}>
                <span className="text-xs">
                  {pageSizeVal} {isGroupsMode ? "Groups" : "Rows"}
                </span>
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
          onClick={onPrev}
          disabled={!canGoPrev}
          data-testid="pagination-prev-btn"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {isGroupsMode ? (
          // Phase 10-D wandb-parity: `distinctGroupValues.totalCount`
          // gives the authoritative total bucket count, so render
          // `<input> / N` exactly like the flat-mode PageInput. While
          // totalCount === 0 (first paint, before the root query has
          // landed) we still show `Page 1` as a graceful fallback so
          // the indicator isn't blank during initial load.
          groupTotalCount > 0 ? (
            <GroupPageInput
              currentPage={groupPageIndex + 1}
              totalPages={groupTotalPages}
              onJumpToPage={(page1Based) =>
                onGroupPageIndexChange?.(Math.max(0, page1Based - 1))
              }
            />
          ) : (
            <span className="flex items-center gap-1 px-2 text-sm" data-testid="page-indicator">
              <span>Page {groupPageIndex + 1}</span>
            </span>
          )
        ) : (
          <PageInput
            table={table}
            runCount={runCount}
            pinnedRunCount={pinnedRunCount}
            isPinningActive={isPinningActive}
            hasNextPage={hasNextPage}
            runsLength={runsLength}
            serverFetchedCount={fetchThreshold}
            pageSize={pageSize}
            slicePerPage={slicePerPage}
            displayOnlySelected={displayOnlySelected}
            onFetchNextPage={onFetchNextPage}
            pageBase={pageBase}
            onJumpToPage={onJumpToPage}
          />
        )}

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onNext}
          disabled={!canGoNext}
          loading={!isGroupsMode && isFetchingNextPage}
          data-testid="pagination-next-btn"
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
  /** Mirror of TablePagination's slicePerPage — drives totalPages math
   *  identically so the indicator and the parent agree on the page count
   *  when pin-to-top is active. */
  slicePerPage: number;
  /** Mirrors TablePagination's flag — see comment there. */
  displayOnlySelected?: boolean;
  /** Server-fetched rows count — drives the resolvePageCommit
   *  "navigate vs fetch/jump" decision and ArrowUp's loadedPages calc.
   *  Decoupled from `runsLength` (which is the inflated
   *  displayedRuns.length). Falls back to `runsLength` when omitted. */
  serverFetchedCount?: number;
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
  slicePerPage,
  displayOnlySelected,
  serverFetchedCount,
  onFetchNextPage,
  pageBase,
  onJumpToPage,
}: PageInputProps) {
  const fetchThreshold = serverFetchedCount ?? runsLength;
  // See note in <TablePagination>: bump effectiveCount so sticky-selected
  // rows outside the filter still get their own UI page.
  const baseCount = isPinningActive
    ? runCount - pinnedRunCount
    : runCount;
  const effectiveCount = displayOnlySelected
    ? runsLength
    : Math.max(baseCount, runsLength);
  const totalPages = isPinningActive && slicePerPage === 0
    ? 1
    : Math.max(1, Math.ceil(effectiveCount / Math.max(1, slicePerPage)));
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
      // Use server-fetched count so URL-prefetched / cached selection
      // runs don't falsely make the target page look "already loaded"
      // and skip a needed fetch / jump.
      runsLength: fetchThreshold,
      // Pass slicePerPage as pageSize so loadedTablePages math in
      // resolvePageCommit matches the displayed pagination semantics
      // when pin-to-top is active.
      pageSize: Math.max(1, slicePerPage),
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
    fetchThreshold,
    slicePerPage,
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
              // Server count — matches the commitPage fetch decision.
              const loadedPages = Math.ceil(fetchThreshold / Math.max(1, slicePerPage));
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

/** Lighter-weight page-input used in groups mode. Doesn't carry the
 *  flat-mode runs/pinning math — group state is owned externally
 *  (`groupedPageIndex` in data-table.tsx) so the local concern is
 *  just "parse user input, clamp to [1, totalPages], emit jump". */
function GroupPageInput({
  currentPage,
  totalPages,
  onJumpToPage,
}: {
  currentPage: number;
  totalPages: number;
  onJumpToPage: (page1Based: number) => void;
}) {
  const [inputValue, setInputValue] = useState(String(currentPage));
  const [isEditing, setIsEditing] = useState(false);
  const cancelBlurRef = React.useRef(false);

  useEffect(() => {
    if (!isEditing) {
      setInputValue(String(currentPage));
    }
  }, [currentPage, isEditing]);

  const commit = useCallback(() => {
    setIsEditing(false);
    const parsed = parseInt(inputValue, 10);
    if (isNaN(parsed)) {
      setInputValue(String(currentPage));
      return;
    }
    const clamped = Math.max(1, Math.min(parsed, totalPages));
    onJumpToPage(clamped);
  }, [inputValue, totalPages, currentPage, onJumpToPage]);

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
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            cancelBlurRef.current = true;
            setIsEditing(false);
            setInputValue(String(currentPage));
            e.currentTarget.blur();
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (currentPage < totalPages) onJumpToPage(currentPage + 1);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            if (currentPage > 1) onJumpToPage(currentPage - 1);
          }
        }}
      />
      <span className="text-muted-foreground">/ {totalPages}</span>
    </span>
  );
}
