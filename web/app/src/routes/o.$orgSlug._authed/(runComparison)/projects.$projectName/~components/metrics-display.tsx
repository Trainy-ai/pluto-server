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
import {
  useChartsLayout,
  useUpsertChartsLayout,
} from "../~queries/charts-layout";
import {
  applyChartsLayout,
  orderGroupMetrics,
  EMPTY_CHARTS_LAYOUT,
} from "../~lib/charts-layout";
import {
  useChartsLayoutDraft,
  type DraftGroup,
} from "./charts-layout-edit/use-charts-layout-draft";
import { ChartsLayoutEditBanner } from "./charts-layout-edit/charts-layout-edit-banner";
import {
  ChartsLayoutEditProvider,
  type ChartsLayoutEditApi,
} from "@/components/charts/context/charts-layout-edit-context";
import { Button } from "@/components/ui/button";
import { SlidersHorizontal } from "lucide-react";
import type { SelectedRunWithColor } from "../~hooks/use-selected-runs";

const EMPTY_DRAFT_GROUPS: DraftGroup[] = [];
import { ChartSyncProvider } from "@/components/charts/context/chart-sync-context";
import { FullscreenProvider } from "@/components/charts/context/fullscreen-context";

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

  // Pre-compute filtered metrics for each group to avoid inline computation
  // This ensures MemoizedMultiGroup receives stable references when metrics haven't changed
  const filteredMetricsPerGroup = useMemo(() => {
    const metricsMap = new Map<string, typeof filteredGroups[0][1]["metrics"]>();
    filteredGroups.forEach(([group, data]) => {
      metricsMap.set(
        group,
        searchUtils.filterMetrics(
          group,
          data.metrics,
          searchIndexRef.current,
          searchState,
        ),
      );
    });
    return metricsMap;
  }, [filteredGroups, searchState]);

  // Persisted project-level layout overlay for the default Charts view.
  const { data: chartsLayoutData } = useChartsLayout(organizationId, projectName);
  const chartsLayout = chartsLayoutData?.config ?? EMPTY_CHARTS_LAYOUT;
  // Only allow editing once the saved overlay has loaded, so the editor's
  // initial draft reflects the persisted order rather than the default one.
  const isLayoutLoaded = chartsLayoutData !== undefined;
  const upsertChartsLayout = useUpsertChartsLayout(organizationId, projectName);
  const [isEditingLayout, setIsEditingLayout] = useState(false);

  // The layout editor only belongs to the default All Metrics view. Reset edit
  // mode whenever the selected view changes (e.g. switching to a custom
  // dashboard and back) so it never reopens unexpectedly on return.
  useEffect(() => {
    setIsEditingLayout(false);
  }, [selectedViewId]);

  // Saved-overlay-applied arrangement — what the view shows outside edit mode
  // and the base the edit draft snapshots from.
  const savedLaidOutGroups = useMemo(
    () => applyChartsLayout(sortedGroups, chartsLayout),
    [sortedGroups, chartsLayout],
  );

  // Draft base — only worth computing while the editor is open (it snapshots
  // and reconciles from this), so the non-edit render path skips the
  // per-metric mapping entirely.
  const baseGroups = useMemo<DraftGroup[]>(() => {
    if (!isEditingLayout) {
      return EMPTY_DRAFT_GROUPS;
    }
    return savedLaidOutGroups.map(({ key, data, hidden }) => ({
      key,
      hidden,
      metricNames: orderGroupMetrics(
        data.metrics,
        chartsLayout.metricOrder?.[key],
      ).map((m) => m.name),
      defaultMetricNames: data.metrics.map((m) => m.name),
    }));
  }, [isEditingLayout, savedLaidOutGroups, chartsLayout]);

  const { draftConfig, dirty, toggleHidden, moveSection, moveMetric } =
    useChartsLayoutDraft(baseGroups, isEditingLayout);

  // WYSIWYG: while editing, the draft overlay drives the actual charts view.
  const effectiveLayout = isEditingLayout ? draftConfig : chartsLayout;

  // Apply the overlay (reorder + hidden flags) over ALL sorted groups,
  // regardless of the current search — the search filter is layered on top at
  // render time so reordering/hiding affects every group. Outside edit mode
  // the saved arrangement is reused as-is instead of re-sorting.
  const draftLaidOutGroups = useMemo(
    () =>
      isEditingLayout ? applyChartsLayout(sortedGroups, draftConfig) : null,
    [isEditingLayout, sortedGroups, draftConfig],
  );
  const laidOutGroups = draftLaidOutGroups ?? savedLaidOutGroups;

  // Keys that survive the current search, used to gate rendering while keeping
  // the saved order from `laidOutGroups`.
  const visibleSearchKeys = useMemo(
    () => new Set(filteredGroups.map(([group]) => group)),
    [filteredGroups],
  );

  // Per-group metric lists with the per-group chart order applied on top
  // of the search filter. `orderGroupMetrics` returns the input array by
  // reference when the overlay is a no-op, so MemoizedMultiGroup keeps stable
  // props and charts aren't recreated needlessly.
  const orderedMetricsPerGroup = useMemo(() => {
    const map = new Map<string, GroupedMetrics[string]["metrics"]>();
    laidOutGroups.forEach(({ key, data }) => {
      const metrics = filteredMetricsPerGroup.get(key) ?? data.metrics;
      map.set(key, orderGroupMetrics(metrics, effectiveLayout.metricOrder?.[key]));
    });
    return map;
  }, [laidOutGroups, filteredMetricsPerGroup, effectiveLayout]);

  // DropdownRegion sections are addressed by `${projectName}-${key}`.
  const groupIdToKey = useMemo(() => {
    const map = new Map<string, string>();
    laidOutGroups.forEach(({ key }) => map.set(`${projectName}-${key}`, key));
    return map;
  }, [laidOutGroups, projectName]);

  const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null);
  const [draggedItem, setDraggedItem] = useState<{
    groupId: string;
    name: string;
  } | null>(null);

  // Context DropdownRegion consumes to grow drag/hide chrome while editing.
  // Null outside edit mode so the chrome (and these re-renders) cost nothing.
  const layoutEditApi = useMemo<ChartsLayoutEditApi | null>(() => {
    if (!isEditingLayout) {
      return null;
    }
    const hiddenSet = new Set(draftConfig.hidden);
    const itemName = (groupId: string, index: number) => {
      const key = groupIdToKey.get(groupId);
      return key ? orderedMetricsPerGroup.get(key)?.[index]?.name : undefined;
    };
    return {
      getSectionKey: (groupId) => groupIdToKey.get(groupId),
      isSectionHidden: (groupId) => {
        const key = groupIdToKey.get(groupId);
        return key ? hiddenSet.has(key) : false;
      },
      toggleSectionHidden: (groupId) => {
        const key = groupIdToKey.get(groupId);
        if (key) {
          toggleHidden(key);
        }
      },
      draggedSectionId,
      startSectionDrag: setDraggedSectionId,
      endSectionDrag: () => setDraggedSectionId(null),
      moveSectionOver: (targetGroupId, position) => {
        const fromKey = draggedSectionId
          ? groupIdToKey.get(draggedSectionId)
          : undefined;
        const targetKey = groupIdToKey.get(targetGroupId);
        if (fromKey && targetKey) {
          moveSection(fromKey, targetKey, position);
        }
      },
      getItemName: itemName,
      draggedItem,
      startItemDrag: (groupId, index) => {
        const name = itemName(groupId, index);
        if (name) {
          setDraggedItem({ groupId, name });
        }
      },
      endItemDrag: () => setDraggedItem(null),
      moveItemOver: (groupId, targetIndex, position) => {
        const key = groupIdToKey.get(groupId);
        const targetName = itemName(groupId, targetIndex);
        if (key && targetName && draggedItem?.groupId === groupId) {
          moveMetric(key, draggedItem.name, targetName, position);
        }
      },
    };
  }, [
    isEditingLayout,
    draftConfig.hidden,
    groupIdToKey,
    orderedMetricsPerGroup,
    toggleHidden,
    draggedSectionId,
    moveSection,
    draggedItem,
    moveMetric,
  ]);

  const handleSaveLayout = () => {
    upsertChartsLayout.mutate(
      { organizationId, projectName, config: draftConfig },
      { onSuccess: () => setIsEditingLayout(false) },
    );
  };

  const handleResetLayout = () => {
    upsertChartsLayout.mutate(
      { organizationId, projectName, config: EMPTY_CHARTS_LAYOUT },
      { onSuccess: () => setIsEditingLayout(false) },
    );
  };

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
            {!isEditingLayout && isLayoutLoaded && laidOutGroups.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditingLayout(true)}
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
        {isEditingLayout && (
          <ChartsLayoutEditBanner
            isSaving={upsertChartsLayout.isPending}
            isDirty={dirty}
            onSave={handleSaveLayout}
            onCancel={() => setIsEditingLayout(false)}
            onReset={handleResetLayout}
          />
        )}
        <ChartsLayoutEditProvider value={layoutEditApi}>
          {laidOutGroups
            // While editing, hidden sections stay visible (dimmed by their
            // section chrome) so they can be re-shown and rearranged.
            .filter(
              (g) =>
                (isEditingLayout || !g.hidden) && visibleSearchKeys.has(g.key),
            )
            .map(({ key, data }) => {
              const metrics = orderedMetricsPerGroup.get(key) ?? data.metrics;
              return (
                <VirtualizedGroup
                  key={key}
                  groupId={`${projectName}-${key}`}
                  groupTitle={data.groupName}
                  metricCount={metrics.length}
                >
                  <MemoizedMultiGroup
                    title={data.groupName}
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
