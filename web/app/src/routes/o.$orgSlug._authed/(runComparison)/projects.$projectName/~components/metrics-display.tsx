import { useMemo, useRef, useEffect, useState, memo } from "react";
import { RefreshButton } from "@/components/core/refresh-button";
import { LogSearch } from "./run-comparison/search";
import { MemoizedMultiGroup } from "./multi-group/multi-group";
import { sortGroups } from "@/lib/grouping/index";
import type { GroupedMetrics } from "@/lib/grouping/types";
import {
  searchUtils,
  type SearchState,
  type SearchIndex,
} from "../~lib/search-utils";
import LineSettings from "./line-settings";
import { DashboardViewSelector, DashboardBuilder } from "./dashboard-builder";
import { useDashboardView, type DashboardView } from "../~queries/dashboard-views";
import type { SelectedRunWithColor } from "../~hooks/use-selected-runs";

interface MetricsDisplayProps {
  groupedMetrics: GroupedMetrics;
  onSearch?: (query: string, isRegex: boolean) => void;
  onRefresh: () => Promise<void>;
  organizationId: string;
  projectName: string;
  lastRefreshed?: Date;
  selectedRuns?: Record<string, SelectedRunWithColor>;
  selectedViewId?: string | null;
  onViewChange?: (viewId: string | null) => void;
}

/**
 * Main component for displaying metrics groups with search and refresh capabilities
 * Handles the filtering of metrics based on search criteria
 */
export function MetricsDisplay({
  groupedMetrics,
  onSearch,
  onRefresh,
  organizationId,
  projectName,
  lastRefreshed,
  selectedRuns = {},
  selectedViewId: externalSelectedViewId,
  onViewChange: externalOnViewChange,
}: MetricsDisplayProps) {
  const [searchState, setSearchState] = useState<SearchState>({
    query: "",
    isRegex: false,
    regex: null,
  });
  const searchIndexRef = useRef<Map<string, SearchIndex>>(new Map());

  // Support both controlled (via props) and uncontrolled (internal state) modes
  const [internalSelectedViewId, setInternalSelectedViewId] = useState<string | null>(null);
  const selectedViewId = externalSelectedViewId !== undefined ? externalSelectedViewId : internalSelectedViewId;
  const setSelectedViewId = externalOnViewChange ?? setInternalSelectedViewId;

  // Fetch the selected dashboard view
  const { data: selectedView } = useDashboardView(organizationId, selectedViewId);

  const uniqueLogNames = Object.keys(groupedMetrics)
    .map((group) =>
      groupedMetrics[group].metrics
        .filter((metric) => metric.type === "METRIC")
        .map((metric) => metric.name),
    )
    .flat();

  // Memoize the sorted base groups
  const sortedGroups = useMemo(() => {
    const time = performance.now();
    const sorted = sortGroups(groupedMetrics);
    return sorted;
  }, [groupedMetrics]);

  // Update search index only when metrics actually change
  useEffect(() => {
    const time = performance.now();
    const newIndex = searchUtils.createSearchIndex(groupedMetrics);
    const currentEntries = [...searchIndexRef.current.entries()].map(
      ([k, v]) => [k, [...v.terms], [...v.metrics]],
    );
    const newEntries = [...newIndex.entries()].map(([k, v]) => [
      k,
      [...v.terms],
      [...v.metrics],
    ]);
    if (JSON.stringify(currentEntries) !== JSON.stringify(newEntries)) {
      searchIndexRef.current = newIndex;
    }
  }, [groupedMetrics]);

  // Handle search with debouncing built into the search component
  const handleSearch = (query: string, isRegex: boolean) => {
    setSearchState(searchUtils.createSearchState(query, isRegex));
    onSearch?.(query, isRegex);
  };

  // Memoize filtered groups
  const filteredGroups = useMemo(() => {
    const filtered = searchUtils.filterGroups(
      sortedGroups,
      searchIndexRef.current,
      searchState,
    );
    return filtered;
  }, [sortedGroups, searchState]);

  // Pre-compute filtered metrics for each group to avoid inline computation
  // This ensures MemoizedMultiGroup receives stable references when metrics haven't changed
  const filteredMetricsPerGroup = useMemo(() => {
    const metricsMap = new Map<string, typeof filteredGroups[0][1]["metrics"]>();
    filteredGroups.forEach(([group, data]) => {
      metricsMap.set(
        group,
        searchUtils.filterMetrics(
          group,
          data.metrics,
          searchIndexRef.current,
          searchState,
        ),
      );
    });
    return metricsMap;
  }, [filteredGroups, searchState]);

  // If a custom view is selected, render the DashboardBuilder
  if (selectedViewId && selectedView) {
    return (
      <div className="flex-1 space-y-4">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 bg-background pb-2">
          <DashboardViewSelector
            organizationId={organizationId}
            projectName={projectName}
            selectedViewId={selectedViewId}
            onViewChange={setSelectedViewId}
          />
          <div className="flex items-center gap-2">
            <RefreshButton
              onRefresh={onRefresh}
              lastRefreshed={lastRefreshed}
              refreshInterval={10_000}
              defaultAutoRefresh={false}
            />
          </div>
        </div>
        <DashboardBuilder
          view={selectedView}
          groupedMetrics={groupedMetrics}
          selectedRuns={selectedRuns}
          organizationId={organizationId}
          projectName={projectName}
        />
      </div>
    );
  }

  // Default "All Metrics" view
  return (
    <div className="flex-1 space-y-4">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 bg-background pb-2">
        <div className="flex items-center gap-4">
          <DashboardViewSelector
            organizationId={organizationId}
            projectName={projectName}
            selectedViewId={selectedViewId}
            onViewChange={setSelectedViewId}
          />
          <div className="flex-1">
            <LogSearch
              onSearch={handleSearch}
              placeholder="Search groups and metrics..."
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RefreshButton
            onRefresh={onRefresh}
            lastRefreshed={lastRefreshed}
            refreshInterval={10_000}
            defaultAutoRefresh={false}
          />
          <LineSettings
            organizationId={organizationId}
            projectName={projectName}
            logNames={uniqueLogNames}
          />
        </div>
      </div>
      {filteredGroups.map(([group, data]) => (
        <MemoizedMultiGroup
          key={group}
          title={data.groupName}
          groupId={`${projectName}-${group}`}
          metrics={filteredMetricsPerGroup.get(group) ?? data.metrics}
          organizationId={organizationId}
          projectName={projectName}
        />
      ))}
    </div>
  );
}
