import { useMemo, useRef, useEffect, useState } from "react";
import { RefreshButton } from "@/components/core/refresh-button";
import { LogSearch } from "./run-comparison/search";
import { MultiGroup } from "./multi-group/multi-group";
import { sortGroups } from "@/lib/grouping/index";
import type { GroupedMetrics } from "@/lib/grouping/types";
import {
  searchUtils,
  type SearchState,
  type SearchIndex,
} from "../~lib/search-utils";
import LineSettings from "./line-settings";

interface MetricsDisplayProps {
  groupedMetrics: GroupedMetrics;
  onSearch?: (query: string, isRegex: boolean) => void;
  onRefresh: () => Promise<void>;
  organizationId: string;
  projectName: string;
  lastRefreshed?: Date;
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
}: MetricsDisplayProps) {
  const [searchState, setSearchState] = useState<SearchState>({
    query: "",
    isRegex: false,
    regex: null,
  });
  const searchIndexRef = useRef<Map<string, SearchIndex>>(new Map());

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

  return (
    <div className="flex-1 space-y-4 overflow-y-auto">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 bg-background pb-2">
        <div className="flex-1">
          <LogSearch
            onSearch={handleSearch}
            placeholder="Search groups and metrics..."
          />
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
        <MultiGroup
          key={group}
          title={data.groupName}
          groupId={`${projectName}-${group}`}
          metrics={searchUtils.filterMetrics(
            group,
            data.metrics,
            searchIndexRef.current,
            searchState,
          )}
          organizationId={organizationId}
          projectName={projectName}
        />
      ))}
    </div>
  );
}
