import { useMemo, useRef, useEffect, useState, memo } from "react";
import { RefreshButton } from "@/components/core/refresh-button";
import { LogSearch } from "./run-comparison/search";
import { MemoizedMultiGroup } from "./multi-group/multi-group";
import { VirtualizedGroup } from "@/components/core/virtualized-group";
import { sortGroups } from "@/lib/grouping/index";
import type { GroupedMetrics } from "@/lib/grouping/types";
import {
  searchUtils,
  type SearchState,
  type SearchIndex,
} from "../~lib/search-utils";
import LineSettings from "./line-settings";
import { SmoothingSlider } from "@/components/charts/smoothing-slider";

import { useLineSettings } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/use-line-settings";
import { DashboardViewSelector, DashboardBuilder } from "./dashboard-builder";
import { useDashboardView, type DashboardView } from "../~queries/dashboard-views";
import { useChartsLayoutEditor } from "./charts-layout-edit/use-charts-layout-editor";
import { ChartsLayoutEditBanner } from "./charts-layout-edit/charts-layout-edit-banner";
import { ChartsLayoutEditProvider } from "@/components/charts/context/charts-layout-edit-context";
import { Button } from "@/components/ui/button";
import { SlidersHorizontal } from "lucide-react";
import type { SelectedRunWithColor } from "../~hooks/use-selected-runs";
import { ChartSyncProvider } from "@/components/charts/context/chart-sync-context";
import { FullscreenProvider } from "@/components/charts/context/fullscreen-context";
import { getLogGroupLabel, MEDIA_GROUP } from "@/lib/grouping/consts";
import { useQueries } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import {
  FILE_LOG_TYPES,
  isFileLogWidgetVisible,
  isHiddenArtifactLog,
  isRenderableInWidget,
} from "@/lib/file-types";

/**
 * Reduces the per-run file-type probes to the log names a widget can render.
 *
 * Module scope on purpose. `useQueries` recomputes its combined result whenever
 * the `combine` function's identity changes, so an inline arrow would re-run
 * this every render. Hoisted, it re-runs only when the queries themselves do.
 *
 * `combineFileTreeProbes` before it: the probe now asks `fileLogTypes` for the
 * run's distinct `(logName, fileType)` pairs instead of `fileTree`'s row per
 * file, which is the same information for this purpose and orders of magnitude
 * less of it. The reducer is unchanged because those are the only two fields it
 * ever read.
 *
 * Returns plain sorted primitives rather than a Set because query-core passes
 * the combined result through `replaceEqualDeep`, which compares arrays and
 * objects structurally but treats a Set as an opaque value. A stable identity
 * here is the whole point: without it everything memoised downstream — and
 * ultimately the `metrics` array each MemoizedMultiGroup is memoised on —
 * recomputes on every render.
 *
 * Two name lists, not one. The probe covers only a SAMPLE of the selected runs
 * (see `probeRunIds`), so "absent from `renderableNames`" conflates two very
 * different states: a log the probe saw and rejected, and a log the probe never
 * saw at all. `probedNames` separates them — see `isFileLogWidgetVisible`.
 */
function combineFileTypeProbes(results: readonly { data: unknown }[]): {
  renderableNames: string[];
  probedNames: string[];
} {
  const names = new Set<string>();
  const probed = new Set<string>();
  for (const q of results) {
    if (q.data == null) continue;
    for (const file of q.data as { logName: string; fileType: string }[]) {
      probed.add(file.logName);
      if (isRenderableInWidget(file.fileType)) names.add(file.logName);
    }
  }
  return {
    // Sorted so two probes returning the same names in a different order still
    // deep-compare equal.
    renderableNames: [...names].sort(),
    // Empty until a probe lands, which makes every log "unseen" and therefore
    // visible — nothing flashes out and then back in mid-load. This replaces
    // the old `fileTypesKnown` flag, which had to exist only because a single
    // list could not express "not looked at yet".
    probedNames: [...probed].sort(),
  };
}

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
  showInheritedMetrics?: boolean;
  onInheritedChange?: (value: boolean) => void;
  /** Experiment run ID lookup for group highlighting in experiments mode */
  experimentRunIdsMap?: Map<string, string[]> | null;
  /** Run IDs marked hidden — passed into ChartSyncProvider so charts mounting
   *  after a state change see the right value via the synchronous ref-sync path. */
  hiddenRunIds?: Set<string>;
  /** Encoded grouping chain — when non-empty, line-chart widgets render
   *  one aggregated line + min/max band per group instead of one line
   *  per run. */
  groupBy?: string[];
}

