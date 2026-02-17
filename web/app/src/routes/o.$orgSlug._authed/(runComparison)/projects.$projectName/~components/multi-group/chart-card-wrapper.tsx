"use client";

import { useState, useCallback, useRef } from "react";
import { Maximize2Icon, SlidersHorizontalIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChartFullscreenDialog } from "@/components/charts/chart-fullscreen-dialog";
import { ChartBoundsPopover } from "@/components/charts/chart-bounds-popover";
import { ChartExportMenu } from "@/components/charts/chart-export-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ChartBounds {
  yMin?: number;
  yMax?: number;
}

function getBoundsKey(groupId: string, metricName: string): string {
  return `chartBounds_${groupId}_${metricName}`;
}

function loadBounds(groupId: string, metricName: string): ChartBounds {
  try {
    const raw = localStorage.getItem(getBoundsKey(groupId, metricName));
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error(`Failed to load chart bounds for ${getBoundsKey(groupId, metricName)}`, e);
  }
  return {};
}

function saveBounds(groupId: string, metricName: string, bounds: ChartBounds) {
  const key = getBoundsKey(groupId, metricName);
  if (bounds.yMin == null && bounds.yMax == null) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, JSON.stringify(bounds));
  }
}

/** Clear all chart bounds from localStorage */
export function clearAllChartBounds() {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("chartBounds_")) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));
}

interface ChartCardWrapperProps {
  metricName: string;
  groupId: string;
  renderChart: (yMin?: number, yMax?: number, onDataRange?: (dataMin: number, dataMax: number) => void, onResetBounds?: () => void) => React.ReactNode;
  /** Incrementing this key forces re-reading bounds from localStorage (used after reset all) */
  boundsResetKey?: number;
}

export function ChartCardWrapper({
  metricName,
  groupId,
  renderChart,
  boundsResetKey = 0,
}: ChartCardWrapperProps) {
  const [bounds, setBounds] = useState<ChartBounds>(() =>
    loadBounds(groupId, metricName)
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [dataRange, setDataRange] = useState<{ min: number; max: number } | null>(null);

  // Re-read bounds from localStorage when boundsResetKey changes
  const prevResetKeyRef = useRef(boundsResetKey);
  if (boundsResetKey !== prevResetKeyRef.current) {
    prevResetKeyRef.current = boundsResetKey;
    setBounds(loadBounds(groupId, metricName));
  }

  const handleBoundsChange = useCallback(
    (yMin?: number, yMax?: number) => {
      const newBounds = { yMin, yMax };
      setBounds(newBounds);
      saveBounds(groupId, metricName, newBounds);
    },
    [groupId, metricName]
  );

  const handleDataRange = useCallback((dataMin: number, dataMax: number) => {
    setDataRange({ min: dataMin, max: dataMax });
  }, []);

  const handleResetBounds = useCallback(() => {
    const newBounds = { yMin: undefined, yMax: undefined };
    setBounds(newBounds);
    saveBounds(groupId, metricName, newBounds);
  }, [groupId, metricName]);

  // Determine if data is being clipped by user-set bounds
  const clippingInfo = (() => {
    if (!dataRange) return null;
    if (bounds.yMin == null && bounds.yMax == null) return null;

    const clippedBelow = bounds.yMin != null && dataRange.min < bounds.yMin;
    const clippedAbove = bounds.yMax != null && dataRange.max > bounds.yMax;

    if (!clippedBelow && !clippedAbove) return null;

    const parts: string[] = [];
    if (clippedBelow) parts.push("below Y Min");
    if (clippedAbove) parts.push("above Y Max");
    return `Data clipped: values exist ${parts.join(" and ")}`;
  })();

  const chartContainerRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <div ref={chartContainerRef} className="relative h-full w-full" data-testid="chart-card" onDoubleClick={handleResetBounds}>
        {/* Chart content */}
        {renderChart(bounds.yMin, bounds.yMax, handleDataRange, handleResetBounds)}

        {/* Hover toolbar - top right */}
        <div className="absolute top-1 right-1 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {clippingInfo && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex size-7 items-center justify-center rounded-md bg-background/80 backdrop-blur-sm">
                  <TriangleAlertIcon className="size-3.5 text-amber-500" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">{clippingInfo}</p>
              </TooltipContent>
            </Tooltip>
          )}
          <ChartExportMenu
            getContainer={() => chartContainerRef.current}
            fileName={metricName}
            className="size-7 bg-background/80 backdrop-blur-sm hover:bg-background"
          />
          <ChartBoundsPopover
            yMin={bounds.yMin}
            yMax={bounds.yMax}
            onBoundsChange={handleBoundsChange}
          >
            <Button
              variant="ghost"
              size="icon"
              className="size-7 bg-background/80 backdrop-blur-sm hover:bg-background"
              data-testid="chart-bounds-btn"
            >
              <SlidersHorizontalIcon className="size-3.5" />
            </Button>
          </ChartBoundsPopover>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 bg-background/80 backdrop-blur-sm hover:bg-background"
            data-testid="chart-fullscreen-btn"
            onClick={() => setIsFullscreen(true)}
          >
            <Maximize2Icon className="size-3.5" />
          </Button>
        </div>

        {/* Persistent clipping indicator - always visible when data is clipped */}
        {clippingInfo && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="absolute bottom-1 right-1 z-10 flex size-5 items-center justify-center rounded-full bg-amber-500/20">
                <TriangleAlertIcon className="size-3 text-amber-500" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs">{clippingInfo}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Fullscreen dialog */}
      <ChartFullscreenDialog
        open={isFullscreen}
        onOpenChange={setIsFullscreen}
        title={metricName}
        yMin={bounds.yMin}
        yMax={bounds.yMax}
        onBoundsChange={handleBoundsChange}
      >
        {renderChart(bounds.yMin, bounds.yMax, handleDataRange, handleResetBounds)}
      </ChartFullscreenDialog>
    </>
  );
}
