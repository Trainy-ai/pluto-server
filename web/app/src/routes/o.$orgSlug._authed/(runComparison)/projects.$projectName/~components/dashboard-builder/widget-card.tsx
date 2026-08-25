import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
  MoveIcon,
  Maximize2Icon,
  Minimize2Icon,
  SlidersHorizontalIcon,
  ZapIcon,
  CopyIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChartScalePopover } from "@/components/charts/chart-scale-popover";
import { ChartExportMenu } from "@/components/charts/chart-export-menu";
import { extractCaptionFromDOM } from "@/components/charts/chart-export-utils";
import { VirtualizedChart } from "@/components/core/virtualized-chart";
import { ArrowRightIcon, FolderIcon } from "lucide-react";
import type {
  Widget,
  ChartWidgetConfig,
  HistogramWidgetConfig,
  HistogramViewMode,
} from "../../~types/dashboard-types";
import { getWidgetTitle, hasWidgetPatterns } from "./widget-utils";
import type { SectionLocation } from "./use-dashboard-config";
import { HistogramModeToggle } from "../multi-group/histogram-view";

/** Height of the widget card header in pixels. */
const WIDGET_HEADER_HEIGHT = 40;

interface MoveTarget {
  label: string;
  location: SectionLocation;
  isFolder: boolean;
}

interface WidgetCardProps {
  widget: Widget;
  isEditing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onMove?: (target: SectionLocation) => void;
  moveTargets?: MoveTarget[];
  onFullscreen?: () => void;
  onUpdateScale?: (axis: "x" | "y", value: boolean) => void;
  /** True when the page has active groupBy — controls visibility of
   *  the per-chart "Override Grouping" toggle in Chart Settings. */
  workspaceGroupingActive?: boolean;
  /** Per-chart override: true = override (force per-run); false /
   *  undefined = follow workspace grouping. Persisted via
   *  ChartWidgetConfig.groupingOverride. */
  groupingOverridden?: boolean;
  onGroupingOverrideChange?: (overridden: boolean) => void;
  /** Per-widget maxGroups cap (1..100). Persisted via
   *  ChartWidgetConfig.maxGroups. */
  maxGroups?: number;
  onMaxGroupsChange?: (value: number) => void;
  onUpdateHistogramMode?: (mode: HistogramViewMode) => void;
  renderWidget: () => ReactNode;
}

export function WidgetCard({
  widget,
  isEditing,
  onEdit,
  onDelete,
  onCopy,
  onMove,
  moveTargets,
  onFullscreen,
  onUpdateScale,
  workspaceGroupingActive,
  groupingOverridden,
  onGroupingOverrideChange,
  maxGroups,
  onMaxGroupsChange,
  onUpdateHistogramMode,
  renderWidget,
}: WidgetCardProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chartConfig = widget.type === "chart" ? (widget.config as ChartWidgetConfig) : null;
  const histogramConfig =
    widget.type === "histogram" ? (widget.config as HistogramWidgetConfig) : null;

  // Panel fullscreen uses the native Fullscreen API on the CARD ITSELF
  // instead of ChartFullscreenDialog. Rationale: the panel's content is a
  // live Pyodide kernel inside an iframe — rendering it into a dialog
  // (Radix portal) or reparenting the iframe in any way reloads the
  // iframe's document and forces a full ~10s kernel reboot. Promoting
  // the card to the browser top layer keeps the exact same iframe
  // instance running (no DOM move), and — unlike position:fixed — also
  // escapes react-grid-layout's `transform` containing block.
  const isPanel = widget.type === "panel";
  const [isPanelFullscreen, setIsPanelFullscreen] = useState(false);
  useEffect(() => {
    if (!isPanel) {
      return;
    }
    const onFullscreenChange = () => {
      setIsPanelFullscreen(document.fullscreenElement === rootRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [isPanel]);

  const togglePanelFullscreen = () => {
    if (document.fullscreenElement === rootRef.current) {
      void document.exitFullscreen();
    } else {
      void rootRef.current?.requestFullscreen();
    }
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        "group relative h-full rounded-lg border bg-card shadow-sm",
        isEditing && "ring-1 ring-transparent hover:ring-primary/50",
        isPanelFullscreen && "rounded-none border-0"
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
              <span
                className="min-w-0 truncate text-sm font-medium"
                data-testid="widget-card-title"
              >
                {widget.config.title || getWidgetTitle(widget)}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">{widget.config.title || getWidgetTitle(widget)}</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* Histogram-specific actions */}
          {widget.type === "histogram" && histogramConfig && (
            <div className="widget-drag-cancel">
              <HistogramModeToggle
                mode={histogramConfig.viewMode ?? "step"}
                onChange={(mode) => onUpdateHistogramMode?.(mode)}
              />
            </div>
          )}

          {/* Chart-specific actions — pure line chart now (bars/histograms
              live in distributions widgets). Camera, Log-scale, and
              Fullscreen buttons all show on hover; per-distribution-entry
              panels render their own per-panel chrome inside the
              distributions widget. */}
          {widget.type === "chart" && (
            <>
              <ChartExportMenu
                getContainer={() => contentRef.current}
                fileName={widget.config.title || getWidgetTitle(widget)}
                className="widget-drag-cancel size-7 opacity-0 group-hover:opacity-100"
                getCaption={() =>
                  contentRef.current ? extractCaptionFromDOM(contentRef.current) : null
                }
              />
              <ChartScalePopover
                logXAxis={chartConfig?.xAxisScale === "log"}
                logYAxis={chartConfig?.yAxisScale === "log"}
                onLogScaleChange={(axis, value) => onUpdateScale?.(axis, value)}
                workspaceGroupingActive={workspaceGroupingActive}
                groupingOverridden={groupingOverridden}
                onGroupingOverrideChange={onGroupingOverrideChange}
                maxGroups={maxGroups}
                onMaxGroupsChange={onMaxGroupsChange}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="widget-drag-cancel size-7 opacity-0 group-hover:opacity-100"
                  data-testid="chart-bounds-btn"
                >
                  <SlidersHorizontalIcon className="size-3.5" />
                </Button>
              </ChartScalePopover>
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

          {/* Panel-specific actions: native-fullscreen toggle (see the
              rationale above — a dialog would reboot the Python kernel).
              Hidden where the Fullscreen API is unavailable (e.g. iPhone
              Safari); always visible while fullscreen so it can exit. */}
          {isPanel &&
            typeof document !== "undefined" &&
            document.fullscreenEnabled && (
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "widget-drag-cancel size-7 opacity-0 group-hover:opacity-100",
                  isPanelFullscreen && "opacity-100"
                )}
                data-testid="panel-fullscreen-btn"
                onClick={togglePanelFullscreen}
              >
                {isPanelFullscreen ? (
                  <Minimize2Icon className="size-3.5" />
                ) : (
                  <Maximize2Icon className="size-3.5" />
                )}
              </Button>
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
                {onMove && moveTargets && moveTargets.length > 0 && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <ArrowRightIcon className="mr-2 size-4" />
                      Move to...
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="max-h-60 overflow-y-auto">
                      {moveTargets.map((target) => (
                        <DropdownMenuItem
                          key={`${target.location.parentId ?? ""}-${target.location.sectionId}`}
                          onClick={() => onMove(target.location)}
                        >
                          {target.isFolder && <FolderIcon className="mr-2 size-3.5 text-primary/60" />}
                          <span className="truncate">{target.label}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
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
      >
        <VirtualizedChart minHeight="100%" loadMargin="400px" unloadMargin="1200px">
          {renderWidget()}
        </VirtualizedChart>
      </div>
    </div>
  );
}
