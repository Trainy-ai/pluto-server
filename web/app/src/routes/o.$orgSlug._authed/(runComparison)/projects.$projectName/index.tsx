import { queryClient, trpc } from "@/utils/trpc";
import { createFileRoute } from "@tanstack/react-router";
import RunComparisonLayout from "@/components/layout/runComparison/layout";
import PageLayout from "@/components/layout/page-layout";
import { OrganizationPageTitle } from "@/components/layout/page-title";
import { useState, useMemo } from "react";
import { useSelectedRuns } from "./~hooks/use-selected-runs";
import { prefetchListRuns, useListRuns, type Run } from "./~queries/list-runs";
import { groupMetrics } from "./~lib/metrics-utils";
import { MetricsDisplay } from "./~components/metrics-display";
import { DataTable } from "./~components/runs-table/data-table";
import { useRefresh } from "./~hooks/use-refresh";
import { useRunCount } from "./~queries/run-count";
import { Skeleton } from "@/components/ui/skeleton";

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
  );

  // Load runs using infinite query with standard TanStack/tRPC v11 approach
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
  } = useListRuns(organizationId, projectName);

  console.log("data", data);

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
        <div className="flex h-[calc(100vh-4rem)] w-full gap-2 p-2">
          <div className="flex h-full flex-col">
            <DataTable
              runs={runs}
              orgSlug={organizationSlug}
              projectName={projectName}
              onColorChange={handleColorChange}
              onSelectionChange={handleRunSelection}
              selectedRunsWithColors={selectedRunsWithColors}
              runColors={runColors}
              defaultRowSelection={defaultRowSelection}
              isLoading={isLoading || runCountLoading}
              runCount={runCount || 0}
              fetchNextPage={fetchNextPage}
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
            />
          </div>
          {isLoading || runCountLoading ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <MetricsDisplay
              groupedMetrics={groupedMetrics}
              onRefresh={refresh}
              organizationId={organizationId}
              projectName={projectName}
              lastRefreshed={lastRefreshed}
            />
          )}
        </div>
      </PageLayout>
    </RunComparisonLayout>
  );
}
