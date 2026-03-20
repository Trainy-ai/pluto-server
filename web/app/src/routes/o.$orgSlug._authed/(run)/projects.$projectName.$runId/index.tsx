import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RunNotFound } from "@/components/layout/run/not-found";
import { DataGroup } from "./~components/group/group";
import { RefreshButton } from "@/components/core/refresh-button";
import { useRefreshTime } from "./~hooks/use-refresh-time";
import { useFilteredLogs } from "./~hooks/use-filtered-logs";
import { LogSearch } from "../../(runComparison)/projects.$projectName/~components/run-comparison/search";
import type { LogGroup } from "./~hooks/use-filtered-logs";
import { prefetchGetRun, useGetRun } from "./~queries/get-run";
import { Layout, SkeletonLayout } from "./~components/layout";
import { refreshAllData } from "./~queries/refresh-all-data";
import LineSettings from "./~components/line-settings";
import { useLineSettings } from "./~components/use-line-settings";
import { SmoothingSlider } from "@/components/charts/smoothing-slider";
import {
  DashboardViewSelector,
  DashboardBuilder,
} from "../../(runComparison)/projects.$projectName/~components/dashboard-builder";
import {
  useDashboardViews,
  useDashboardView,
} from "../../(runComparison)/projects.$projectName/~queries/dashboard-views";
import { ChartSyncProvider } from "@/components/charts/context/chart-sync-context";
import { clearAllChartBounds } from "../../(runComparison)/projects.$projectName/~components/multi-group/chart-card-wrapper";
import { searchUtils, type SearchState } from "../../(runComparison)/projects.$projectName/~lib/search-utils";
import { useRunDashboardData } from "./~hooks/use-run-dashboard";
import { RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";

// Search params for run route - supports ?chart=viewId to deep-link to a dashboard view
interface RunSearchParams {
  chart?: string;
}

export const Route = createFileRoute(
  "/o/$orgSlug/_authed/(run)/projects/$projectName/$runId/",
)({
  validateSearch: (search): RunSearchParams => {
    const result: RunSearchParams = {};
    if (typeof search.chart === "string" && search.chart.trim()) {
      result.chart = search.chart.trim();
    }
    return result;
  },
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
  const { chart } = Route.useSearch();

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

  const { filteredLogGroups, handleSearch: handleLogSearch } = useFilteredLogs({
    logs: runData?.logs || [],
    groupFilter: (group) =>
      // Exclude file-based logs from metrics view (they're shown on summary page)
      !group.logs.every(
        (log) =>
          log.logType === "TEXT" ||
          log.logType === "FILE" ||
          log.logType === "ARTIFACT",
      ),
  });

  // Search state for dashboard widget filtering
  const [searchState, setSearchState] = useState<SearchState>({
    query: "",
    isRegex: false,
    regex: null,
  });

  const handleSearch = useCallback((query: string, isRegex: boolean) => {
    handleLogSearch(query, isRegex);
    setSearchState(searchUtils.createSearchState(query, isRegex));
  }, [handleLogSearch]);

  // --- Dashboard view integration ---
  const navigate = useNavigate();
  const { data: viewsData } = useDashboardViews(organizationId, projectName);

  // Auto-select default dashboard view and update URL
  const hasAutoSelected = useRef(false);
  useEffect(() => {
    if (hasAutoSelected.current || chart) return;
    if (!viewsData?.views?.length) return;

    const defaultView = viewsData.views.find(
      (v: { isDefault: boolean }) => v.isDefault,
    );
    if (defaultView) {
      hasAutoSelected.current = true;
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          chart: defaultView.id,
        }),
        replace: true,
      });
    }
  }, [viewsData, chart, navigate]);

  // URL is the source of truth for the selected view
  const selectedViewId = chart ?? null;
  const { data: selectedView } = useDashboardView(
    organizationId,
    selectedViewId,
  );

  const handleViewChange = useCallback(
    (viewId: string | null) => {
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          chart: viewId || undefined,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  // Build dashboard data (groupedMetrics + selectedRuns) from single run
  const { groupedMetrics, selectedRuns } = useRunDashboardData(runData, runId);

  // Bounds reset - clearing localStorage + remounting charts via key change
  const [boundsResetKey, setBoundsResetKey] = useState(0);
  const handleResetAllBounds = useCallback(() => {
    clearAllChartBounds();
    setBoundsResetKey((k) => k + 1);
  }, []);

  // Compute run createdAt as ISO string for relative time baseline
  const runCreatedAtStr = useMemo(() => {
    if (!runData?.createdAt) return undefined;
    return runData.createdAt instanceof Date
      ? runData.createdAt.toISOString()
      : String(runData.createdAt);
  }, [runData?.createdAt]);

  // Memoize the rendered DataGroups for "All Metrics" view
  const dataGroups = useMemo(() => {
    return filteredLogGroups.map((group: LogGroup) => (
      <DataGroup
        key={group.groupName}
        group={group}
        tenantId={organizationId}
        projectName={projectName}
        runId={runId}
        boundsResetKey={boundsResetKey}
        runCreatedAt={runCreatedAtStr}
        runName={runData?.name}
      />
    ));
  }, [filteredLogGroups, organizationId, projectName, runId, boundsResetKey, runCreatedAtStr, runData?.name]);

  if (isLoading || !runData) {
    return (
      <SkeletonLayout title={`${runData?.name}`} projectName={projectName} />
    );
  }

  const isDashboardView = selectedViewId && selectedView;

  return (
    <Layout
      run={runData}
      projectName={projectName}
      runId={runId}
      title={`${runData.name}`}
      organizationId={organizationId}
      disableScroll
    >
      <div className="flex h-full flex-col overflow-y-auto overscroll-y-contain">
        <div className="sticky top-0 z-20 flex items-center gap-4 bg-background px-4 pt-4 pb-2">
          <DashboardViewSelector
            organizationId={organizationId}
            projectName={projectName}
            selectedViewId={selectedViewId}
            onViewChange={handleViewChange}
          />
          <div className="flex-1 max-w-[320px]">
            <LogSearch onSearch={handleSearch} placeholder="Search groups and metrics..." />
          </div>
          <div className="ml-auto flex items-center gap-3">
            {!isDashboardView && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground"
                onClick={handleResetAllBounds}
                title="Reset all Y-axis bounds"
              >
                <RotateCcwIcon className="mr-1.5 size-3.5" />
                Reset Bounds
              </Button>
            )}
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

        <div className="flex flex-col gap-4 px-4 pb-4">
          {isDashboardView ? (
            <ChartSyncProvider syncKey={`run-dashboard-${selectedViewId}`}>
              <DashboardBuilder
                view={selectedView}
                groupedMetrics={groupedMetrics}
                selectedRuns={selectedRuns}
                organizationId={organizationId}
                projectName={projectName}
                settingsRunId={runId}
                searchState={searchState}
              />
            </ChartSyncProvider>
          ) : (
            <ChartSyncProvider syncKey={`run-all-metrics-${runId}`}>
              {dataGroups}
            </ChartSyncProvider>
          )}
        </div>
      </div>
    </Layout>
  );
}
