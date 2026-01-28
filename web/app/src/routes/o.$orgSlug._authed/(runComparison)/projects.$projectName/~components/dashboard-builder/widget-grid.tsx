import { useMemo, useCallback } from "react";
import GridLayout, { type Layout, type LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./widget-grid.css";
import { cn } from "@/lib/utils";
import { MoreHorizontalIcon, PencilIcon, Trash2Icon, MoveIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Widget, WidgetLayout } from "../../~types/dashboard-types";

interface WidgetGridProps {
  widgets: Widget[];
  onLayoutChange: (widgets: Widget[]) => void;
  onEditWidget: (widget: Widget) => void;
  onDeleteWidget: (widgetId: string) => void;
  renderWidget: (widget: Widget) => React.ReactNode;
  isEditing?: boolean;
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
  isEditing = false,
  cols = 12,
  rowHeight = 80,
  containerWidth = 1200,
}: WidgetGridProps) {
  // Convert widgets to react-grid-layout format
  const layout: Layout = useMemo(() => {
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
  }, [widgets]);

  // Handle layout changes from react-grid-layout
  const handleLayoutChange = useCallback(
    (newLayout: Layout) => {
      const updatedWidgets = widgets.map((widget) => {
        const layoutItem = newLayout.find((l: LayoutItem) => l.i === widget.id);
        if (layoutItem) {
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
        return widget;
      });
      onLayoutChange(updatedWidgets);
    },
    [widgets, onLayoutChange]
  );

  if (widgets.length === 0) {
    return null;
  }

  return (
    <GridLayout
      className="widget-grid"
      layout={layout}
      width={containerWidth}
      onLayoutChange={handleLayoutChange}
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
        threshold: 3,
      }}
      resizeConfig={{
        enabled: isEditing,
        handles: ["se"],
      }}
    >
      {widgets.map((widget) => (
        <div
          key={widget.id}
          className={cn(
            "group relative rounded-lg border bg-card shadow-sm",
            isEditing && "ring-1 ring-transparent hover:ring-primary/50"
          )}
        >
          {/* Widget Header */}
          <div className="relative z-10 flex items-center justify-between border-b px-3 py-2 bg-card">
            <div className="flex items-center gap-2">
              {isEditing && (
                <div className="widget-drag-handle cursor-move text-muted-foreground hover:text-foreground">
                  <MoveIcon className="size-4" />
                </div>
              )}
              <span className="text-sm font-medium truncate">
                {widget.config.title || getWidgetTitle(widget)}
              </span>
            </div>

            {isEditing && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 opacity-0 group-hover:opacity-100"
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

          {/* Widget Content */}
          <div className="h-[calc(100%-40px)] overflow-hidden p-2">
            {renderWidget(widget)}
          </div>
        </div>
      ))}
    </GridLayout>
  );
}

// Helper to get widget title based on type and config
function getWidgetTitle(widget: Widget): string {
  switch (widget.type) {
    case "chart": {
      const config = widget.config as { metrics?: string[] };
      if (config.metrics && config.metrics.length > 0) {
        if (config.metrics.length === 1) {
          return config.metrics[0];
        }
        return `${config.metrics.length} metrics`;
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
    case "file-series":
      return "File Series";
    default:
      return "Widget";
  }
}

