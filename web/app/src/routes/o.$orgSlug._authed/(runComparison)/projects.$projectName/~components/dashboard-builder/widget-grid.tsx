import { useMemo, useCallback, useState, useRef } from "react";
import GridLayout, { type Layout, type LayoutItem, verticalCompactor } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./widget-grid.css";
import { cn } from "@/lib/utils";
import { MoreHorizontalIcon, PencilIcon, Trash2Icon, MoveIcon, Maximize2Icon, SlidersHorizontalIcon, TriangleAlertIcon, ZapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChartBoundsPopover } from "@/components/charts/chart-bounds-popover";
import { ChartExportMenu } from "@/components/charts/chart-export-menu";
import { VirtualizedChart } from "@/components/core/virtualized-chart";
import type { Widget, WidgetLayout, ChartWidgetConfig } from "../../~types/dashboard-types";
import { isGlobValue, getGlobPattern, isRegexValue, getRegexPattern } from "./glob-utils";

interface WidgetGridProps {
  widgets: Widget[];
  onLayoutChange: (widgets: Widget[]) => void;
  onEditWidget: (widget: Widget) => void;
  onDeleteWidget: (widgetId: string) => void;
  renderWidget: (widget: Widget, onDataRange?: (dataMin: number, dataMax: number) => void, onResetBounds?: () => void) => React.ReactNode;
  onFullscreenWidget?: (widget: Widget) => void;
  onUpdateWidgetBounds?: (widgetId: string, yMin?: number, yMax?: number) => void;
  isEditing?: boolean;
  coarseMode?: boolean;
  cols?: number;
  rowHeight?: number;
  containerWidth?: number;
}

