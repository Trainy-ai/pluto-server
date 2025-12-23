import { queryClient, trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import RunsLayout from "@/components/layout/run/layout";
import PageLayout from "@/components/layout/page-layout";
import { OrganizationPageTitle } from "@/components/layout/page-title";
import { RunNotFound } from "@/components/layout/run/not-found";
import { Skeleton } from "@/components/ui/skeleton";
import { DataGroup } from "./~components/group/group";
import { RefreshButton } from "@/components/core/refresh-button";

import { useRefreshTime } from "./~hooks/use-refresh-time";
import { useFilteredLogs } from "./~hooks/use-filtered-logs";
import { LogSearch } from "../../(runComparison)/projects.$projectName/~components/run-comparison/search";
import { RunStatusBadge } from "@/components/core/runs/run-status-badge";
import type { LogGroup } from "./~hooks/use-filtered-logs";
import { prefetchGetRun, useGetRun } from "./~queries/get-run";
import { Layout, SkeletonLayout } from "./~components/layout";
import { refreshAllData } from "./~queries/refresh-all-data";

export const Route = createFileRoute(
  "/o/$orgSlug/_authed/(run)/projects/$projectName/$runId/system",
)({
  beforeLoad: async ({ context, params }) => {
    const auth = context.auth;

    await prefetchGetRun(
      auth.activeOrganization.id,
      params.projectName,
      params.runId,
    );

    return {
      organizationId: auth.activeOrganization.id,
    };
  },

  component: RouteComponent,
  errorComponent: RunNotFound,
});

function RouteComponent() {
  const { organizationId } = Route.useRouteContext();
  const { projectName, runId } = Route.useParams();

  // Query for the run data
  const { data: runData, isLoading } = useGetRun(
    organizationId,
    projectName,
    runId,
  );

  const { lastRefreshTime, handleRefresh } = useRefreshTime({
    runId,
    onRefresh: refreshAllData,
    defaultAutoRefresh: runData?.status === "RUNNING",
    refreshInterval: 10000,
  });

  const { filteredLogGroups, handleSearch } = useFilteredLogs({
    logs: runData?.logs || [],
    groupFilter: (group) =>
      // Legacy support for sys, system, and _sys
      group.groupName === "sys" ||
      group.groupName === "system" ||
      group.groupName === "_sys",
  });

  if (isLoading || !runData) {
    return <SkeletonLayout title={`${runId}`} projectName={projectName} />;
  }

  return (
    <Layout
      run={runData}
      projectName={projectName}
      runId={runId}
      title="System Metrics"
      organizationId={organizationId}
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">System Metrics</h2>
            <RefreshButton
              onRefresh={handleRefresh}
              lastRefreshed={lastRefreshTime || undefined}
              defaultAutoRefresh={runData.status === "RUNNING"}
              refreshInterval={10_000}
            />
          </div>
          <LogSearch
            onSearch={handleSearch}
            placeholder="Search system metrics..."
          />
        </div>
        {filteredLogGroups.map((group: LogGroup) => (
          <DataGroup
            key={group.groupName}
            group={group}
            tenantId={organizationId}
            projectName={projectName}
            runId={runId}
          />
        ))}
      </div>
    </Layout>
  );
}
