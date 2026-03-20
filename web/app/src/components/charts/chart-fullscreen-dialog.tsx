"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SlidersHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChartBoundsPopover } from "./chart-bounds-popover";
import { ChartExportMenu } from "./chart-export-menu";

const SIDEBAR_STORAGE_KEY = "fullscreen-legend-sidebar-width";
const DEFAULT_SIDEBAR_WIDTH = 256; // 16rem
const MIN_SIDEBAR_WIDTH = 120;
const MAX_SIDEBAR_WIDTH = 500;

function loadSidebarWidth(): number {
  try {
    const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (stored) {
      const w = Number(stored);
      if (w >= MIN_SIDEBAR_WIDTH && w <= MAX_SIDEBAR_WIDTH) return w;
    }
  } catch {}
  return DEFAULT_SIDEBAR_WIDTH;
}

interface ChartFullscreenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  /** When provided, renders a bounds popover in the header */
  yMin?: number;
  yMax?: number;
  onBoundsChange?: (yMin?: number, yMax?: number) => void;
  /** Log scale state for the popover toggles */
  logXAxis?: boolean;
  logYAxis?: boolean;
  onLogScaleChange?: (axis: "x" | "y", value: boolean) => void;
  onResetAll?: () => void;
}

export function ChartFullscreenDialog({
  open,
  onOpenChange,
  title,
  children,
  yMin,
  yMax,
  onBoundsChange,
  logXAxis,
  logYAxis,
  onLogScaleChange,
  onResetAll,
}: ChartFullscreenDialogProps) {
  const chartContentRef = useRef<HTMLDivElement>(null);
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const legendSidebarRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const isDraggingRef = useRef(false);

  // Move uPlot's .u-legend into the sidebar. The chart area hides .u-legend
  // via CSS (fullscreen-chart-area class) so the legend is invisible while
  // still at the bottom, preventing flicker. Polling moves it to the sidebar.
  useEffect(() => {
    if (!open) return;

    let currentLegend: Element | null = null;

    function moveLegend() {
      const chartArea = chartAreaRef.current;
      const sidebar = legendSidebarRef.current;
      if (!chartArea || !sidebar) return;

      const legend = chartArea.querySelector(".u-legend");
      if (legend && legend !== currentLegend) {
        while (sidebar.firstChild) {
          sidebar.removeChild(sidebar.firstChild);
        }
        currentLegend = legend;
        sidebar.appendChild(legend);
      }
    }

    const intervalId = setInterval(moveLegend, 100);

    return () => {
      clearInterval(intervalId);
      currentLegend = null;
    };
  }, [open]);

  // Drag-to-resize sidebar
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    function onMouseMove(ev: MouseEvent) {
      // Dragging left increases sidebar width
      const delta = startX - ev.clientX;
      const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, startWidth + delta));
      setSidebarWidth(newWidth);
    }

    function onMouseUp() {
      isDraggingRef.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Persist
      setSidebarWidth((w) => {
        try { localStorage.setItem(SIDEBAR_STORAGE_KEY, String(w)); } catch {}
        return w;
      });
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [sidebarWidth]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-w-[95vw] h-[90vh] flex-col p-6 data-[state=open]:!animate-none"
        onPointerDownOutside={(e) => {
          // Prevent closing when clicking on tooltip elements portaled to document.body
          const target = e.target as HTMLElement | null;
          if (target?.closest?.("[data-tooltip]") || target?.closest?.("[data-tooltip-add-dropdown]")) {
            e.preventDefault();
          }
        }}
        onInteractOutside={(e) => {
          // Prevent closing when interacting with tooltip elements outside the dialog
          const target = e.target as HTMLElement | null;
          if (target?.closest?.("[data-tooltip]") || target?.closest?.("[data-tooltip-add-dropdown]")) {
            e.preventDefault();
          }
        }}
        onEscapeKeyDown={(e) => {
          // Prevent closing when a pinned tooltip is active — let the tooltip
          // handle Escape first (unpin). The dialog closes on the next Escape.
          const pinnedTooltip = document.querySelector<HTMLElement>("[data-tooltip][data-pinned]");
          if (pinnedTooltip) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <div className="flex items-center justify-between pr-8 min-w-0">
            <DialogTitle className="truncate" title={title}>{title}</DialogTitle>
            <div className="flex items-center gap-2">
              <ChartExportMenu
                getContainer={() => chartContentRef.current}
                fileName={title}
                variant="header"
              />
              {onBoundsChange && (
                <ChartBoundsPopover
                  yMin={yMin}
                  yMax={yMax}
                  onBoundsChange={onBoundsChange}
                  logXAxis={logXAxis}
                  logYAxis={logYAxis}
                  onLogScaleChange={onLogScaleChange}
                  onResetAll={onResetAll}
                >
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    data-testid="chart-fullscreen-bounds-btn"
                  >
                    <SlidersHorizontalIcon className="size-3.5" />
                    Chart Settings
                  </Button>
                </ChartBoundsPopover>
              )}
            </div>
          </div>
        </DialogHeader>
        <div ref={chartContentRef} className="flex flex-1 min-h-0 gap-0">
          <div ref={chartAreaRef} className="fullscreen-chart-area flex-1 min-w-0 overflow-hidden">
            {children}
          </div>
          {/* Drag handle to resize sidebar */}
          <div
            className="fullscreen-legend-resize-handle"
            onMouseDown={handleDragStart}
          />
          <div
            ref={legendSidebarRef}
            className="fullscreen-legend-sidebar"
            style={{ width: sidebarWidth }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