export function WidgetGrid({
  widgets,
  onLayoutChange,
  onEditWidget,
  onDeleteWidget,
  renderWidget,
  onFullscreenWidget,
  onUpdateWidgetBounds,
  isEditing = false,
  coarseMode = true,
  cols: colsProp = 12,
  rowHeight = 80,
  containerWidth = 1200,
}: WidgetGridProps) {
  // Track data ranges per widget for clipping indicators
  const [dataRanges, setDataRanges] = useState<Record<string, { min: number; max: number }>>({});
  // Refs for widget content containers (used by chart export)
  const widgetContentRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const handleWidgetDataRange = useCallback((widgetId: string, dataMin: number, dataMax: number) => {
    setDataRanges((prev) => {
      const existing = prev[widgetId];
      if (existing && existing.min === dataMin && existing.max === dataMax) return prev;
      return { ...prev, [widgetId]: { min: dataMin, max: dataMax } };
    });
  }, []);

  const cols = coarseMode ? 6 : colsProp;

  // Refs for stable callback closures (avoid stale captures and unnecessary recreation)
  const widgetsRef = useRef(widgets);
  widgetsRef.current = widgets;
  const onLayoutChangeRef = useRef(onLayoutChange);
  onLayoutChangeRef.current = onLayoutChange;

  // In coarse mode, derive uniform size from first widget (or defaults)
  // Single widget uses full width; multiple widgets use proportional width
  const uniformW = useMemo(() => {
    if (!coarseMode || widgets.length === 0) return 3;
    if (widgets.length === 1) return cols;
    return Math.max(1, Math.min(cols, Math.floor(widgets[0].layout.w / 2)));
  }, [coarseMode, widgets, cols]);

  const uniformH = useMemo(() => {
    if (!coarseMode || widgets.length === 0) return 4;
    return Math.max(2, widgets[0].layout.h);
  }, [coarseMode, widgets]);

  // Convert widgets to react-grid-layout format
  const layout: Layout = useMemo(() => {
    if (coarseMode) {
      // Coarse mode: all widgets uniform size, sort by stored position to preserve Free-mode reordering
      const itemsPerRow = Math.max(1, Math.floor(cols / uniformW));
      const sorted = [...widgets].sort((a, b) => {
        if (a.layout.y !== b.layout.y) return a.layout.y - b.layout.y;
        return a.layout.x - b.layout.x;
      });
      return sorted.map((widget, index) => ({
        i: widget.id,
        x: (index % itemsPerRow) * uniformW,
        y: Math.floor(index / itemsPerRow) * uniformH,
        w: uniformW,
        h: uniformH,
        minW: 1,
        minH: 2,
        maxW: cols,
      }));
    }
    // Fine mode: individual positions from storage
    return widgets.map((widget) => ({
      i: widget.id,
      x: widget.layout.x,
      y: widget.layout.y,
      w: widget.layout.w,
      h: widget.layout.h,
      minW: widget.layout.minW ?? 2,
      minH: widget.layout.minH ?? 2,
      maxW: widget.layout.maxW,
      maxH: widget.layout.maxH,
    }));
  }, [widgets, coarseMode, cols, uniformW, uniformH]);

  // Echo suppression: after we update state, RGL re-renders and fires
  // onLayoutChange again with compacted positions. Skip that echo to
  // prevent infinite update loops (compacted positions may differ from
  // our grid calculation, defeating change-detection alone).
  const skipNextLayoutChangeRef = useRef(false);

  // Handle layout changes from react-grid-layout
  const handleLayoutChange = useCallback(
    (newLayout: Layout) => {
      if (skipNextLayoutChangeRef.current) {
        skipNextLayoutChangeRef.current = false;
        return;
      }

      const currentWidgets = widgetsRef.current;

      if (coarseMode) {
        // Detect if any widget was resized and propagate uniform size to all
        const resizedItem = newLayout.find(
          (l: LayoutItem) => l.w !== uniformW || l.h !== uniformH
        );
        const newW = resizedItem ? resizedItem.w : uniformW;
        const newH = resizedItem ? resizedItem.h : uniformH;

        // Determine widget order from RGL-reported positions (handles drag-reorder)
        const rglSorted = [...newLayout].sort((a, b) => {
          if (a.y !== b.y) return a.y - b.y;
          return a.x - b.x;
        });

        // Recompute grid positions with potentially new uniform size
        const itemsPerRow = Math.max(1, Math.floor(cols / newW));
        const storageW = Math.round(newW * (colsProp / cols));

        // Change detection: only update if positions actually differ
        let hasChanged = false;
        const updatedWidgets = rglSorted
          .map((rglItem, index) => {
            const widget = currentWidgets.find((w) => w.id === rglItem.i);
            if (!widget) return null;

            const storageX = (index % itemsPerRow) * storageW;
            const storageY = Math.floor(index / itemsPerRow) * newH;
            if (
              widget.layout.x !== storageX ||
              widget.layout.y !== storageY ||
              widget.layout.w !== storageW ||
              widget.layout.h !== newH
            ) {
              hasChanged = true;
              return {
                ...widget,
                layout: {
                  ...widget.layout,
                  x: storageX,
                  y: storageY,
                  w: storageW,
                  h: newH,
                },
              };
            }
            return widget;
          })
          .filter((w): w is Widget => w !== null);

        if (hasChanged) {
          skipNextLayoutChangeRef.current = true;
          onLayoutChangeRef.current(updatedWidgets);
        }
      } else {
        // Fine mode: individual positions from 12-col grid
        let hasChanged = false;
        const updatedWidgets = currentWidgets.map((widget) => {
          const layoutItem = newLayout.find((l: LayoutItem) => l.i === widget.id);
          if (layoutItem) {
            if (
              widget.layout.x !== layoutItem.x ||
              widget.layout.y !== layoutItem.y ||
              widget.layout.w !== layoutItem.w ||
              widget.layout.h !== layoutItem.h
            ) {
              hasChanged = true;
              return {
                ...widget,
                layout: {
                  ...widget.layout,
                  x: layoutItem.x,
                  y: layoutItem.y,
                  w: layoutItem.w,
                  h: layoutItem.h,
                },
              };
            }
          }
          return widget;
        });

        if (hasChanged) {
          skipNextLayoutChangeRef.current = true;
          onLayoutChangeRef.current(updatedWidgets);
        }
      }
    },
    [coarseMode, cols, uniformW, uniformH]
  );

  if (widgets.length === 0) {
    return null;
  }

  const margin = 16;
  const colWidth = (containerWidth - (cols - 1) * margin) / cols + margin;
  const rowHeightWithMargin = rowHeight + margin;

  return (
    <GridLayout
      className={cn("widget-grid", isEditing && "widget-grid-editing")}
      style={
        isEditing
          ? ({
              "--grid-col-width": `${colWidth}px`,
              "--grid-row-height": `${rowHeightWithMargin}px`,
            } as React.CSSProperties)
          : undefined
      }
      layout={layout}
      width={containerWidth}
      onLayoutChange={handleLayoutChange}
      compactor={verticalCompactor}
      gridConfig={{
        cols,
        rowHeight,
        margin: [16, 16],
        containerPadding: null,
        maxRows: Infinity,
      }}
      dragConfig={{
        enabled: isEditing,
        bounded: false,
        handle: ".widget-drag-handle",
        cancel: ".widget-drag-cancel",
        threshold: 3,
      }}
      resizeConfig={{
        enabled: isEditing,
        handles: coarseMode ? ["se"] : ["se", "e"],
      }}
    >
      {widgets.map((widget) => {
        // Compute clipping info for chart widgets
        const chartConfig = widget.type === "chart" ? (widget.config as ChartWidgetConfig) : null;
        const range = dataRanges[widget.id];
        const clippingInfo = (() => {
          if (!chartConfig || !range) return null;
          if (chartConfig.yMin == null && chartConfig.yMax == null) return null;
          const clippedBelow = chartConfig.yMin != null && range.min < chartConfig.yMin;
          const clippedAbove = chartConfig.yMax != null && range.max > chartConfig.yMax;
          if (!clippedBelow && !clippedAbove) return null;
          const parts: string[] = [];
          if (clippedBelow) parts.push("below Y Min");
          if (clippedAbove) parts.push("above Y Max");
          return `Data clipped: values exist ${parts.join(" and ")}`;
        })();

        return (
          <div
            key={widget.id}
            className={cn(
              "group relative rounded-lg border bg-card shadow-sm",
              isEditing && "ring-1 ring-transparent hover:ring-primary/50"
            )}
          >
            {/* Widget Header */}
            <div className={cn(
              "relative z-10 flex items-center justify-between border-b px-3 py-2 bg-card",
              isEditing && "widget-drag-handle cursor-move"
            )}>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {isEditing && (
                  <MoveIcon className="size-4 shrink-0 text-muted-foreground" />
                )}
                {hasWidgetPatterns(widget) && (
                  <ZapIcon className="size-3 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 truncate text-sm font-medium">
                  {widget.config.title || getWidgetTitle(widget)}
                </span>
                {clippingInfo && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <TriangleAlertIcon className="size-3.5 shrink-0 text-amber-500" />
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p className="text-xs">{clippingInfo}</p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {/* Chart-specific actions (visible on hover) */}
                {widget.type === "chart" && (
                  <>
                    <ChartExportMenu
                      getContainer={() => widgetContentRefs.current[widget.id] ?? null}
                      fileName={widget.config.title || getWidgetTitle(widget)}
                      className="widget-drag-cancel size-7 opacity-0 group-hover:opacity-100"
                    />
                    <ChartBoundsPopover
                      yMin={(widget.config as ChartWidgetConfig).yMin}
                      yMax={(widget.config as ChartWidgetConfig).yMax}
                      onBoundsChange={(yMin, yMax) =>
                        onUpdateWidgetBounds?.(widget.id, yMin, yMax)
                      }
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="widget-drag-cancel size-7 opacity-0 group-hover:opacity-100"
                        data-testid="chart-bounds-btn"
                      >
                        <SlidersHorizontalIcon className="size-3.5" />
                      </Button>
                    </ChartBoundsPopover>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="widget-drag-cancel size-7 opacity-0 group-hover:opacity-100"
                      data-testid="chart-fullscreen-btn"
                      onClick={() => onFullscreenWidget?.(widget)}
                    >
                      <Maximize2Icon className="size-3.5" />
                    </Button>
                  </>
                )}

                {/* Edit mode actions */}
                {isEditing && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="widget-drag-cancel size-7 opacity-0 group-hover:opacity-100"
                      >
                        <MoreHorizontalIcon className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEditWidget(widget)}>
                        <PencilIcon className="mr-2 size-4" />
                        Edit Widget
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => onDeleteWidget(widget.id)}
                      >
                        <Trash2Icon className="mr-2 size-4" />
                        Delete Widget
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>

            {/* Widget Content */}
            <div
              ref={(el) => { widgetContentRefs.current[widget.id] = el; }}
              className="h-[calc(100%-40px)] overflow-auto p-2"
              onDoubleClick={
                widget.type === "chart"
                  ? () => onUpdateWidgetBounds?.(widget.id, undefined, undefined)
                  : undefined
              }
            >
              <VirtualizedChart minHeight="100%" loadMargin="400px" unloadMargin="1200px">
                {renderWidget(
                  widget,
                  widget.type === "chart"
                    ? (dataMin: number, dataMax: number) => handleWidgetDataRange(widget.id, dataMin, dataMax)
                    : undefined,
                  widget.type === "chart"
                    ? () => onUpdateWidgetBounds?.(widget.id, undefined, undefined)
                    : undefined
                )}
              </VirtualizedChart>
            </div>
          </div>
        );
      })}
    </GridLayout>
  );
}

// Helper to get widget title based on type and config
function getWidgetTitle(widget: Widget): string {
  switch (widget.type) {
    case "chart": {
      const config = widget.config as { metrics?: string[] };
      if (config.metrics && config.metrics.length > 0) {
        // Strip "glob:" / "regex:" prefixes for display
        const displayNames = config.metrics.map((m) =>
          isGlobValue(m) ? getGlobPattern(m) : isRegexValue(m) ? getRegexPattern(m) : m
        );
        if (displayNames.length === 1) {
          return displayNames[0];
        }
        if (displayNames.length <= 3) {
          return displayNames.join(", ");
        }
        return `${displayNames.length} metrics`;
      }
      return "Chart";
    }
    case "scatter": {
      const config = widget.config as { xMetric?: string; yMetric?: string };
      if (config.xMetric && config.yMetric) {
        return `${config.xMetric} vs ${config.yMetric}`;
      }
      return "Scatter Plot";
    }
    case "single-value": {
      const config = widget.config as { metric?: string };
      return config.metric || "Single Value";
    }
    case "histogram": {
      const config = widget.config as { metric?: string };
      return config.metric ? `Histogram: ${config.metric}` : "Histogram";
    }
    case "logs":
      return "Logs";
    case "file-group": {
      const config = widget.config as { files?: string[] };
      if (config.files && config.files.length > 0) {
        const displayNames = config.files.map((f) =>
          isGlobValue(f) ? getGlobPattern(f) : isRegexValue(f) ? getRegexPattern(f) : f
        );
        if (displayNames.length === 1) {
          return displayNames[0];
        }
        if (displayNames.length <= 3) {
          return displayNames.join(", ");
        }
        return `${displayNames.length} files`;
      }
      return "Files";
    }
    case "file-series":
      return "File Series";
    default:
      return "Widget";
  }
}

// Check if a widget uses glob or regex patterns (i.e., is "dynamic")
function hasWidgetPatterns(widget: Widget): boolean {
  if (widget.type === "chart") {
    const config = widget.config as { metrics?: string[] };
    return config.metrics?.some((m) => isGlobValue(m) || isRegexValue(m)) ?? false;
  }
  if (widget.type === "file-group") {
    const config = widget.config as { files?: string[] };
    return config.files?.some((f) => isGlobValue(f) || isRegexValue(f)) ?? false;
  }
  return false;
}

