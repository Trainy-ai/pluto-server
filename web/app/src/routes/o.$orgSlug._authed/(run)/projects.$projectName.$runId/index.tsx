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
import LineSettings from "@/routes/o.$orgSlug._authed/(runComparison)/projects.$projectName/~components/line-settings";
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
import { ImageStepSyncProvider } from "./~context/image-step-sync-context";
import { searchUtils, type SearchState } from "../../(runComparison)/projects.$projectName/~lib/search-utils";
import { useChartsLayout } from "../../(runComparison)/projects.$projectName/~queries/charts-layout";
import {
  applyChartsSections,
  EMPTY_CHARTS_LAYOUT,
} from "../../(runComparison)/projects.$projectName/~lib/charts-layout";
import { useRunDashboardData } from "./~hooks/use-run-dashboard";
import { useGetFileLogTypes } from "./~queries/get-file-log-types";
import {
  FILE_LOG_TYPES,
  isHiddenArtifactLog,
  isRenderableInWidget,
  keepVisibleFileLogs,
} from "@/lib/file-types";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";

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

  useDocumentTitle(runData ? `${runId}(${runData.name})` : runId);

  const { lastRefreshTime, handleRefresh } = useRefreshTime({
    runId,
    onRefresh: refreshAllData,
  });

  const {
    settings,
    updateSettings,
    updateSmoothingSettings,
    getSmoothingConfig,
  } = useLineSettings(organizationId, projectName, runId);

  // Does this run log a file whose type could still change an answer below?
  //
  // Nothing to probe when the run logs no files at all (every project that
  // isn't a wandb migration and doesn't log artifacts), and equally nothing to
  // probe when its only file logs are wandb artifact dumps — those are hidden
  // by NAME, whatever their files turn out to be. Either way the request is
  // skipped rather than paid for on the run page's hot path.
  const hasFileLogs = useMemo(
    () =>
      (runData?.logs ?? []).some(
        (log) =>
          FILE_LOG_TYPES.has(log.logType) &&
          !isHiddenArtifactLog(log.logType, log.logName),
      ),
    [runData?.logs],
  );

  // `RunLogs` records only a log's TYPE, and the decision below needs its
  // files' EXTENSIONS — so this asks for the run's distinct
  // `(logName, fileType)` pairs and nothing else. Deliberately NOT `fileTree`:
  // that returns a row per file (up to 10,000) with captions and per-image
  // annotations, which for an image-heavy run is multi-MB fetched, superjson-
  // traversed and cached to IndexedDB purely to learn a handful of extensions.
  //
  // The error is intentionally unhandled. A failed probe leaves
  // `renderableFileLogNames` empty, which hides file-only groups — exactly the
  // behaviour this page had before they could be rendered at all, and a strictly
  // better failure than filling the page with widgets that cannot draw. The
  // groups stay reachable on the Files tab, which surfaces its own error.
  const { data: runFileTypes } = useGetFileLogTypes(
    organizationId,
    projectName,
    runId,
    { enabled: hasFileLogs },
  );

  // Log names carrying at least one file a widget can actually draw.
  const renderableFileLogNames = useMemo(() => {
    const names = new Set<string>();
    for (const file of runFileTypes ?? []) {
      if (isRenderableInWidget(file.fileType)) names.add(file.logName);
    }
    return names;
  }, [runFileTypes]);

  // Is there anything left in this group once the hidden logs are removed?
  //
  // A file-only group used to be a Files/Summary concern outright, EXCEPT that
  // since the wandb-migration work a logged file is no longer only "a thing you
  // download": a `.json` may be an interactive Plotly figure, a converted
  // matplotlib figure or a 3D point cloud, and an `.html` an interactive report
  // — all of which render in a widget exactly like a metric does. The blanket
  // rule predates those viewers and could not tell them apart from a parquet
  // dump, which is why they showed on the all-runs comparison page but vanished
  // on the run's own page.
  //
  // `keepVisibleFileLogs` is the shared decision (see `lib/file-types.ts`) and
  // is applied again to build each group's contents, so what is shown and what
  // the group was admitted for can never disagree. While the probe is still in
  // flight `renderableFileLogNames` is empty, which reproduces the old
  // behaviour — nothing flashes in and then out.
  const groupFilter = useCallback(
    (group: LogGroup) =>
      keepVisibleFileLogs(group.logs, renderableFileLogNames).length > 0,
    [renderableFileLogNames],
  );

  const { filteredLogGroups, handleSearch: handleLogSearch } = useFilteredLogs({
    logs: runData?.logs || [],
    groupFilter,
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

  // Compute run createdAt as ISO string for relative time baseline
  const runCreatedAtStr = useMemo(() => {
    if (!runData?.createdAt) return undefined;
    return runData.createdAt instanceof Date
      ? runData.createdAt.toISOString()
      : String(runData.createdAt);
  }, [runData?.createdAt]);

  // Shared project layout overlay (arranged in the all-runs Charts view):
  // this view applies it read-only so a single run shows the same section
  // order, hidden sections, and per-section chart order as the Charts view.
  const { data: chartsLayoutData } = useChartsLayout(organizationId, projectName);
  const chartsLayout = chartsLayoutData?.config ?? EMPTY_CHARTS_LAYOUT;

  // Memoize the rendered DataGroups for "All Metrics" view
  const dataGroups = useMemo(() => {
    const laidOut = applyChartsSections(
      filteredLogGroups
        .map((group: LogGroup) => ({
          key: group.groupName,
          groupName: group.groupName,
          items: keepVisibleFileLogs(group.logs, renderableFileLogNames),
        }))
        // CAN empty a group, which is why this filter is here: `groupFilter`
        // runs BEFORE the search filter (`use-filtered-logs.ts`), so a search
        // that matches only the hidden logs of an admitted group leaves nothing
        // to draw — and a section header over an empty grid is worse than no
        // section.
        .filter((group) => group.items.length > 0),
      (log) => log.logName,
      chartsLayout,
    );
    return laidOut
      .filter((g) => !g.hidden)
      .map(({ key, groupName, items }) => (
        <DataGroup
          key={key}
          group={{ groupName, logs: items }}
          tenantId={organizationId}
          projectName={projectName}
          runId={runId}
          runCreatedAt={runCreatedAtStr}
          runName={runData?.name}
          savedChartOrder={chartsLayout.metricOrder?.[key]}
        />
      ));
  }, [filteredLogGroups, renderableFileLogNames, chartsLayout, organizationId, projectName, runId, runCreatedAtStr, runData?.name]);

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
              logNames={runData?.logs?.filter((l: { logType: string }) => l.logType === "METRIC").map((l: { logName: string }) => l.logName) ?? []}
              settingsKey={runId}
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
              {/* One shared step-sync provider so media steppers sync across
                  every section in the All-Metrics view (each DataGroup reuses
                  this instead of creating its own per-section provider). */}
              <ImageStepSyncProvider>
                {dataGroups}
              </ImageStepSyncProvider>
            </ChartSyncProvider>
          )}
        </div>
      </div>
    </Layout>
  );
}
