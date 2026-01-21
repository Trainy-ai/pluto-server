import { queryClient, trpc } from "@/utils/trpc";
import { createFileRoute } from "@tanstack/react-router";
import RunComparisonLayout from "@/components/layout/runComparison/layout";
import PageLayout from "@/components/layout/page-layout";
import { OrganizationPageTitle } from "@/components/layout/page-title";
import { useState, useMemo, useCallback } from "react";
import { useSelectedRuns } from "./~hooks/use-selected-runs";
import { prefetchListRuns, useListRuns, type Run } from "./~queries/list-runs";
import { useUpdateTags } from "./~queries/update-tags";
import { useDistinctTags } from "./~queries/distinct-tags";
import { groupMetrics } from "./~lib/metrics-utils";
import { MetricsDisplay } from "./~components/metrics-display";
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

export const Route = createFileRoute(
  "/o/$orgSlug/_authed/(runComparison)/projects/$projectName/",
)({
  component: RouteComponent,
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
function RouteComponent() {
  const { organizationId, projectName, organizationSlug } =
    Route.useRouteContext();

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

  const {
    runColors,
    selectedRunsWithColors,
    handleRunSelection,
    handleColorChange,
    defaultRowSelection,
  } = useSelectedRuns(runs);

  // Process metrics data from selected runs
  const groupedMetrics = useMemo(() => {
    const metrics = groupMetrics(selectedRunsWithColors);
    return metrics;
  }, [selectedRunsWithColors]);

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
          >
            <div className="flex h-full flex-col pr-2 overflow-y-auto overscroll-y-contain">
              <DataTable
                runs={runs}
                orgSlug={organizationSlug}
                projectName={projectName}
                onColorChange={handleColorChange}
                onSelectionChange={handleRunSelection}
                onTagsUpdate={handleTagsUpdate}
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
                <div className="relative h-full">
                  <MetricsDisplay
                    groupedMetrics={groupedMetrics}
                    onRefresh={refresh}
                    organizationId={organizationId}
                    projectName={projectName}
                    lastRefreshed={lastRefreshed}
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
