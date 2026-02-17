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
import LineSettings from "./~components/line-settings";
import { useLineSettings } from "./~components/use-line-settings";
import { SmoothingSlider } from "@/components/charts/smoothing-slider";

import { useMemo } from "react";

export const Route = createFileRoute(
  "/o/$orgSlug/_authed/(run)/projects/$projectName/$runId/",
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
      projectName: params.projectName,
      runId: params.runId,
    };
  },
  component: RouteComponent,
  errorComponent: RunNotFound,
});

function RouteComponent() {
  const { organizationId, projectName, runId } = Route.useRouteContext();

  const { data: runData, isLoading } = useGetRun(
    organizationId,
    projectName,
    runId,
  );

  const { lastRefreshTime, handleRefresh } = useRefreshTime({
    runId,
    onRefresh: refreshAllData,
    defaultAutoRefresh: runData?.status === "RUNNING",
    refreshInterval: 5000,
  });

  const {
    settings,
    updateSettings,
    updateSmoothingSettings,
    getSmoothingConfig,
  } = useLineSettings(organizationId, projectName, runId);

  const { filteredLogGroups, handleSearch } = useFilteredLogs({
    logs: runData?.logs || [],
    groupFilter: (group) =>
      // Exclude file-based logs from metrics view (they're shown on summary page)
      !group.logs.every(
        (log) =>
          log.logType === "TEXT" ||
          log.logType === "FILE" ||
          log.logType === "ARTIFACT"
      ),
  });

  // Memoize the rendered DataGroups to prevent recreation on every render
  const dataGroups = useMemo(() => {
    return filteredLogGroups.map((group: LogGroup) => (
      <DataGroup
        key={group.groupName}
        group={group}
        tenantId={organizationId}
        projectName={projectName}
        runId={runId}
      />
    ));
  }, [filteredLogGroups, organizationId, projectName, runId]);

  if (isLoading || !runData) {
    return (
      <SkeletonLayout title={`${runData.name}`} projectName={projectName} />
    );
  }

  return (
    <Layout
      run={runData}
      projectName={projectName}
      runId={runId}
      title={`${runData.name}`}
      organizationId={organizationId}
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Run Metrics</h2>
            <div className="flex items-center gap-3">
              <SmoothingSlider
                settings={settings}
                updateSmoothingSettings={updateSmoothingSettings}
                updateSettings={updateSettings}
                getSmoothingConfig={getSmoothingConfig}
              />
              <RefreshButton
                onRefresh={handleRefresh}
                lastRefreshed={lastRefreshTime || undefined}
                defaultInterval={runData.status === "RUNNING" ? 5_000 : null}
                storageKey={`refresh-interval:run:${runId}`}
              />
              <LineSettings
                organizationId={organizationId}
                projectName={projectName}
                runId={runId}
              />
            </div>
          </div>
          <LogSearch onSearch={handleSearch} placeholder="Search metrics..." />
        </div>
        {dataGroups}
      </div>
    </Layout>
  );
}
