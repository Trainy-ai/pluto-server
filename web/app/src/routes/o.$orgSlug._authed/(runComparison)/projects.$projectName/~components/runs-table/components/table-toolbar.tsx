import React from "react";
import { Button } from "@/components/ui/button";
import { Columns, PanelLeft, PanelRight, Search, GitFork, InfoIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  UnstyledTooltipContent,
  DocsTooltip,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Run } from "../../../~queries/list-runs";
import type { ColumnConfig } from "../../../~hooks/use-column-config";
import { VisibilityOptions } from "../visibility-options";
import { DeleteRunsButton } from "./delete-runs-button";
import { ColumnPicker } from "../column-picker";
import { FilterButton } from "../filter-button";
import { GroupByPicker } from "../group-by-picker";
import type { RunFilter, FilterableField } from "@/lib/run-filters";
import { ExperimentRunsToggle, type ListMode } from "./experiment-runs-toggle";

type ViewMode = "charts" | "side-by-side";

interface TableToolbarProps {
  organizationId?: string;
  projectName: string;
  /** Called after selected runs are deleted, with the deleted run IDs. */
  onRunsDeleted: (deletedRunIds: string[]) => void;
  selectedRunsWithColors: Record<string, { run: Run; color: string }>;
  /** Run records for the checked set — what the delete button operates on. */
  checkedRunsWithColors?: Record<string, { run: Run; color: string }>;
  runCount: number;
  totalRunCount: number;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Focus on the search input — used to re-open the "Other matches"
   *  dropdown after a click-outside dismissal. */
  onSearchFocus?: () => void;
  searchOtherMatchesDropdown?: React.ReactNode;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  panelLayout: "both" | "list-only" | "graphs-only";
  onToggleListPanel?: () => void;
  onToggleGraphsPanel?: () => void;
  // Visibility
  onSelectFirstN: (n: number) => void;
  onSelectAllByIds: (runIds: string[]) => void;
  onDeselectByIds: (runIds: string[]) => void;
  onDeselectAll: () => void;
  onShuffleColors: () => void;
  onReassignAllColors: () => void;
  hiddenCount: number;
  onShowAllRuns: () => void;
  onHideAllRuns: () => void;
  showOnlySelected: boolean;
  onShowOnlySelectedChange: (v: boolean) => void;
  pinSelectedToTop: boolean;
  onPinSelectedToTopChange: (v: boolean) => void;
  pageRunIds: string[];
  deselectablePageRunIds: string[];
  /** Grouped-mode counts surfaced by GroupedBucketTree via
   *  onVisibleRootBucketsChange. Only used when groupBy is active. */
  groupedBucketsOnPage: number;
  groupedRunsOnPage: number;
  /** Sum of immediate-next-level distinct-value counts across the
   *  visible top-level buckets. Only added to the on-page button
   *  label as "(X leaf groups)" when groupBy.length === 2 — at that
   *  depth the immediate next IS the leaf. Skipped at depth 3+
   *  because intermediate subgroup totals don't add up to leaves. */
  groupedSubgroupsOnPage: number;
  onSelectAllGroupsOnPage: () => void;
  onDeselectAllGroupsOnPage: () => void;
  // Filters
  filters: RunFilter[];
  filterableFields: FilterableField[];
  onAddFilter: (filter: RunFilter) => void;
  onRemoveFilter: (filterId: string) => void;
  onClearFilters: () => void;
  onFieldSearch?: (search: string) => void;
  isSearchingFields?: boolean;
  // Columns
  customColumns: ColumnConfig[];
  availableConfigKeys: string[];
  availableSystemMetadataKeys: string[];
  availableMetricNames: string[];
  onColumnToggle?: (col: ColumnConfig) => void;
  onClearColumns?: () => void;
  columnKeysLoading?: boolean;
  onColumnSearch?: (search: string) => void;
  isSearchingColumns?: boolean;
  // View selector slot
  viewSelector?: React.ReactNode;
  // Experiments/Runs list mode
  listMode: ListMode;
  onListModeChange: (mode: ListMode) => void;
  // Inherited datapoints toggle
  showInherited: boolean;
  onInheritedToggle: () => void;
  // W&B-style grouping
  groupBy: string[];
  onGroupByChange: (groupBy: string[]) => void;
  /** Number of distinct outer-most group values that contain at least
   *  one selected run. Only meaningful when groupBy.length > 0;
   *  rendered above the "N of M runs selected" line so the user can
   *  see at a glance how many groups they've spanned. */
  selectedGroupCount: number;
  /** Selected-leaf-group count. Only valid when groupBy.length ≥ 2
   *  (at depth 1 the outermost IS the leaf and the two would be the
   *  same). The visibility popover reads this for the "(X leaf
   *  groups)" sub-line on "Display only selected" in deep groupings. */
  selectedLeafGroupCount: number;
  /** Total number of distinct outer-most group values in the project
   *  (post toolbar filter / search). Surfaced by GroupedBucketTree
   *  via the existing onRootTotalCountChange callback (we render
   *  this here instead of just feeding it to the paginator). */
  totalGroupCount: number;
  /** Intersection of the current selection with the toolbar filter.
   *  Only supplied when both a filter is active AND the selection is
   *  non-empty (otherwise the extra RTT isn't worth it). Renders as
   *  a third status line under the "runs selected · Filtered" line. */
  selectedFilterMatchCount?: number;
  /** Unfiltered outermost-group total for the "out of N total
   *  groups" denominator on the selection line. Comes from a
   *  distinctGroupValues call with no toolbar filter (see index.tsx).
   *  Falls back to `totalGroupCount` (post-filter) when absent. */
  totalGroupCountUnfiltered?: number;
}

