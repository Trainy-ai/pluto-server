import { useMemo, useCallback, useRef, type ReactNode } from "react";
import GridLayout, { type Layout, type LayoutItem, verticalCompactor } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./widget-grid.css";
import { cn } from "@/lib/utils";
import { VirtualizedChart } from "@/components/core/virtualized-chart";
import { ImageStepSyncProvider } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~context/image-step-sync-context";
import type { Widget } from "../../~types/dashboard-types";
import { WidgetCard } from "./widget-card";
import type { SectionLocation } from "./use-dashboard-config";

interface WidgetGridProps {
  widgets: Widget[];
  onLayoutChange: (widgets: Widget[]) => void;
  onEditWidget: (widget: Widget) => void;
  onDeleteWidget: (widgetId: string) => void;
  onCopyWidget?: (widget: Widget) => void;
  renderWidget: (widget: Widget) => ReactNode;
  onFullscreenWidget?: (widget: Widget) => void;
  onUpdateWidgetScale?: (widgetId: string, axis: "x" | "y", value: boolean) => void;
  onMoveWidget?: (widgetId: string, target: SectionLocation) => void;
  moveTargets?: { label: string; location: SectionLocation; isFolder: boolean }[];
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
  onCopyWidget,
  renderWidget,
  onFullscreenWidget,
  onUpdateWidgetScale,
  onMoveWidget,
  moveTargets,
  isEditing = false,
  coarseMode = true,
  cols: colsProp = 12,
  rowHeight = 80,
  containerWidth = 1200,
}: WidgetGridProps) {
  const cols = coarseMode ? 6 : colsProp;

  // Refs for stable callback closures
  const widgetsRef = useRef(widgets);
  widgetsRef.current = widgets;
  const onLayoutChangeRef = useRef(onLayoutChange);
  onLayoutChangeRef.current = onLayoutChange;

  // In coarse mode, derive uniform size from first widget (or defaults)
  const uniformW = useMemo(() => {
    if (!coarseMode || widgets.length === 0) return 3;
    if (widgets.length === 1) return cols;
    return Math.max(1, Math.min(cols, Math.floor(widgets[0].layout.w / 2)));
  }, [coarseMode, widgets, cols]);

  const uniformH = useMemo(() => {
    if (!coarseMode || widgets.length === 0) return 4;
    return Math.max(2, widgets[0].layout.h);
  }, [coarseMode, widgets]);

  // Convert visible widgets to react-grid-layout format
  const layout: Layout = useMemo(() => {
    if (coarseMode) {
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

  // Echo suppression: skip layout echo from RGL re-compacting
  const skipNextLayoutChangeRef = useRef(false);

  const handleLayoutChange = useCallback(
    (newLayout: Layout) => {
      if (skipNextLayoutChangeRef.current) {
        skipNextLayoutChangeRef.current = false;
        return;
      }

      const currentWidgets = widgetsRef.current;

      if (coarseMode) {
        const resizedItem = newLayout.find(
          (l: LayoutItem) => l.w !== uniformW || l.h !== uniformH
        );
        const newW = resizedItem ? resizedItem.w : uniformW;
        const newH = resizedItem ? resizedItem.h : uniformH;

        const rglSorted = [...newLayout].sort((a, b) => {
          if (a.y !== b.y) return a.y - b.y;
          return a.x - b.x;
        });

        const itemsPerRow = Math.max(1, Math.floor(cols / newW));
        const storageW = Math.round(newW * (colsProp / cols));

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
                layout: { ...widget.layout, x: storageX, y: storageY, w: storageW, h: newH },
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
                layout: { ...widget.layout, x: layoutItem.x, y: layoutItem.y, w: layoutItem.w, h: layoutItem.h },
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

  const hasFileWidgets = useMemo(
    () => widgets.some((w) => w.type === "file-group"),
    [widgets],
  );

  if (widgets.length === 0) {
    return null;
  }

  const margin = 16;
  const colWidth = (containerWidth - (cols - 1) * margin) / cols + margin;
  const rowHeightWithMargin = rowHeight + margin;

  const grid = (
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
        handles: ["se", "e"],
      }}
    >
      {widgets.map((widget) => {
        return (
          <div key={widget.id} className="h-full" data-testid="dashboard-widget">
            <WidgetCard
              widget={widget}
              isEditing={isEditing}
              onEdit={() => onEditWidget(widget)}
              onDelete={() => onDeleteWidget(widget.id)}
              onCopy={() => onCopyWidget?.(widget)}
              onMove={onMoveWidget ? (target) => onMoveWidget(widget.id, target) : undefined}
              moveTargets={moveTargets}
              onFullscreen={() => onFullscreenWidget?.(widget)}
              onUpdateScale={(axis, value) => onUpdateWidgetScale?.(widget.id, axis, value)}
              renderWidget={() => renderWidget(widget)}
            />
          </div>
        );
      })}
    </GridLayout>
  );

  if (hasFileWidgets) {
    return <ImageStepSyncProvider>{grid}</ImageStepSyncProvider>;
  }

  return grid;
}

