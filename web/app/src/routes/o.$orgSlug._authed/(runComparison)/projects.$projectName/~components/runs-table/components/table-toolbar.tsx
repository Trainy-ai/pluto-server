import React from "react";
import { Button } from "@/components/ui/button";
import { Columns, PanelLeft, PanelRight, Search, GitFork } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Run } from "../../../~queries/list-runs";
import type { ColumnConfig } from "../../../~hooks/use-column-config";
import { VisibilityOptions } from "../visibility-options";
import { ColumnPicker } from "../column-picker";
import { FilterButton } from "../filter-button";
import type { RunFilter, FilterableField } from "@/lib/run-filters";
import { ExperimentRunsToggle, type ListMode } from "./experiment-runs-toggle";

type ViewMode = "charts" | "side-by-side";

interface TableToolbarProps {
  selectedRunsWithColors: Record<string, { run: Run; color: string }>;
  runCount: number;
  totalRunCount: number;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  panelLayout: "both" | "list-only" | "graphs-only";
  onToggleListPanel?: () => void;
  onToggleGraphsPanel?: () => void;
  // Visibility
  onSelectFirstN: (n: number) => void;
  onSelectAllByIds: (runIds: string[]) => void;
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
}

export function TableToolbar({
  selectedRunsWithColors,
  runCount,
  totalRunCount,
  searchQuery,
  onSearchChange,
  onKeyDown,
  viewMode,
  onViewModeChange,
  panelLayout,
  onToggleListPanel,
  onToggleGraphsPanel,
  onSelectFirstN,
  onSelectAllByIds,
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
        <div className="min-w-0 truncate pl-1 text-sm text-muted-foreground">
          {listMode === "experiments" ? (
            <>
              <span className="font-medium">{runCount}</span>
              {" of "}
              <span className="font-medium">{totalRunCount}</span>
              {totalRunCount === 1 ? " experiment" : " experiments"}
            </>
          ) : (
            <>
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
            placeholder="Search by name or ID..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={onKeyDown}
            className="pl-8"
          />
        </div>
        <VisibilityOptions
          selectedRunsWithColors={selectedRunsWithColors}
          onSelectFirstN={onSelectFirstN}
          onSelectAllOnPage={onSelectAllByIds}
          onDeselectAll={onDeselectAll}
          onShuffleColors={onShuffleColors}
          onReassignAllColors={onReassignAllColors}
          showOnlySelected={showOnlySelected}
          onShowOnlySelectedChange={onShowOnlySelectedChange}
          pinSelectedToTop={pinSelectedToTop}
          onPinSelectedToTopChange={onPinSelectedToTopChange}
          pageRunIds={pageRunIds}
          totalRunCount={runCount}
          hiddenCount={hiddenCount}
          onShowAllRuns={onShowAllRuns}
          onHideAllRuns={onHideAllRuns}
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
  );
}
