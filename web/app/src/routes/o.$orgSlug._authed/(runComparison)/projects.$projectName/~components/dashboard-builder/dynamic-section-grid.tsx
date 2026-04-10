import { ZapIcon, SlidersHorizontalIcon, Maximize2Icon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { VirtualizedChart } from "@/components/core/virtualized-chart";
import { ChartScalePopover } from "@/components/charts/chart-scale-popover";
import { ChartExportMenu } from "@/components/charts/chart-export-menu";
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
import type { Widget, ChartWidgetConfig } from "../../~types/dashboard-types";
import type { GroupedMetrics } from "@/lib/grouping/types";
import type { SelectedRunWithColor } from "../../~hooks/use-selected-runs";
import { searchUtils, type SearchState } from "../../~lib/search-utils";
import { ImageStepSyncProvider, useImageStepSyncContext } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~context/image-step-sync-context";
import { useFullscreenContext } from "@/components/charts/context/fullscreen-context";

interface DynamicSectionGridProps {
  sectionId: string;
  pattern: string;
  patternMode?: "search" | "regex";
  organizationId: string;
  projectName: string;
  selectedRunIds: string[];
  groupedMetrics: GroupedMetrics;
  selectedRuns: Record<string, SelectedRunWithColor>;
  searchState?: SearchState;
  onWidgetCountChange?: (count: number) => void;
  settingsRunId?: string;
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
  organizationId,
  projectName,
  selectedRunIds,
  groupedMetrics,
  selectedRuns,
  searchState,
  onWidgetCountChange,
  settingsRunId,
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

          // Apply local bounds to widget config for rendering
          const effectiveWidget: Widget = isChart
            ? {
                ...widget,
                config: {
                  ...widget.config,
                  xAxisScale: bounds.logXAxis ? "log" : (widget.config as ChartWidgetConfig).xAxisScale,
                  yAxisScale: bounds.logYAxis ? "log" : (widget.config as ChartWidgetConfig).yAxisScale,
                } as ChartWidgetConfig,
              }
            : widget;

          return (
            <div
              key={widget.id}
              className="group relative h-[384px] rounded-lg border bg-card shadow-sm"
            >
              {/* Widget Header */}
              <div className="relative z-10 flex items-center justify-between border-b px-3 py-2 bg-card">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <ZapIcon className="size-3 shrink-0 text-muted-foreground/50" />
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

      {fullscreenWidget && fullscreenWidget.type === "chart" && (
        <ChartFullscreenDialog
          open={true}
          onOpenChange={(open) => { if (!open) setFullscreenWidget(null); }}
          title={fullscreenWidget.config.title || (fullscreenWidget.config as ChartWidgetConfig).metrics[0] || "Chart"}
          logXAxis={(fullscreenWidget.config as ChartWidgetConfig).xAxisScale === "log"}
          logYAxis={(fullscreenWidget.config as ChartWidgetConfig).yAxisScale === "log"}
          onLogScaleChange={(axis, value) => {
            updateScale(fullscreenWidget.id, axis, value);
            const scaleValue = value ? "log" : "linear";
            setFullscreenWidget((prev) =>
              prev
                ? { ...prev, config: { ...prev.config, ...(axis === "x" ? { xAxisScale: scaleValue } : { yAxisScale: scaleValue }) } as ChartWidgetConfig } as Widget
                : null
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
            onYZoomRangeChange={(range) => setWidgetBounds((prev) => ({
              ...prev,
              [fullscreenWidget.id]: { ...prev[fullscreenWidget.id], yZoomRange: range },
            }))}
          />
        </ChartFullscreenDialog>
      )}
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

function getWidgetTitle(widget: Widget): string {
  if (widget.type === "chart") {
    const config = widget.config as ChartWidgetConfig;
    if (config.metrics?.length === 1) return config.metrics[0];
    if (config.metrics && config.metrics.length <= 3) return config.metrics.join(", ");
    if (config.metrics && config.metrics.length > 3) return `${config.metrics.length} metrics`;
    return "Chart";
  }
  if (widget.type === "file-group") {
    const config = widget.config as { files?: string[] };
    if (config.files?.length === 1) return config.files[0];
    if (config.files && config.files.length > 1) return `${config.files.length} files`;
    return "Files";
  }
  return "Widget";
}
