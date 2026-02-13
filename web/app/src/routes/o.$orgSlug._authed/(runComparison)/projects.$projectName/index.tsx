import { queryClient, trpc } from "@/utils/trpc";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import RunComparisonLayout from "@/components/layout/runComparison/layout";
import PageLayout from "@/components/layout/page-layout";
import { OrganizationPageTitle } from "@/components/layout/page-title";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { SortingState } from "@tanstack/react-table";
import { useSelectedRuns } from "./~hooks/use-selected-runs";
import { prefetchListRuns, useListRuns, type Run } from "./~queries/list-runs";
import { useSelectedRunLogs } from "./~queries/selected-run-logs";
import { useUpdateTags } from "./~queries/update-tags";
import { useUpdateNotes } from "./~queries/update-notes";
import { useDistinctTags } from "./~queries/distinct-tags";
import { useDistinctColumnKeys, useSearchColumnKeys } from "./~queries/distinct-column-keys";
import { useColumnConfig, useBaseColumnOverrides, DEFAULT_COLUMNS, type ColumnConfig, type MetricAggregation } from "./~hooks/use-column-config";
import { useDistinctMetricNames, useSearchMetricNames, useMetricSummaries } from "./~queries/metric-summaries";
import { groupMetrics } from "./~lib/metrics-utils";
import { MetricsDisplay } from "./~components/metrics-display";
import { SideBySideView } from "./~components/side-by-side/side-by-side-view";
import { DataTable } from "./~components/runs-table/data-table";
import { useRefresh } from "./~hooks/use-refresh";
import { useRunCount } from "./~queries/run-count";
import { useRunFilters } from "./~hooks/use-run-filters";
import { SYSTEM_FILTERABLE_FIELDS, type FilterableField, type FieldFilterParam, type MetricFilterParam, type SystemFilterParam, type SortParam } from "@/lib/run-filters";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useDebouncedCallback } from "@/lib/hooks/use-debounced-callback";
import { flattenObject } from "@/lib/flatten-object";
import { RunTableViewSelector } from "./~components/runs-table/run-table-view-selector";
import { DEFAULT_PAGE_SIZE } from "./~components/runs-table/config";

// Search params type for the route
// Note: runs is stored as comma-separated string in URL for cleaner URLs
interface RunComparisonSearchParams {
  chart?: string;
  runs?: string;  // Comma-separated run IDs (e.g., "id1,id2,id3")
}

export const Route = createFileRoute(
  "/o/$orgSlug/_authed/(runComparison)/projects/$projectName/",
)({
  component: RouteComponent,
  validateSearch: (search): RunComparisonSearchParams => {
    const result: RunComparisonSearchParams = {};

    // Support ?chart=<viewId> to deep-link to a specific custom chart
    if (typeof search.chart === "string" && search.chart.trim()) {
      result.chart = search.chart.trim();
    }

    // Support ?runs=id1,id2,id3 to pre-select specific runs (stored as comma-separated string)
    if (typeof search.runs === "string" && search.runs.trim()) {
      result.runs = search.runs.trim();
    }

    return result;
  },
  beforeLoad: async ({ context, params }) => {
    const auth = context.auth;

    // Pass the queryClient when prefetching
    // prefetchListRuns(
    //   context.queryClient,
    //   context.auth.activeOrganization.id,
    //   params.projectName,
    // );

    return {
      organizationId: auth.activeOrganization.id,
      projectName: params.projectName,
      organizationSlug: params.orgSlug,
    };
  },
});

/**
 * Main component for the run comparison page
 * Integrates data loading, selection state, and the display of runs and metrics
 */
type ViewMode = "charts" | "side-by-side";

