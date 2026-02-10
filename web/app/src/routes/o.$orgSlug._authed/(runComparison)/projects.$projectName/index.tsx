import { queryClient, trpc } from "@/utils/trpc";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import RunComparisonLayout from "@/components/layout/runComparison/layout";
import PageLayout from "@/components/layout/page-layout";
import { OrganizationPageTitle } from "@/components/layout/page-title";
import { useState, useMemo, useCallback, useEffect } from "react";
import { useSelectedRuns } from "./~hooks/use-selected-runs";
import { prefetchListRuns, useListRuns, type Run } from "./~queries/list-runs";
import { useSelectedRunLogs } from "./~queries/selected-run-logs";
import { useUpdateTags } from "./~queries/update-tags";
import { useUpdateNotes } from "./~queries/update-notes";
import { useDistinctTags } from "./~queries/distinct-tags";
import { groupMetrics } from "./~lib/metrics-utils";
import { MetricsDisplay } from "./~components/metrics-display";
import { SideBySideView } from "./~components/side-by-side/side-by-side-view";
import { DataTable } from "./~components/runs-table/data-table";
import { useRefresh } from "./~hooks/use-refresh";
import { useRunCount } from "./~queries/run-count";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useDebouncedCallback } from "@/lib/hooks/use-debounced-callback";

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

  // Tag filter state
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  // Status filter state
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
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

  const { refresh, lastRefreshed } = useRefresh({
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
    selectedTags,
    selectedStatuses,
    debouncedSearch,
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
    error,
  } = useListRuns(organizationId, projectName, selectedTags, selectedStatuses, debouncedSearch);

  // Mutation for updating tags
  const updateTagsMutation = useUpdateTags(organizationId, projectName);

  // Mutation for updating notes
  const updateNotesMutation = useUpdateNotes(organizationId, projectName);

  // Fetch all distinct tags across all runs in the project
  // This ensures the filter dropdown shows all available tags, not just those from loaded runs
  const { data: distinctTagsData } = useDistinctTags(organizationId, projectName);
  const allTags = distinctTagsData?.tags ?? [];

  // Flatten the pages to get all runs
  const runs = useMemo(() => {
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
        uniqueRuns.set(run.id, run);
      }
    });

    return Array.from(uniqueRuns.values());
  }, [data]);

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
    defaultRowSelection,
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
                onColorChange={handleColorChange}
                onSelectionChange={handleRunSelection}
                onTagsUpdate={handleTagsUpdate}
                onNotesUpdate={handleNotesUpdate}
                selectedRunsWithColors={selectedRunsWithColors}
                runColors={runColors}
                defaultRowSelection={defaultRowSelection}
                isLoading={isLoading || runCountLoading}
                isFetching={isFetching}
                runCount={runCount || 0}
                fetchNextPage={fetchNextPage}
                hasNextPage={hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
                allTags={allTags}
                selectedTags={selectedTags}
                onTagFilterChange={setSelectedTags}
                selectedStatuses={selectedStatuses}
                onStatusFilterChange={setSelectedStatuses}
                searchQuery={searchInput}
                onSearchChange={handleSearchChange}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                onSelectFirstN={selectFirstN}
                onSelectAllByIds={selectAllByIds}
                onDeselectAll={deselectAll}
                onShuffleColors={shuffleColors}
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
              ) : viewMode === "side-by-side" ? (
                <SideBySideView
                  selectedRunsWithColors={selectedRunsWithColors}
                  onRemoveRun={(runId) => handleRunSelection(runId, false)}
                />
              ) : (
                <div className="relative h-full">
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
                  {isFetching && runs.length > 0 && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/50">
                      <Spinner size="large" />
                    </div>
                  )}
                </div>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </PageLayout>
    </RunComparisonLayout>
  );
}
