import { type ReactNode, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
  MoveIcon,
  Maximize2Icon,
  SlidersHorizontalIcon,
  TriangleAlertIcon,
  ZapIcon,
  CopyIcon,
} from "lucide-react";
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
import type { Widget, ChartWidgetConfig } from "../../~types/dashboard-types";
import { getWidgetTitle, hasWidgetPatterns } from "./widget-utils";

/** Height of the widget card header in pixels. */
const WIDGET_HEADER_HEIGHT = 40;

interface WidgetCardProps {
  widget: Widget;
  isEditing: boolean;
  clippingInfo: string | null;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onFullscreen?: () => void;
  onUpdateBounds?: (yMin?: number, yMax?: number) => void;
  onUpdateScale?: (axis: "x" | "y", value: boolean) => void;
  onDataRange?: (dataMin: number, dataMax: number) => void;
  onResetBounds?: () => void;
  renderWidget: (
    onDataRange?: (dataMin: number, dataMax: number) => void,
    onResetBounds?: () => void,
  ) => ReactNode;
}

export function WidgetCard({
  widget,
  isEditing,
  clippingInfo,
  onEdit,
  onDelete,
  onCopy,
  onFullscreen,
  onUpdateBounds,
  onUpdateScale,
  renderWidget,
}: WidgetCardProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const chartConfig = widget.type === "chart" ? (widget.config as ChartWidgetConfig) : null;

  return (
    <div
      className={cn(
        "group relative h-full rounded-lg border bg-card shadow-sm",
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
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="min-w-0 truncate text-sm font-medium">
                {widget.config.title || getWidgetTitle(widget)}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">{widget.config.title || getWidgetTitle(widget)}</p>
            </TooltipContent>
          </Tooltip>
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
                getContainer={() => contentRef.current}
                fileName={widget.config.title || getWidgetTitle(widget)}
                className="widget-drag-cancel size-7 opacity-0 group-hover:opacity-100"
              />
              <ChartBoundsPopover
                yMin={chartConfig?.yMin}
                yMax={chartConfig?.yMax}
                onBoundsChange={(yMin, yMax) => onUpdateBounds?.(yMin, yMax)}
                logXAxis={chartConfig?.xAxisScale === "log"}
                logYAxis={chartConfig?.yAxisScale === "log"}
                onLogScaleChange={(axis, value) => onUpdateScale?.(axis, value)}
                onResetAll={() => {
                  onUpdateBounds?.(undefined, undefined);
                  onUpdateScale?.("x", false);
                  onUpdateScale?.("y", false);
                }}
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
                onClick={() => onFullscreen?.()}
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
                  data-testid="widget-menu-btn"
                >
                  <MoreHorizontalIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}>
                  <PencilIcon className="mr-2 size-4" />
                  Edit Widget
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onCopy}>
                  <CopyIcon className="mr-2 size-4" />
                  Copy Widget
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={onDelete}
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
        ref={contentRef}
        data-testid="widget-content"
        className={`h-[calc(100%-${WIDGET_HEADER_HEIGHT}px)] overflow-auto p-2`}
        onDoubleClick={
          widget.type === "chart"
            ? () => onUpdateBounds?.(undefined, undefined)
            : undefined
        }
      >
        <VirtualizedChart minHeight="100%" loadMargin="400px" unloadMargin="1200px">
          {renderWidget(
            widget.type === "chart"
              ? undefined // dataRange handled at grid level
              : undefined,
            widget.type === "chart"
              ? () => onUpdateBounds?.(undefined, undefined)
              : undefined,
          )}
        </VirtualizedChart>
      </div>
    </div>
  );
}
