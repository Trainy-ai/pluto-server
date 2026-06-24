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
  HistogramViewMode,
} from "../../~types/dashboard-types";
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
  histogramViewModes,
  onUpdateSectionHistogramViewMode,
}: DynamicSectionGridProps) {
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
  const [widgetBounds, setWidgetBounds] = useState<Record<string, WidgetBounds>>({});
  // Per-widget log-scale + zoom overrides live in widgetBounds above.
  // The bars-on-chart per-widget controls (viewMode/depthAxis/binRange/
  // ignoreOutliers/stepsOnX) used to live here too — they're gone now
  // that bars moved out into the distributions widget. Distributions
  // widgets emitted dynamically render with their initial config and
  // don't persist per-widget customization (matching how line-chart
  // dynamic widgets already behaved).
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

          // Apply local bounds (log-scale toggles) to chart widgets so the
          // renderer picks them up without prop threading.
          const effectiveWidget: Widget = isChart
            ? {
                ...widget,
                config: {
                  ...widget.config,
                  xAxisScale: bounds.logXAxis
                    ? "log"
                    : (widget.config as ChartWidgetConfig).xAxisScale,
                  yAxisScale: bounds.logYAxis
                    ? "log"
                    : (widget.config as ChartWidgetConfig).yAxisScale,
                } as ChartWidgetConfig,
              }
            : widget;

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

