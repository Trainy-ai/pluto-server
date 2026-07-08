import { ZapIcon, SlidersHorizontalIcon, Maximize2Icon, LayersIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { VirtualizedChart } from "@/components/core/virtualized-chart";
import { ChartScalePopover } from "@/components/charts/chart-scale-popover";
import { ChartExportMenu } from "@/components/charts/chart-export-menu";
import { extractCaptionFromDOM } from "@/components/charts/chart-export-utils";
import { BarsSettingsPopover } from "../multi-group/categorical-view";
import { getWidgetTitle } from "./widget-utils";
import { useDynamicSectionWidgets } from "./use-dynamic-section";
import { WidgetRenderer } from "./widget-renderer";
import { ChartFullscreenDialog } from "@/components/charts/chart-fullscreen-dialog";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useHiddenRunIds } from "@/hooks/use-hidden-run-ids";
import type {
  Widget,
  ChartWidgetConfig,
  FileGroupWidgetConfig,
  DistributionsWidgetConfig,
  HistogramViewMode,
} from "../../~types/dashboard-types";
import type { BinRange } from "../multi-group/categorical-bin-range";
import type { GroupedMetrics } from "@/lib/grouping/types";
import type { SelectedRunWithColor } from "../../~hooks/use-selected-runs";
import { searchUtils, type SearchState } from "../../~lib/search-utils";
import { ImageStepSyncProvider, useImageStepSyncContext } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~context/image-step-sync-context";
import { useFullscreenContext } from "@/components/charts/context/fullscreen-context";
import { cn } from "@/lib/utils";

interface DynamicSectionGridProps {
  sectionId: string;
  pattern: string;
  patternMode?: "search" | "regex";
  /** Metric-name grouping for the section (suffix combining). Distinct
   *  from `workspaceGroupBy` below, which is the run-table grouping
   *  that drives wandb-style grouped line charts. */
  groupBy?: string[];
  groupPrefixes?: string[];
  groupPrefixRegex?: string;
  organizationId: string;
  projectName: string;
  selectedRunIds: string[];
  groupedMetrics: GroupedMetrics;
  selectedRuns: Record<string, SelectedRunWithColor>;
  searchState?: SearchState;
  onWidgetCountChange?: (count: number) => void;
  settingsRunId?: string;
  /** Workspace groupBy chain from the runs table (e.g.
   *  ["tag-prefix:group", "config:batch_size"]). When non-empty, dynamic
   *  chart widgets render via GroupedLineChart — unless the widget has
   *  the per-chart override toggled on. Forwarded to ChartWidget. */
  workspaceGroupBy?: string[];
  /** Persisted per-widget overrides from `Section.dynamicWidgetOverrides`.
   *  Seeds initial state so a saved override survives reloads. */
  initialWidgetOverrides?: Record<
    string,
    { maxGroups?: number; groupingOverride?: "off" }
  >;
  /** Fires when the user changes maxGroups or grouping-override through
   *  the in-chart popover. Marks the dashboard as having unsaved changes
   *  AND persists the new value into `Section.dynamicWidgetOverrides`
   *  on the next view save. Omit on read-only dashboards. */
  onUpdateDynamicWidgetOverride?: (
    sectionId: string,
    widgetId: string,
    patch: { maxGroups?: number; groupingOverride?: "off" | null },
  ) => void;
  /**
   * Per-metric Step/Ridgeline/Heatmap viewMode overrides saved on this
   * section. Applies to both numeric histogram entries and `{bars}`
   * prefix entries (both share the same view-mode set). Read here and
   * injected into each dynamic file-group widget's effective config so
   * the view renders in the saved mode. Field name kept for on-disk
   * backwards-compat.
   */
  histogramViewModes?: Record<string, HistogramViewMode>;
  /** Persists user view-mode toggles on dynamic widgets back into the section's map. */
  onUpdateSectionHistogramViewMode?: (
    sectionId: string,
    metric: string,
    mode: HistogramViewMode,
  ) => void;
}