export function TableToolbar({
  organizationId,
  projectName,
  onRunsDeleted,
  selectedRunsWithColors,
  checkedRunsWithColors,
  runCount,
  totalRunCount,
  selectedFilterMatchCount,
  totalGroupCountUnfiltered,
  searchQuery,
  onSearchChange,
  onKeyDown,
  onSearchFocus,
  searchOtherMatchesDropdown,
  viewMode,
  onViewModeChange,
  panelLayout,
  onToggleListPanel,
  onToggleGraphsPanel,
  onSelectFirstN,
  onSelectAllByIds,
  onDeselectByIds,
  onDeselectAll,
  onShuffleColors,
  onReassignAllColors,
  hiddenCount,
  onShowAllRuns,
  onHideAllRuns,
  showOnlySelected,
  onShowOnlySelectedChange,
  pinSelectedToTop,
  onPinSelectedToTopChange,
  pageRunIds,
  deselectablePageRunIds,
  groupedBucketsOnPage,
  groupedRunsOnPage,
  groupedSubgroupsOnPage,
  onSelectAllGroupsOnPage,
  onDeselectAllGroupsOnPage,
  filters,
  filterableFields,
  onAddFilter,
  onRemoveFilter,
  onClearFilters,
  onFieldSearch,
  isSearchingFields,
  customColumns,
  availableConfigKeys,
  availableSystemMetadataKeys,
  availableMetricNames,
  onColumnToggle,
  onClearColumns,
  columnKeysLoading,
  onColumnSearch,
  isSearchingColumns,
  viewSelector,
  listMode,
  onListModeChange,
  showInherited,
  onInheritedToggle,
  groupBy,
  selectedGroupCount,
  selectedLeafGroupCount,
  totalGroupCount,
  onGroupByChange,
}: TableToolbarProps) {
  return (
    <div className="mb-2 shrink-0 space-y-2">
      <div className="mt-2 flex items-center justify-between gap-x-3">
        <ExperimentRunsToggle mode={listMode} onChange={onListModeChange} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className={cn(
                "relative h-8 w-8 shrink-0",
                showInherited && "border-primary bg-accent"
              )}
              onClick={onInheritedToggle}
            >
              <GitFork className="h-4 w-4" />
              {showInherited && (
                <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-primary" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {showInherited ? "Hide inherited datapoints" : "Show inherited datapoints"}
          </TooltipContent>
        </Tooltip>
        <div className="min-w-0 truncate pl-1 text-xs text-muted-foreground">
          {listMode === "experiments" ? (
            <>
              <span className="font-medium">{runCount}</span>
              {" of "}
              <span className="font-medium">{totalRunCount}</span>
              {totalRunCount === 1 ? " experiment" : " experiments"}
            </>
          ) : (
            <>
              {/* Filter / search summary FIRST — filtering is applied
                  before selection concerns, so the header reads in
                  the same order the user thinks about it: "here's
                  what my filter matched, and here's what I picked
                  out of that". Grouped mode adds the group count
                  alongside runs because the same filter reduces both
                  dimensions. Skipped entirely when nothing is
                  reducing (runCount === totalRunCount). */}
              {runCount < totalRunCount && (
                <div className="text-muted-foreground/80">
                  {filters.length > 0
                    ? `Filtered to ${groupBy.length > 0 ? `${totalGroupCount} ${totalGroupCount === 1 ? "group" : "groups"} (${runCount} runs)` : `${runCount} runs`}`
                    : searchQuery.trim().length > 0
                      ? `Search found ${groupBy.length > 0 ? `${totalGroupCount} ${totalGroupCount === 1 ? "group" : "groups"} (${runCount} runs)` : `${runCount} runs`}`
                      : `Showing ${runCount} runs`}
                </div>
              )}
              {/* Selection line.
                  Grouped:
                    `X groups (S runs) selected out of Y total groups (T total runs)`
                  X = filter-independent count of outer groups the
                  selection touches (from selectedAncestorPaths[0]);
                  Y = unfiltered total from a dedicated
                  distinctGroupValues call so it stays stable
                  regardless of the toolbar filter.
                  Flat:
                    `S of T runs selected`. */}
              <div className="text-muted-foreground/80">
                {groupBy.length > 0 ? (
                  <>
                    <span className="font-medium">{selectedGroupCount}</span>
                    {selectedGroupCount === 1 ? " group (" : " groups ("}
                    <span className="font-medium">{Object.keys(selectedRunsWithColors).length}</span>
                    {" runs) selected out of "}
                    <span className="font-medium">{totalGroupCountUnfiltered ?? totalGroupCount}</span>
                    {(totalGroupCountUnfiltered ?? totalGroupCount) === 1 ? " total group (" : " total groups ("}
                    <span className="font-medium">{totalRunCount}</span>
                    {" total runs)"}
                  </>
                ) : (
                  <>
                    <span className="font-medium">{Object.keys(selectedRunsWithColors).length}</span>
                    {" of "}
                    <span className="font-medium">{totalRunCount}</span>
                    {" runs selected"}
                  </>
                )}
              </div>
              {/* Intersection line — only when the filter chips are
                  active AND the user has runs selected. Answers "how
                  many of my picks pass the filter?" which is exactly
                  what DOS/PSTT render in grouped mode. */}
              {selectedFilterMatchCount != null && Object.keys(selectedRunsWithColors).length > 0 && filters.length > 0 && (showOnlySelected || pinSelectedToTop) && (
                <div className="text-muted-foreground/80">
                  <span className="font-medium">{selectedFilterMatchCount}</span>
                  {" of "}
                  <span className="font-medium">{Object.keys(selectedRunsWithColors).length}</span>
                  {" selected "}
                  {Object.keys(selectedRunsWithColors).length === 1 ? "run matches" : "runs match"}
                  {" the filter"}
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className={cn(
                    "h-9 w-9",
                    panelLayout === "graphs-only" && "border-primary bg-accent"
                  )}
                  onClick={onToggleListPanel}
                >
                  <PanelLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {panelLayout === "graphs-only" ? "Show runs list" : "Hide runs list"}{" "}
                <kbd className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-background px-1 font-mono text-[10px] font-medium text-muted-foreground">[</kbd>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className={cn(
                    "h-9 w-9",
                    panelLayout === "list-only" && "border-primary bg-accent"
                  )}
                  onClick={onToggleGraphsPanel}
                >
                  <PanelRight className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {panelLayout === "list-only" ? "Show graphs" : "Hide graphs"}{" "}
                <kbd className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-background px-1 font-mono text-[10px] font-medium text-muted-foreground">]</kbd>
              </TooltipContent>
            </Tooltip>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
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
            </TooltipTrigger>
            <UnstyledTooltipContent
              sideOffset={8}
              side="bottom"
              align="end"
              showArrow={false}
            >
              <DocsTooltip
                title="Side-by-side view"
                iconComponent={<InfoIcon className="size-4" />}
                description="Compare selected runs column by column to spot differences in their config and system metadata."
                link="https://docs.trainy.ai/pluto/comparing#side-by-side-view"
              />
            </UnstyledTooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className={cn(
              "absolute top-2.5 left-2 h-4 w-4",
              searchQuery.trim().length > 0
                ? "text-primary"
                : "text-muted-foreground",
            )}
          />
          <Input
            placeholder="Search by name or ID..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={onSearchFocus}
            // `onFocus` alone misses the post-Esc reopen path: Esc keeps
            // focus on the input, so clicking back into it doesn't fire
            // `focus`. `mousedown` fires on every click regardless of
            // prior focus state — idempotent with onFocus.
            onMouseDown={onSearchFocus}
            // Active-state styling when the search has text — primary
            // border + tinted background so it's obvious results are
            // refined by a search and the user notices leftover
            // characters in the input. `text-xs md:text-xs` overrides
            // Input's base `text-base md:text-sm` so the search box
            // matches the compact row font size.
            className={cn(
              "pl-8 text-xs md:text-xs",
              searchQuery.trim().length > 0 &&
                "border-primary bg-primary/5 ring-1 ring-primary/40",
            )}
          />
          {searchOtherMatchesDropdown}
        </div>
        {organizationId && (
          <DeleteRunsButton
            organizationId={organizationId}
            projectName={projectName}
            selectedRunsWithColors={checkedRunsWithColors ?? {}}
            onDeleted={onRunsDeleted}
          />
        )}
        <VisibilityOptions
          selectedRunsWithColors={selectedRunsWithColors}
          onSelectFirstN={onSelectFirstN}
          onSelectAllOnPage={onSelectAllByIds}
          onDeselectAllOnPage={onDeselectByIds}
          onDeselectAll={onDeselectAll}
          onShuffleColors={onShuffleColors}
          onReassignAllColors={onReassignAllColors}
          showOnlySelected={showOnlySelected}
          onShowOnlySelectedChange={onShowOnlySelectedChange}
          pinSelectedToTop={pinSelectedToTop}
          onPinSelectedToTopChange={onPinSelectedToTopChange}
          pageRunIds={pageRunIds}
          deselectablePageRunIds={deselectablePageRunIds}
          groupedBucketsOnPage={groupedBucketsOnPage}
          groupedRunsOnPage={groupedRunsOnPage}
          groupedSubgroupsOnPage={groupedSubgroupsOnPage}
          onSelectAllGroupsOnPage={onSelectAllGroupsOnPage}
          onDeselectAllGroupsOnPage={onDeselectAllGroupsOnPage}
          selectedGroupCount={selectedGroupCount}
          selectedLeafGroupCount={selectedLeafGroupCount}
          groupByLength={groupBy.length}
          totalRunCount={runCount}
          hiddenCount={hiddenCount}
          onShowAllRuns={onShowAllRuns}
          onHideAllRuns={onHideAllRuns}
          isGrouped={groupBy.length > 0}
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
            organizationId={organizationId}
            projectName={projectName}
          />
          <GroupByPicker
            groupBy={groupBy}
            onGroupByChange={onGroupByChange}
            configKeys={availableConfigKeys}
            systemMetadataKeys={availableSystemMetadataKeys}
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
  );
}