function RouteComponent() {
  const { organizationId, projectName, organizationSlug } =
    Route.useRouteContext();
  const { chart, runs: urlRunsParam } = Route.useSearch();
  const navigate = useNavigate();

  // Parse comma-separated run IDs from URL into array
  const urlRunIds = useMemo(() => {
    if (!urlRunsParam) return undefined;
    const ids = urlRunsParam.split(",").map((id) => id.trim()).filter(Boolean);
    return ids.length > 0 ? ids : undefined;
  }, [urlRunsParam]);

  // Handler for changing the selected dashboard view (syncs with URL)
  const handleViewChange = useCallback(
    (viewId: string | null) => {
      void navigate({
        to: ".",
        search: (prev) => ({
          ...prev,
          chart: viewId || undefined,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  // Handler for syncing run selection to URL (debounced to avoid excessive updates)
  const handleSelectionChange = useCallback(
    (selectedRunIds: string[]) => {
      void navigate({
        to: ".",
        search: (prev) => ({
          ...prev,
          runs: selectedRunIds.length > 0 ? selectedRunIds.join(",") : undefined,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  // Debounced version of selection change to avoid rapid URL updates
  const debouncedSelectionChange = useDebouncedCallback(handleSelectionChange, 300);

  // View mode state - "charts" (default) or "side-by-side"
  const [viewMode, setViewMode] = useState<ViewMode>("charts");

  // Track hovered run ID from runs table for chart highlighting
  const [hoveredRunId, setHoveredRunId] = useState<string | null>(null);

  // Server-side sorting state (persisted to localStorage)
  const sortingStorageKey = `run-table-sorting:${organizationSlug}:${projectName}`;
  const [sorting, setSorting] = useState<SortingState>(() => {
    try {
      const saved = localStorage.getItem(sortingStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });
  // Persist sorting to localStorage on change
  useEffect(() => {
    try {
      if (sorting.length > 0) {
        localStorage.setItem(sortingStorageKey, JSON.stringify(sorting));
      } else {
        localStorage.removeItem(sortingStorageKey);
      }
    } catch {}
  }, [sortingStorageKey, sorting]);

  // Active run table view state (persisted to localStorage)
  const activeViewStorageKey = `mlop:active-table-view:${organizationSlug}:${projectName}`;
  const [activeViewId, setActiveViewIdRaw] = useState<string | null>(() => {
    try {
      return localStorage.getItem(activeViewStorageKey) || null;
    } catch {
      return null;
    }
  });
  const setActiveViewId = useCallback(
    (viewId: string | null) => {
      setActiveViewIdRaw(viewId);
      try {
        if (viewId) {
          localStorage.setItem(activeViewStorageKey, viewId);
        } else {
          localStorage.removeItem(activeViewStorageKey);
        }
      } catch {
        // localStorage unavailable
      }
    },
    [activeViewStorageKey],
  );

  // Page size state — default view's page size persisted to localStorage
  const defaultPageSizeKey = `run-table-pageSize-${organizationId}-${projectName}`;
  const getDefaultPageSize = useCallback(() => {
    try {
      const saved = localStorage.getItem(defaultPageSizeKey);
      if (saved) {
        const n = Number(saved);
        if (Number.isInteger(n) && n > 0) return n;
      }
    } catch {}
    return DEFAULT_PAGE_SIZE;
  }, [defaultPageSizeKey]);
  const [pageSize, setPageSize] = useState<number>(getDefaultPageSize);
  const activeViewIdRef = useRef(activeViewId);
  activeViewIdRef.current = activeViewId;
  // Called from the page size dropdown in the table — persist only for default view
  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    if (!activeViewIdRef.current) {
      try { localStorage.setItem(defaultPageSizeKey, String(size)); } catch {}
    }
  }, [defaultPageSizeKey]);

  // Known metric aggregation suffixes for parsing column table IDs
  const METRIC_AGGS = new Set(["MIN", "MAX", "AVG", "LAST", "VARIANCE"]);

  // Convert TanStack Table sorting state to backend sort param
  const sortParam = useMemo((): SortParam | undefined => {
    if (sorting.length === 0) return undefined;
    const { id, desc } = sorting[0];
    const direction = desc ? "desc" as const : "asc" as const;

    // Base "name" column
    if (id === "name") {
      return { field: "name", source: "system", direction };
    }

    // Custom columns: "custom-config-lr", "custom-system-createdAt", "custom-metric-train/loss-LAST"
    if (id.startsWith("custom-")) {
      const rest = id.slice(7); // remove "custom-"
      const dashIdx = rest.indexOf("-");
      if (dashIdx === -1) return undefined;
      const source = rest.substring(0, dashIdx);
      const field = rest.substring(dashIdx + 1);

      // Metric columns: "custom-metric-train/loss-LAST"
      // Parse aggregation from the last segment after the last dash
      if (source === "metric") {
        const lastDash = field.lastIndexOf("-");
        if (lastDash === -1) return undefined;
        const metricName = field.substring(0, lastDash);
        const agg = field.substring(lastDash + 1);
        if (METRIC_AGGS.has(agg)) {
          return { field: metricName, source: "metric", direction, aggregation: agg as MetricAggregation };
        }
        return undefined;
      }

      if (source === "system" || source === "config" || source === "systemMetadata") {
        return { field, source, direction };
      }
    }

    return undefined;
  }, [sorting]);

  // Unified filter state
  const {
    filters,
    addFilter,
    removeFilter,
    updateFilter,
    clearAll: clearFilters,
    setAll: setAllFilters,
    serverFilters,
  } = useRunFilters(organizationSlug, projectName);
  // Search state - immediate value for input display
  const [searchInput, setSearchInput] = useState<string>("");
  // Debounced search value for server queries
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");

  // Debounce search updates to avoid excessive API calls
  const updateDebouncedSearch = useDebouncedCallback(
    (value: string) => setDebouncedSearch(value),
    300,
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      updateDebouncedSearch(value);
    },
    [updateDebouncedSearch],
  );

  const { refresh, lastRefreshed, isRefreshing } = useRefresh({
    queries: [
      {
        predicate: (query) => {
          const firstEntry = query.queryKey[0] as string | string[];
          return firstEntry?.[0] === "runs";
        },
      },
    ],
  });

  const { data: runCount, isLoading: runCountLoading } = useRunCount(
    organizationId,
    projectName,
    serverFilters.tags,
    serverFilters.status,
    debouncedSearch,
    serverFilters.dateFilters,
    serverFilters.fieldFilters as FieldFilterParam[] | undefined,
    serverFilters.metricFilters as MetricFilterParam[] | undefined,
    serverFilters.systemFilters as SystemFilterParam[] | undefined,
  );

  // Unfiltered total count for the project
  const { data: totalRunCount } = useRunCount(
    organizationId,
    projectName,
  );

  // Load runs using infinite query with standard TanStack/tRPC v11 approach
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isFetching,
    isError,
    isPlaceholderData,
    error,
  } = useListRuns(organizationId, projectName, serverFilters.tags, serverFilters.status, debouncedSearch, serverFilters.dateFilters, sortParam, serverFilters.fieldFilters as FieldFilterParam[] | undefined, serverFilters.metricFilters as MetricFilterParam[] | undefined, serverFilters.systemFilters as SystemFilterParam[] | undefined);

  // Mutation for updating tags
  const updateTagsMutation = useUpdateTags(organizationId, projectName);

  // Mutation for updating notes
  const updateNotesMutation = useUpdateNotes(organizationId, projectName);

  // Fetch all distinct tags across all runs in the project
  // This ensures the filter dropdown shows all available tags, not just those from loaded runs
  const { data: distinctTagsData } = useDistinctTags(organizationId, projectName);
  const allTags = distinctTagsData?.tags ?? [];

  // Column configuration (custom columns in runs table)
  const { columns: customColumns, addColumn, removeColumn, updateColumns, reorderColumns } = useColumnConfig(organizationSlug, projectName);
  const { data: columnKeysData, isLoading: columnKeysLoading } = useDistinctColumnKeys(organizationId, projectName);

  // Metric names for column picker and filter dropdown (initial load: last 100)
  const { data: metricNamesData } = useDistinctMetricNames(organizationId, projectName);

  // Search column keys — queries the project_column_keys cache table when user types in filter dropdown
  const [fieldSearch, setFieldSearch] = useState("");
  const [debouncedFieldSearch, setDebouncedFieldSearch] = useState("");
  const updateDebouncedFieldSearch = useDebouncedCallback(
    (value: string) => setDebouncedFieldSearch(value),
    300,
  );
  const handleFieldSearch = useCallback(
    (value: string) => {
      setFieldSearch(value);
      updateDebouncedFieldSearch(value);
    },
    [updateDebouncedFieldSearch],
  );
  const { data: searchKeysData, isFetching: isSearchingKeys } = useSearchColumnKeys(organizationId, projectName, debouncedFieldSearch);
  const { data: searchMetricNamesData, isFetching: isSearchingMetrics } = useSearchMetricNames(organizationId, projectName, debouncedFieldSearch);

  // Merge initial metric names with search results (deduplicated)
  const metricNames = useMemo(() => {
    const initial = metricNamesData?.metricNames ?? [];
    const searched = searchMetricNamesData?.metricNames ?? [];
    if (searched.length === 0) return initial;
    const set = new Set(initial);
    const merged = [...initial];
    for (const name of searched) {
      if (!set.has(name)) {
        merged.push(name);
      }
    }
    return merged;
  }, [metricNamesData, searchMetricNamesData]);

  const handleColumnToggle = useCallback(
    (col: ColumnConfig) => {
      const exists = customColumns.some(
        (c) => c.id === col.id && c.source === col.source && c.aggregation === col.aggregation
      );
      if (exists) {
        removeColumn(col);
      } else {
        addColumn(col);
      }
    },
    [customColumns, addColumn, removeColumn],
  );

  const handleClearColumns = useCallback(() => {
    updateColumns([]);
  }, [updateColumns]);

  // Base column overrides (Name column rename + background color)
  const { overrides: baseOverrides, updateOverride: updateBaseOverride, setAllOverrides } =
    useBaseColumnOverrides(organizationSlug, projectName);

  const nameOverrides = baseOverrides["name"];

  const handleNameRename = useCallback(
    (newName: string) => updateBaseOverride("name", { customLabel: newName }),
    [updateBaseOverride],
  );

  const handleNameSetColor = useCallback(
    (color: string | undefined) => updateBaseOverride("name", { backgroundColor: color }),
    [updateBaseOverride],
  );

  // Column header dropdown handlers for custom columns
  const handleColumnRename = useCallback(
    (colId: string, source: string, newName: string, aggregation?: string) => {
      updateColumns(
        customColumns.map((c) =>
          c.id === colId && c.source === source && c.aggregation === aggregation ? { ...c, customLabel: newName } : c,
        ),
      );
    },
    [customColumns, updateColumns],
  );

  const handleColumnSetColor = useCallback(
    (colId: string, source: string, color: string | undefined, aggregation?: string) => {
      updateColumns(
        customColumns.map((c) =>
          c.id === colId && c.source === source && c.aggregation === aggregation ? { ...c, backgroundColor: color } : c,
        ),
      );
    },
    [customColumns, updateColumns],
  );

  const handleColumnRemove = useCallback(
    (colId: string, source: string, aggregation?: string) => {
      removeColumn({ id: colId, source: source as any, label: "", aggregation: aggregation as any });
    },
    [removeColumn],
  );

  // Run table view handlers
  const handleLoadView = useCallback(
    (config: { columns: ColumnConfig[]; baseOverrides: Record<string, any>; filters: any[]; sorting: SortingState; pageSize?: number }) => {
      updateColumns(config.columns);
      setAllOverrides(config.baseOverrides);
      setAllFilters(config.filters);
      setSorting(config.sorting);
      if (config.pageSize != null) {
        setPageSize(config.pageSize);
      }
    },
    [updateColumns, setAllOverrides, setAllFilters],
  );

  const handleResetToDefault = useCallback(() => {
    updateColumns([...DEFAULT_COLUMNS]);
    setAllOverrides({});
    setAllFilters([]);
    setSorting([]);
    setPageSize(getDefaultPageSize());
  }, [updateColumns, setAllOverrides, setAllFilters, getDefaultPageSize]);

  // Flatten the pages to get all runs.
  // Pre-flatten config and systemMetadata once per run so every downstream
  // consumer (table cells, side-by-side view, etc.) can do a cheap key lookup
  // instead of re-flattening on each render.
  const allLoadedRuns = useMemo(() => {
    if (!data?.pages) return [];

    // Flatten and deduplicate runs by ID to prevent pagination issues
    const allRuns = data.pages.flatMap((page) => {
      if (!page) return [];
      return page.runs || [];
    });

    // Create a Map to deduplicate by run ID
    const uniqueRuns = new Map();
    allRuns.forEach((run) => {
      if (run.id && !uniqueRuns.has(run.id)) {
        uniqueRuns.set(run.id, {
          ...run,
          _flatConfig: run.config ? flattenObject(run.config) : {},
          _flatSystemMetadata: run.systemMetadata ? flattenObject(run.systemMetadata) : {},
        });
      }
    });

    return Array.from(uniqueRuns.values());
  }, [data]);

  // Extract metric column specs for the summaries query
  const metricColumnSpecs = useMemo(() => {
    return customColumns
      .filter((c): c is typeof c & { aggregation: MetricAggregation } => c.source === "metric" && !!c.aggregation)
      .map((c) => ({ logName: c.id, aggregation: c.aggregation }));
  }, [customColumns]);

  // Get all visible run IDs for metric summaries batch fetch
  const visibleRunIds = useMemo(() => allLoadedRuns.map((r) => r.id), [allLoadedRuns]);

  // Fetch metric summaries for visible runs (only when metric columns are active)
  const { data: metricSummariesData } = useMetricSummaries(
    organizationId,
    projectName,
    visibleRunIds,
    metricColumnSpecs,
  );

  // Merge metric summaries into runs
  const runsWithMetrics = useMemo(() => {
    if (!metricSummariesData?.summaries || metricColumnSpecs.length === 0) {
      return allLoadedRuns;
    }
    const summaries = metricSummariesData.summaries;
    return allLoadedRuns.map((run) => {
      const runSummaries = summaries[run.id];
      if (!runSummaries) return run;
      return { ...run, metricSummaries: runSummaries };
    });
  }, [allLoadedRuns, metricSummariesData, metricColumnSpecs.length]);

  const runs = runsWithMetrics;

  // Build filterable fields from system fields + config/systemMetadata keys.
  // When the user is searching, merge results from the cache table so keys
  // beyond the latest-100-runs scan are discoverable.
  const filterableFields = useMemo<FilterableField[]>(() => {
    const fields: FilterableField[] = SYSTEM_FILTERABLE_FIELDS.map(f => ({ ...f }));

    // Add tags options dynamically
    const tagsField = fields.find((f) => f.id === "tags");
    if (tagsField && allTags.length > 0) {
      tagsField.options = allTags.map((t) => ({ label: t, value: t }));
    }

    // Track which keys we've already added to avoid duplicates
    const seen = new Set<string>();

    // Add config keys from initial scan (last 100 runs)
    if (columnKeysData?.configKeys) {
      for (const ck of columnKeysData.configKeys) {
        seen.add(`config:${ck.key}`);
        fields.push({
          id: ck.key,
          source: "config",
          label: ck.key,
          dataType: ck.type as FilterableField["dataType"],
        });
      }
    }

    // Add system metadata keys from initial scan
    if (columnKeysData?.systemMetadataKeys) {
      for (const sk of columnKeysData.systemMetadataKeys) {
        seen.add(`systemMetadata:${sk.key}`);
        fields.push({
          id: sk.key,
          source: "systemMetadata",
          label: sk.key,
          dataType: sk.type as FilterableField["dataType"],
        });
      }
    }

    // Merge in search results from the cache table (keys not in the initial scan)
    if (searchKeysData?.configKeys) {
      for (const ck of searchKeysData.configKeys) {
        if (!seen.has(`config:${ck.key}`)) {
          fields.push({
            id: ck.key,
            source: "config",
            label: ck.key,
            dataType: ck.type as FilterableField["dataType"],
          });
        }
      }
    }
    if (searchKeysData?.systemMetadataKeys) {
      for (const sk of searchKeysData.systemMetadataKeys) {
        if (!seen.has(`systemMetadata:${sk.key}`)) {
          fields.push({
            id: sk.key,
            source: "systemMetadata",
            label: sk.key,
            dataType: sk.type as FilterableField["dataType"],
          });
        }
      }
    }

    return fields;
  }, [columnKeysData, searchKeysData, allTags]);

  // Handler for updating tags on a run
  const handleTagsUpdate = useCallback(
    (runId: string, tags: string[]) => {
      updateTagsMutation.mutate({
        organizationId,
        runId,
        projectName,
        tags,
      });
    },
    [organizationId, projectName, updateTagsMutation]
  );

  // Handler for updating notes on a run
  const handleNotesUpdate = useCallback(
    (runId: string, notes: string | null) => {
      updateNotesMutation.mutate({
        organizationId,
        runId,
        projectName,
        notes,
      });
    },
    [organizationId, projectName, updateNotesMutation]
  );

  const {
    runColors,
    selectedRunsWithColors,
    handleRunSelection,
    handleColorChange,
    selectFirstN,
    selectAllByIds,
    deselectAll,
    shuffleColors,
  } = useSelectedRuns(runs, organizationId, projectName, {
    urlRunIds,
    onSelectionChange: debouncedSelectionChange,
  });

  // Fetch logs only for selected runs (lazy loading)
  const selectedRunIds = useMemo(
    () => Object.keys(selectedRunsWithColors),
    [selectedRunsWithColors]
  );
  const { data: logsByRunId } = useSelectedRunLogs(
    selectedRunIds,
    projectName,
    organizationId
  );

  // Process metrics data from selected runs
  // Note: Removed useDeferredValue as it was preventing chart updates on deselection
  const groupedMetrics = useMemo(() => {
    const metrics = groupMetrics(selectedRunsWithColors, logsByRunId, organizationId, projectName);
    return metrics;
  }, [selectedRunsWithColors, logsByRunId, organizationId, projectName]);

  return (
    <RunComparisonLayout>
      <PageLayout
        showSidebarTrigger={false}
        disableScroll={true}
        headerLeft={
          <OrganizationPageTitle
            breadcrumbs={[
              { title: "Home", to: "/o/$orgSlug" },
              { title: "Projects", to: "/o/$orgSlug/projects" },
            ]}
            title={projectName}
          />
        }
      >
        <ResizablePanelGroup
          orientation="horizontal"
          className="h-[calc(100vh-4rem)] w-full p-2"
          defaultLayout={{
            "runs-list": 30,
            "metrics-display": 70,
          }}
        >
          <ResizablePanel
            id="runs-list"
            minSize={15}
            className="overflow-hidden"
          >
            <div className="flex h-full min-h-0 flex-col overflow-hidden pr-2">
              <DataTable
                runs={runs}
                orgSlug={organizationSlug}
                projectName={projectName}
                organizationId={organizationId}
                onColorChange={handleColorChange}
                onSelectionChange={handleRunSelection}
                onTagsUpdate={handleTagsUpdate}
                onNotesUpdate={handleNotesUpdate}
                selectedRunsWithColors={selectedRunsWithColors}
                runColors={runColors}
                isLoading={isLoading || runCountLoading || isPlaceholderData}
                isFetching={isFetching}
                runCount={runCount || 0}
                totalRunCount={totalRunCount || runCount || 0}
                fetchNextPage={fetchNextPage}
                hasNextPage={hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
                allTags={allTags}
                filters={filters}
                filterableFields={filterableFields}
                onAddFilter={addFilter}
                onRemoveFilter={removeFilter}
                onClearFilters={clearFilters}
                onFieldSearch={handleFieldSearch}
                isSearchingFields={isSearchingKeys || isSearchingMetrics}
                searchQuery={searchInput}
                onSearchChange={handleSearchChange}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                onSelectFirstN={selectFirstN}
                onSelectAllByIds={selectAllByIds}
                onDeselectAll={deselectAll}
                onShuffleColors={shuffleColors}
                customColumns={customColumns}
                availableConfigKeys={[
                  ...(columnKeysData?.configKeys?.map((k) => k.key) ?? []),
                  ...(searchKeysData?.configKeys?.map((k) => k.key).filter((k) => !columnKeysData?.configKeys?.some((ck) => ck.key === k)) ?? []),
                ]}
                availableSystemMetadataKeys={[
                  ...(columnKeysData?.systemMetadataKeys?.map((k) => k.key) ?? []),
                  ...(searchKeysData?.systemMetadataKeys?.map((k) => k.key).filter((k) => !columnKeysData?.systemMetadataKeys?.some((sk) => sk.key === k)) ?? []),
                ]}
                availableMetricNames={metricNames}
                onColumnToggle={handleColumnToggle}
                onClearColumns={handleClearColumns}
                columnKeysLoading={columnKeysLoading}
                onColumnSearch={handleFieldSearch}
                isSearchingColumns={isSearchingKeys || isSearchingMetrics}
                onColumnRename={handleColumnRename}
                onColumnSetColor={handleColumnSetColor}
                onColumnRemove={handleColumnRemove}
                nameOverrides={nameOverrides}
                onNameRename={handleNameRename}
                onNameSetColor={handleNameSetColor}
                onReorderColumns={reorderColumns}
                sorting={sorting}
                onSortingChange={setSorting}
                pageSize={pageSize}
                onPageSizeChange={handlePageSizeChange}
                viewSelector={
                  <RunTableViewSelector
                    organizationId={organizationId}
                    projectName={projectName}
                    currentColumns={customColumns}
                    currentBaseOverrides={baseOverrides}
                    currentFilters={filters}
                    currentSorting={sorting}
                    currentPageSize={pageSize}
                    activeViewId={activeViewId}
                    onActiveViewChange={setActiveViewId}
                    onLoadView={handleLoadView}
                    onResetToDefault={handleResetToDefault}
                  />
                }
                onRunHover={setHoveredRunId}
              />
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            id="metrics-display"
          >
            <div className="flex h-full flex-col overflow-y-auto overscroll-y-contain pl-2">
              {(isLoading || runCountLoading) && runs.length === 0 ? (
                <Skeleton className="h-full w-full" />
              ) : (
                <>
                  {viewMode === "side-by-side" && (
                    <SideBySideView
                      selectedRunsWithColors={selectedRunsWithColors}
                      onRemoveRun={(runId) => handleRunSelection(runId, false)}
                      organizationId={organizationId}
                      projectName={projectName}
                    />
                  )}
                  <div className={`relative h-full ${viewMode === "side-by-side" ? "hidden" : ""}`}>
                    <MetricsDisplay
                      groupedMetrics={groupedMetrics}
                      onRefresh={refresh}
                      organizationId={organizationId}
                      projectName={projectName}
                      lastRefreshed={lastRefreshed}
                      selectedRuns={selectedRunsWithColors}
                      selectedViewId={chart ?? null}
                      onViewChange={handleViewChange}
                      tableHighlightedRunId={hoveredRunId}
                    />
                    {isRefreshing && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/50">
                        <Spinner size="large" />
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </PageLayout>
    </RunComparisonLayout>
  );
}
