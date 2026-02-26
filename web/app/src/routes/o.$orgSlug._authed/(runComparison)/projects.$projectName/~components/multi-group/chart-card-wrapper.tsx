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

interface ChartSettings {
  yMin?: number;
  yMax?: number;
  logXAxis?: boolean;
  logYAxis?: boolean;
}

function getSettingsKey(groupId: string, metricName: string): string {
  return `chartBounds_${groupId}_${metricName}`;
}

function loadSettings(groupId: string, metricName: string): ChartSettings {
  try {
    const raw = localStorage.getItem(getSettingsKey(groupId, metricName));
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error(`Failed to load chart settings for ${getSettingsKey(groupId, metricName)}`, e);
  }
  return {};
}

function saveSettings(groupId: string, metricName: string, settings: ChartSettings) {
  const key = getSettingsKey(groupId, metricName);
  const hasValues =
    settings.yMin != null ||
    settings.yMax != null ||
    settings.logXAxis != null ||
    settings.logYAxis != null;
  if (!hasValues) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, JSON.stringify(settings));
  }
}

/** Clear all chart settings (bounds + log scale overrides) from localStorage */
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
  renderChart: (
    yMin?: number,
    yMax?: number,
    onDataRange?: (dataMin: number, dataMax: number) => void,
    onResetBounds?: () => void,
    logXAxis?: boolean,
    logYAxis?: boolean,
  ) => React.ReactNode;
  /** Incrementing this key forces re-reading settings from localStorage (used after reset all) */
  boundsResetKey?: number;
  /** Global X-axis log scale from settings panel (used as default when no per-chart override) */
  globalLogXAxis?: boolean;
  /** Global Y-axis log scale from settings panel (used as default when no per-chart override) */
  globalLogYAxis?: boolean;
}

export function ChartCardWrapper({
  metricName,
  groupId,
  renderChart,
  boundsResetKey = 0,
  globalLogXAxis = false,
  globalLogYAxis = false,
}: ChartCardWrapperProps) {
  const [settings, setSettings] = useState<ChartSettings>(() =>
    loadSettings(groupId, metricName)
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [dataRange, setDataRange] = useState<{ min: number; max: number } | null>(null);

  // Re-read settings from localStorage when boundsResetKey changes
  const prevResetKeyRef = useRef(boundsResetKey);
  if (boundsResetKey !== prevResetKeyRef.current) {
    prevResetKeyRef.current = boundsResetKey;
    setSettings(loadSettings(groupId, metricName));
  }

  // Compute effective log scale: per-chart override takes precedence over global
  const effectiveLogXAxis = settings.logXAxis ?? globalLogXAxis;
  const effectiveLogYAxis = settings.logYAxis ?? globalLogYAxis;

  const handleBoundsChange = useCallback(
    (yMin?: number, yMax?: number) => {
      setSettings((prev) => {
        const next = { ...prev, yMin, yMax };
        saveSettings(groupId, metricName, next);
        return next;
      });
    },
    [groupId, metricName]
  );

  const handleLogScaleChange = useCallback(
    (axis: "x" | "y", value: boolean) => {
      setSettings((prev) => {
        const next = {
          ...prev,
          ...(axis === "x" ? { logXAxis: value } : { logYAxis: value }),
        };
        saveSettings(groupId, metricName, next);
        return next;
      });
    },
    [groupId, metricName]
  );

  const handleDataRange = useCallback((dataMin: number, dataMax: number) => {
    setDataRange({ min: dataMin, max: dataMax });
  }, []);

  const handleResetBounds = useCallback(() => {
    const newSettings: ChartSettings = {};
    setSettings(newSettings);
    saveSettings(groupId, metricName, newSettings);
  }, [groupId, metricName]);

  const handleResetAll = useCallback(() => {
    const newSettings: ChartSettings = {};
    setSettings(newSettings);
    saveSettings(groupId, metricName, newSettings);
  }, [groupId, metricName]);

  // Determine if data is being clipped by user-set bounds
  const clippingInfo = (() => {
    if (!dataRange) return null;
    if (settings.yMin == null && settings.yMax == null) return null;

    const clippedBelow = settings.yMin != null && dataRange.min < settings.yMin;
    const clippedAbove = settings.yMax != null && dataRange.max > settings.yMax;

    if (!clippedBelow && !clippedAbove) return null;

    const parts: string[] = [];
    if (clippedBelow) parts.push("below Y Min");
    if (clippedAbove) parts.push("above Y Max");
    return `Data clipped: values exist ${parts.join(" and ")}`;
  })();

  const chartContainerRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <div ref={chartContainerRef} className="relative h-full w-full" data-testid="chart-card" data-log-x-scale={effectiveLogXAxis || undefined} data-log-y-scale={effectiveLogYAxis || undefined} onDoubleClick={handleResetBounds}>
        {/* Chart content */}
        {renderChart(settings.yMin, settings.yMax, handleDataRange, handleResetBounds, effectiveLogXAxis, effectiveLogYAxis)}

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
            yMin={settings.yMin}
            yMax={settings.yMax}
            onBoundsChange={handleBoundsChange}
            logXAxis={effectiveLogXAxis}
            logYAxis={effectiveLogYAxis}
            onLogScaleChange={handleLogScaleChange}
            onResetAll={handleResetAll}
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
        yMin={settings.yMin}
        yMax={settings.yMax}
        onBoundsChange={handleBoundsChange}
        logXAxis={effectiveLogXAxis}
        logYAxis={effectiveLogYAxis}
        onLogScaleChange={handleLogScaleChange}
        onResetAll={handleResetAll}
      >
        {renderChart(settings.yMin, settings.yMax, handleDataRange, handleResetBounds, effectiveLogXAxis, effectiveLogYAxis)}
      </ChartFullscreenDialog>
    </>
  );
}