interface WidgetBounds {
  logXAxis?: boolean;
  logYAxis?: boolean;
  yZoomRange?: [number, number] | null;
  /** Per-widget grouping override. true = force per-run for this
   *  widget even when the workspace has groupBy active. */
  groupingOverridden?: boolean;
  /** Per-widget cap on the number of leaf groups the grouped chart
   *  query aggregates. Falls back to the backend default (10) when
   *  undefined. */
  maxGroups?: number;
}

export function DynamicSectionGrid({
  sectionId,
  pattern,
  patternMode,
  groupBy,
  groupPrefixes,
  groupPrefixRegex,
  organizationId,
  projectName,
  selectedRunIds,
  groupedMetrics,
  selectedRuns,
  searchState,
  onWidgetCountChange,
  settingsRunId,
  workspaceGroupBy,
  initialWidgetOverrides,
  onUpdateDynamicWidgetOverride,
  histogramViewModes,
  onUpdateSectionHistogramViewMode,
}: DynamicSectionGridProps) {
  const workspaceGroupingActive = (workspaceGroupBy?.length ?? 0) > 0;
  const hiddenRunIds = useHiddenRunIds();

  // Check if a parent sync provider exists (comparison page has one at page level)
  const parentSyncContext = useImageStepSyncContext();

  // Exclude hidden runs so dynamic widgets are only generated for metrics/files
  // that exist on visible runs (matching deselect behavior).
  const visibleRunIds = useMemo(
    () =>
      hiddenRunIds.size === 0
        ? selectedRunIds
        : selectedRunIds.filter((id) => !hiddenRunIds.has(id)),
    [selectedRunIds, hiddenRunIds],
  );

  const { dynamicWidgets, isLoading } = useDynamicSectionWidgets(
    sectionId,
    pattern,
    patternMode ?? "search",
    organizationId,
    projectName,
    visibleRunIds,
    groupBy,
    groupPrefixes,
    groupPrefixRegex,
  );

  const filteredWidgets = useMemo(() => {
    if (!searchState || !searchState.query.trim()) {
      return dynamicWidgets;
    }
    return dynamicWidgets.filter((widget) =>
      searchUtils.doesWidgetMatchSearch(widget, searchState)
    );
  }, [dynamicWidgets, searchState]);

  const [fullscreenWidget, setFullscreenWidget] = useState<Widget | null>(null);
  const { setFullscreen } = useFullscreenContext();
  useEffect(() => { setFullscreen(!!fullscreenWidget); }, [fullscreenWidget, setFullscreen]);
  // Seed local widget bounds with the persisted overrides for the
  // popover-flippable fields (maxGroups, groupingOverridden). Log-scale
  // and y-zoom stay session-local because they aren't saved to the view.
  const [widgetBounds, setWidgetBounds] = useState<Record<string, WidgetBounds>>(
    () => {
      if (!initialWidgetOverrides) return {};
      const out: Record<string, WidgetBounds> = {};
      for (const [id, o] of Object.entries(initialWidgetOverrides)) {
        out[id] = {
          maxGroups: o.maxGroups,
          groupingOverridden: o.groupingOverride === "off" ? true : undefined,
        };
      }
      return out;
    },
  );
  // Re-sync the persisted popover fields (maxGroups, groupingOverridden) when
  // the active view's overrides change — the useState seed above only runs on
  // mount, so switching saved views would otherwise leave these on the previous
  // view's values. Session-local fields (log-scale, y-zoom) are preserved.
  // Keyed on the stringified overrides so a churny prop identity doesn't refire.
  const overridesKey = useMemo(
    () => JSON.stringify(initialWidgetOverrides ?? {}),
    [initialWidgetOverrides],
  );
  const didSyncOverrides = useRef(false);
  useEffect(() => {
    // Skip mount — the useState initializer already seeded from the overrides.
    if (!didSyncOverrides.current) {
      didSyncOverrides.current = true;
      return;
    }
    setWidgetBounds((prev) => {
      const next: Record<string, WidgetBounds> = {};
      for (const id of new Set([
        ...Object.keys(prev),
        ...Object.keys(initialWidgetOverrides ?? {}),
      ])) {
        const o = initialWidgetOverrides?.[id];
        next[id] = {
          ...prev[id],
          maxGroups: o?.maxGroups,
          groupingOverridden: o?.groupingOverride === "off" ? true : undefined,
        };
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overridesKey]);
  // Per-widget bin-range overrides for dynamic distributions/bars widgets.
  // Dynamic widgets aren't persisted, so — like the log-scale/zoom overrides
  // in widgetBounds — these live in session-local state and are injected into
  // the widget config below. Without this the bars `1–N` range input has no
  // onBinRangeChange target and silently no-ops (the other bars controls
  // already work via the view's internal initial-state). Keyed widgetId -> entry index.
  const [barsBinRanges, setBarsBinRanges] = useState<
    Record<string, Record<number, BinRange>>
  >({});
  const widgetContentRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    onWidgetCountChange?.(filteredWidgets.length);
  }, [filteredWidgets.length, onWidgetCountChange]);

  const updateScale = useCallback((widgetId: string, axis: "x" | "y", value: boolean) => {
    setWidgetBounds((prev) => ({
      ...prev,
      [widgetId]: {
        ...prev[widgetId],
        ...(axis === "x" ? { logXAxis: value } : { logYAxis: value }),
      },
    }));
  }, []);

  // Per-widget grouping override. Local state is the source of truth
  // for the in-popover UI; we ALSO call up to the dashboard so the
  // change persists into `Section.dynamicWidgetOverrides` on save AND
  // marks the dashboard as having unsaved changes (enabling Save).
  const updateGroupingOverride = useCallback(
    (widgetId: string, overridden: boolean) => {
      setWidgetBounds((prev) => ({
        ...prev,
        [widgetId]: {
          ...prev[widgetId],
          groupingOverridden: overridden,
        },
      }));
      onUpdateDynamicWidgetOverride?.(sectionId, widgetId, {
        // null clears the override → falls back to workspace grouping.
        groupingOverride: overridden ? "off" : null,
      });
    },
    [sectionId, onUpdateDynamicWidgetOverride],
  );

  const updateMaxGroups = useCallback(
    (widgetId: string, value: number) => {
      setWidgetBounds((prev) => ({
        ...prev,
        [widgetId]: {
          ...prev[widgetId],
          maxGroups: value,
        },
      }));
      onUpdateDynamicWidgetOverride?.(sectionId, widgetId, { maxGroups: value });
    },
    [sectionId, onUpdateDynamicWidgetOverride],
  );

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[300px] rounded-lg" />
        ))}
      </div>
    );
  }

  if (filteredWidgets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
        <p>
          {searchState?.query.trim()
            ? "No widgets match your search."
            : `No metrics or files match the pattern "${pattern}"`}
        </p>
      </div>
    );
  }

  const gridContent = (
    <>
      <div className="grid grid-cols-2 gap-4">
        {filteredWidgets.map((widget) => {
          const bounds = widgetBounds[widget.id] ?? {};
          const isChart = widget.type === "chart";
          const title = widget.config.title || getWidgetTitle(widget);

          // Apply local bounds to widget config for rendering.
          // For chart widgets, log-scale toggles + grouping overrides apply.
          // `groupingOverride: "off"` makes ChartWidget fall back to
          // MultiLineChart even when the workspace has groupBy active —
          // same mechanism static dashboard widgets use, but driven by
          // ephemeral per-render state instead of persisted config.
          // For distributions widgets, session-local bin-range overrides apply.
          let effectiveWidget: Widget = widget;
          if (isChart) {
            effectiveWidget = {
              ...widget,
              config: {
                ...widget.config,
                xAxisScale: bounds.logXAxis
                  ? "log"
                  : (widget.config as ChartWidgetConfig).xAxisScale,
                yAxisScale: bounds.logYAxis
                  ? "log"
                  : (widget.config as ChartWidgetConfig).yAxisScale,
                groupingOverride: bounds.groupingOverridden
                  ? "off"
                  : (widget.config as ChartWidgetConfig).groupingOverride,
                maxGroups:
                  bounds.maxGroups ?? (widget.config as ChartWidgetConfig).maxGroups,
              } as ChartWidgetConfig,
            };
          } else if (widget.type === "distributions") {
            // Inject session-local bin-range overrides into bars entries so the
            // `1–N` range input applies (dynamic widgets have no persisted config).
            const ov = barsBinRanges[widget.id];
            if (ov) {
              const cfg = widget.config as DistributionsWidgetConfig;
              effectiveWidget = {
                ...widget,
                config: {
                  ...cfg,
                  entries: cfg.entries.map((e, i) =>
                    ov[i] && e.kind === "bars" ? { ...e, binRange: ov[i] } : e,
                  ),
                },
              };
            }
          }

          // Combined dynamic widgets (multi-metric, generated by suffix
          // grouping) get an extra Layers indicator next to the lightning bolt
          // so they're visually distinct from single-metric dynamic widgets.
          const isCombined =
            isChart && (widget.config as ChartWidgetConfig).metrics.length > 1;

          return (
            <div
              key={widget.id}
              data-testid={isCombined ? "combined-dynamic-widget" : "dynamic-widget"}
              data-combined={isCombined ? "true" : "false"}
              className="group relative h-[384px] rounded-lg border bg-card shadow-sm"
            >
              {/* Widget Header */}
              <div className="relative z-10 flex items-center justify-between border-b px-3 py-2 bg-card">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <div className="flex shrink-0 items-center gap-0.5">
                    <ZapIcon
                      className={cn(
                        "size-3",
                        isCombined ? "text-primary/70" : "text-muted-foreground/50",
                      )}
                    />
                    {isCombined && (
                      <LayersIcon
                        className="size-3 text-primary/70"
                        aria-label="Combined metrics"
                        data-testid="combined-widget-icon"
                      />
                    )}
                  </div>
                  <span className="min-w-0 truncate text-sm font-medium">
                    {title}
                  </span>
                </div>
                {isChart && (
                  <div className="flex shrink-0 items-center gap-1">
                    <ChartExportMenu
                      getContainer={() => widgetContentRefs.current[widget.id] ?? null}
                      fileName={title}
                      className="size-7 opacity-0 group-hover:opacity-100"
                      getCaption={() => {
                        // Bars + histogram widget bodies stamp
                        // `data-export-step` + `data-export-runs` on a
                        // descendant. Reading via extractCaptionFromDOM
                        // ensures the PNG download includes the same
                        // caption strip the static-section widgets and
                        // fullscreen exports render.
                        const el = widgetContentRefs.current[widget.id];
                        return el ? extractCaptionFromDOM(el) : null;
                      }}
                    />
                    <ChartScalePopover
                      logXAxis={bounds.logXAxis}
                      logYAxis={bounds.logYAxis}
                      onLogScaleChange={(axis, value) => updateScale(widget.id, axis, value)}
                      workspaceGroupingActive={workspaceGroupingActive}
                      groupingOverridden={!!bounds.groupingOverridden}
                      onGroupingOverrideChange={(overridden) => updateGroupingOverride(widget.id, overridden)}
                      maxGroups={bounds.maxGroups}
                      onMaxGroupsChange={(value) => updateMaxGroups(widget.id, value)}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 opacity-0 group-hover:opacity-100"
                        data-testid="chart-bounds-btn"
                      >
                        <SlidersHorizontalIcon className="size-3.5" />
                      </Button>
                    </ChartScalePopover>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 opacity-0 group-hover:opacity-100"
                      data-testid="chart-fullscreen-btn"
                      onClick={() => setFullscreenWidget(effectiveWidget)}
                    >
                      <Maximize2Icon className="size-3.5" />
                    </Button>
                  </div>
                )}
              </div>

              {/* Widget Content */}
              <div
                ref={(el) => { widgetContentRefs.current[widget.id] = el; }}
                className="h-[calc(100%-40px)] overflow-auto p-2"
              >
                <VirtualizedChart minHeight="100%" loadMargin="400px" unloadMargin="1200px">
                  <WidgetRenderer
                    widget={effectiveWidget}
                    groupedMetrics={groupedMetrics}
                    selectedRuns={selectedRuns}
                    organizationId={organizationId}
                    projectName={projectName}
                    settingsRunId={settingsRunId}
                    yZoomRange={bounds.yZoomRange ?? null}
                    onYZoomRangeChange={(range) => setWidgetBounds((prev) => ({
                      ...prev,
                      [widget.id]: { ...prev[widget.id], yZoomRange: range },
                    }))}
                    groupBy={workspaceGroupBy}
                    hiddenRunIds={hiddenRunIds}
                    onUpdateDistributionsEntryBinRange={(wid, idx, range) =>
                      setBarsBinRanges((prev) => ({
                        ...prev,
                        [wid]: { ...prev[wid], [idx]: range },
                      }))
                    }
                  />
                </VirtualizedChart>
              </div>
            </div>
          );
        })}
      </div>

      {fullscreenWidget && fullscreenWidget.type === "chart" && (() => {
        const fsConfig = fullscreenWidget.config as ChartWidgetConfig;
        return (
          <ChartFullscreenDialog
            open={true}
            onOpenChange={(open) => { if (!open) setFullscreenWidget(null); }}
            title={fullscreenWidget.config.title || getWidgetTitle(fullscreenWidget)}
            logXAxis={fsConfig.xAxisScale === "log"}
            logYAxis={fsConfig.yAxisScale === "log"}
            onLogScaleChange={(axis, value) => {
              updateScale(fullscreenWidget.id, axis, value);
              const scaleValue = value ? "log" : "linear";
              setFullscreenWidget((prev) =>
                prev
                  ? ({
                      ...prev,
                      config: {
                        ...prev.config,
                        ...(axis === "x"
                          ? { xAxisScale: scaleValue }
                          : { yAxisScale: scaleValue }),
                      } as ChartWidgetConfig,
                    } as Widget)
                  : null,
              );
            }}
          >
            <WidgetRenderer
              widget={fullscreenWidget}
              groupedMetrics={groupedMetrics}
              selectedRuns={selectedRuns}
              organizationId={organizationId}
              projectName={projectName}
              settingsRunId={settingsRunId}
              yZoomRange={widgetBounds[fullscreenWidget.id]?.yZoomRange ?? null}
              onYZoomRangeChange={(range) =>
                setWidgetBounds((prev) => ({
                  ...prev,
                  [fullscreenWidget.id]: {
                    ...prev[fullscreenWidget.id],
                    yZoomRange: range,
                  },
                }))
              }
              groupBy={workspaceGroupBy}
              hiddenRunIds={hiddenRunIds}
            />
          </ChartFullscreenDialog>
        );
      })()}
    </>
  );

  // Wrap in ImageStepSyncProvider only if no parent provider exists (e.g., individual run pages)
  if (!parentSyncContext) {
    const hasFileWidgets = filteredWidgets.some((w) => w.type === "file-group");
    if (hasFileWidgets) {
      return <ImageStepSyncProvider>{gridContent}</ImageStepSyncProvider>;
    }
  }

  return gridContent;
}