/**
 * Main component for displaying metrics groups with search and refresh capabilities
 * Handles the filtering of metrics based on search criteria
 */
export const MetricsDisplay = memo(function MetricsDisplay({
  groupedMetrics,
  onSearch,
  onRefresh,
  organizationId,
  projectName,
  lastRefreshed,
  selectedRuns = {},
  selectedViewId: externalSelectedViewId,
  onViewChange: externalOnViewChange,
  showInheritedMetrics: externalShowInherited,
  onInheritedChange,
  experimentRunIdsMap,
  hiddenRunIds,
  groupBy,
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

  const {
    settings,
    updateSettings,
    updateSmoothingSettings,
    getSmoothingConfig,
  } = useLineSettings(organizationId, projectName, "full");

  // Sync inherited metrics: URL param → setting (on load)
  useEffect(() => {
    if (externalShowInherited !== undefined && externalShowInherited !== settings.showInheritedMetrics) {
      updateSettings("showInheritedMetrics", externalShowInherited);
    }
  }, [externalShowInherited]);

  // Sync inherited metrics: setting → URL param (on toggle in drawer)
  // Skip the initial render to avoid overwriting the URL param on load
  const inheritedInitRef = useRef(true);
  useEffect(() => {
    if (inheritedInitRef.current) {
      inheritedInitRef.current = false;
      return;
    }
    if (onInheritedChange) {
      onInheritedChange(settings.showInheritedMetrics);
    }
  }, [settings.showInheritedMetrics, onInheritedChange]);


  const uniqueLogNames = Object.keys(groupedMetrics)
    .map((group) =>
      groupedMetrics[group].metrics
        .filter((metric) => metric.type === "METRIC")
        .map((metric) => metric.name),
    )
    .flat();

  // Memoize the sorted base groups
  // Migrated wandb runs push two unrelated things through FILE/TEXT/ARTIFACT:
  //
  //   1. Media the run actually logged — a wandb.Html page, an Object3D point
  //      cloud. These belong beside images/video in "media".
  //   2. wandb's own artifact dumps, one per source run, named
  //      `run-<wandbRunId>-<name>:v<n>` (65 of them in mega-unsupported, all
  //      raw JSON). Plumbing, not content — each rendered a widget whose only
  //      payload was a link, burying (1).
  //
  // Re-home before grouping so sections, counts and the search index all agree;
  // doing it downstream only moved the widgets and left a stale "files" header.
  const adjustedGroupedMetrics = useMemo(() => {
    const out: GroupedMetrics = {};
    const rehomed: GroupedMetrics[string]["metrics"] = [];

    for (const [group, data] of Object.entries(groupedMetrics)) {
      const kept: GroupedMetrics[string]["metrics"] = [];
      for (const m of data.metrics) {
        if (!FILE_LOG_TYPES.has(m.type)) kept.push(m);
        else if (isHiddenArtifactLog(m.type, m.name)) continue;
        else rehomed.push(m);
      }
      if (kept.length > 0) out[group] = { ...data, metrics: kept };
    }

    if (rehomed.length > 0) {
      const existing = out[MEDIA_GROUP]?.metrics ?? [];
      const seen = new Set(existing.map((m) => m.name));
      out[MEDIA_GROUP] = {
        // groupName is required by every consumer of a group entry — omitting
        // it when synthesising this group is what crashed the route before.
        groupName: MEDIA_GROUP,
        metrics: [...existing, ...rehomed.filter((m) => !seen.has(m.name))],
      };
    }
    return out;
  }, [groupedMetrics]);

  const sortedGroups = useMemo(() => {
    const time = performance.now();
    const sorted = sortGroups(adjustedGroupedMetrics);
    return sorted;
  }, [adjustedGroupedMetrics]);

  // Update search index only when metrics actually change
  useEffect(() => {
    const time = performance.now();
    const newIndex = searchUtils.createSearchIndex(adjustedGroupedMetrics);
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

  // Which file/artifact logs this view can actually render inline. A migrated
  // wandb project carries one artifact per source run (65 of them in
  // mega-unsupported: run-<wandbId>-bar_table:v0 and friends), all raw JSON —
  // a wall of widgets whose only content is a link. Only what a widget can
  // actually draw is worth one here; the rest stay reachable on the run's
  // Files tab.
  //
  // Probes a few selected runs rather than all of them: file *types* per
  // logName do not vary by run, so a handful is enough to classify, and
  // `fileLogTypes` is one small cached query per run — distinct
  // `(logName, fileType)` pairs, not the run's whole file list.
  //
  // Skipped entirely when the selection has no FILE/TEXT/ARTIFACT logs at all,
  // which is every project that wasn't migrated from wandb — the probe could
  // not change any answer there, so it is three requests for nothing on the
  // hot path.
  const hasFileLogs = useMemo(
    () =>
      Object.values(adjustedGroupedMetrics).some((g) =>
        g.metrics.some((m) => FILE_LOG_TYPES.has(m.type)),
      ),
    [adjustedGroupedMetrics],
  );
  const probeRunIds = useMemo(
    () => (hasFileLogs ? Object.keys(selectedRuns ?? {}).slice(0, 3) : []),
    [selectedRuns, hasFileLogs],
  );
  // `combine` is not a nicety here — see `combineFileTypeProbes`. Without it
  // `useQueries` hands back a fresh array every render, and every memo built on
  // it recomputes forever.
  const { renderableNames, probedNames } = useQueries({
    queries: probeRunIds.map((runId) =>
      trpc.runs.data.fileLogTypes.queryOptions({ runId, projectName, organizationId }),
    ),
    combine: combineFileTypeProbes,
  });
  const renderableFileLogNames = useMemo(
    () => new Set(renderableNames),
    [renderableNames],
  );
  const probedFileLogNames = useMemo(() => new Set(probedNames), [probedNames]);

  // Pre-compute filtered metrics for each group to avoid inline computation
  // This ensures MemoizedMultiGroup receives stable references when metrics haven't changed
  const filteredMetricsPerGroup = useMemo(() => {
    const metricsMap = new Map<string, typeof filteredGroups[0][1]["metrics"]>();
    filteredGroups.forEach(([group, data]) => {
      const searched = searchUtils.filterMetrics(
        group,
        data.metrics,
        searchIndexRef.current,
        searchState,
      );
      metricsMap.set(
        group,
        searched.filter((m) =>
          isFileLogWidgetVisible(
            m.type,
            m.name,
            renderableFileLogNames,
            probedFileLogNames,
          ),
        ),
      );
    });
    return metricsMap;
  }, [
    filteredGroups,
    searchState,
    renderableFileLogNames,
    probedFileLogNames,
  ]);

  const {
    isEditingLayout,
    startEditing,
    isLayoutLoaded,
    hasSections,
    visibleSections,
    orderedMetricsPerGroup,
    layoutEditApi,
    bannerProps,
  } = useChartsLayoutEditor({
    organizationId,
    projectName,
    sortedGroups,
    filteredMetricsPerGroup,
    searchActive: searchState.query.length > 0,
    selectedViewId,
  });

  // If a custom view is selected, render the DashboardBuilder
  if (selectedViewId && selectedView) {
    return (
      <ChartSyncProvider syncKey={`dashboard-${selectedViewId}`} experimentRunIdsMap={experimentRunIdsMap} hiddenRunIds={hiddenRunIds}>
        <FullscreenProvider>
        <div className="flex-1 space-y-4">
          <div className="sticky top-0 z-20 flex items-center gap-4 bg-background pb-2">
            <DashboardViewSelector
              organizationId={organizationId}
              projectName={projectName}
              selectedViewId={selectedViewId}
              onViewChange={setSelectedViewId}
            />
            <div className="flex-1 max-w-[320px]">
              <LogSearch
                onSearch={handleSearch}
                placeholder="Search groups and metrics..."
              />
            </div>
            <div className="ml-auto flex items-center gap-3">

              <SmoothingSlider
                settings={settings}
                updateSmoothingSettings={updateSmoothingSettings}
                updateSettings={updateSettings}
                getSmoothingConfig={getSmoothingConfig}
              />
              <RefreshButton
                onRefresh={onRefresh}
                lastRefreshed={lastRefreshed}
                storageKey={`refresh-interval:metrics:${projectName}`}
              />
              <LineSettings
                organizationId={organizationId}
                projectName={projectName}
                logNames={uniqueLogNames}
                showMaxSeriesCount
              />
            </div>
          </div>
          <DashboardBuilder
            view={selectedView}
            groupedMetrics={groupedMetrics}
            selectedRuns={selectedRuns}
            organizationId={organizationId}
            projectName={projectName}
            searchState={searchState}
            groupBy={groupBy}
            hiddenRunIds={hiddenRunIds}
          />
        </div>
        </FullscreenProvider>
      </ChartSyncProvider>
    );
  }

  // Default "All Metrics" view
  return (
    <ChartSyncProvider syncKey={`all-metrics-${projectName}`} experimentRunIdsMap={experimentRunIdsMap} hiddenRunIds={hiddenRunIds}>
      <FullscreenProvider>
      <div className="flex-1 space-y-4">
        <div className="sticky top-0 z-20 space-y-3 bg-background pb-2">
          <div className="flex items-center gap-4">
            <DashboardViewSelector
              organizationId={organizationId}
              projectName={projectName}
              selectedViewId={selectedViewId}
              onViewChange={setSelectedViewId}
            />
            <div className="flex-1 max-w-[320px]">
              <LogSearch
                onSearch={handleSearch}
                placeholder="Search groups and metrics..."
              />
            </div>
            <div className="ml-auto flex items-center gap-3">
              {!isEditingLayout && isLayoutLoaded && hasSections && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={startEditing}
                  data-testid="charts-layout-edit"
                >
                  <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
                  Edit layout
                </Button>
              )}
              <SmoothingSlider
                settings={settings}
                updateSmoothingSettings={updateSmoothingSettings}
                updateSettings={updateSettings}
                getSmoothingConfig={getSmoothingConfig}
              />
              <RefreshButton
                onRefresh={onRefresh}
                lastRefreshed={lastRefreshed}
                storageKey={`refresh-interval:metrics:${projectName}`}
              />
              <LineSettings
                organizationId={organizationId}
                projectName={projectName}
                logNames={uniqueLogNames}
              />
            </div>
          </div>
          {bannerProps && <ChartsLayoutEditBanner {...bannerProps} />}
        </div>
        <ChartsLayoutEditProvider value={layoutEditApi}>
          {visibleSections.map(({ key, groupName }) => {
            const metrics = orderedMetricsPerGroup.get(key) ?? [];
            return (
              <VirtualizedGroup
                key={key}
                groupId={`${projectName}-${key}`}
                groupTitle={getLogGroupLabel(groupName)}
                metricCount={metrics.length}
                disabled={isEditingLayout}
              >
                <MemoizedMultiGroup
                  title={getLogGroupLabel(groupName)}
                  groupId={`${projectName}-${key}`}
                  metrics={metrics}
                  organizationId={organizationId}
                  projectName={projectName}
                  globalLogXAxis={settings.xAxisLogScale}
                  globalLogYAxis={settings.yAxisLogScale}
                  groupBy={groupBy}
                />
              </VirtualizedGroup>
            );
          })}
        </ChartsLayoutEditProvider>
      </div>
      </FullscreenProvider>
    </ChartSyncProvider>
  );
});
