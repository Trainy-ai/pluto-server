"use client";

import { useState, useCallback, useRef } from "react";
import { Maximize2Icon, SlidersHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChartFullscreenDialog } from "@/components/charts/chart-fullscreen-dialog";
import { useFullscreenContext } from "@/components/charts/context/fullscreen-context";
import { ChartScalePopover } from "@/components/charts/chart-scale-popover";
import { ChartExportMenu } from "@/components/charts/chart-export-menu";
import { extractCaptionFromDOM } from "@/components/charts/chart-export-utils";

interface ChartSettings {
  logXAxis?: boolean;
  logYAxis?: boolean;
  /** Charts tab override for workspace grouping. true = force
   *  per-run for this chart only; undefined/false = follow. Backed
   *  by the same localStorage entry as the log-scale toggles. */
  groupingOverride?: boolean;
  /** Per-chart cap on the number of distinct leaf groups the grouped
   *  query aggregates (default 10, max 100). Lives alongside the
   *  log-scale toggles so all per-chart prefs share one key. */
  maxGroups?: number;
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
    settings.logXAxis != null ||
    settings.logYAxis != null ||
    settings.groupingOverride != null ||
    settings.maxGroups != null;
  if (!hasValues) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, JSON.stringify(settings));
  }
}

interface ChartCardWrapperProps {
  metricName: string;
  groupId: string;
  renderChart: (
    onResetBounds?: () => void,
    logXAxis?: boolean,
    logYAxis?: boolean,
    yZoom?: boolean,
    yZoomRange?: [number, number] | null,
    onYZoomRangeChange?: (range: [number, number] | null) => void,
    /** True when the per-chart override toggle is ON (this chart
     *  ignores workspace grouping). The render function uses this to
     *  pick GroupedLineChart vs MultiLineChart. */
    groupingOverridden?: boolean,
    /** Per-chart cap on rendered leaf groups — forwarded to
     *  GroupedLineChart's `maxGroups` prop. Undefined means defer to
     *  the backend's default (10). */
    maxGroups?: number,
  ) => React.ReactNode;
  /** Incrementing this key forces re-reading settings from localStorage (used after reset all) */
  boundsResetKey?: number;
  /** Global X-axis log scale from settings panel (used as default when no per-chart override) */
  globalLogXAxis?: boolean;
  /** Global Y-axis log scale from settings panel (used as default when no per-chart override) */
  globalLogYAxis?: boolean;
  /** True when the page has active groupBy — controls visibility of
   *  the per-chart "Override Grouping" toggle in the gear popover. */
  workspaceGroupingActive?: boolean;
  /** Fires when the user flips the per-chart override toggle. The
   *  parent (MultiGroup → ChartCardWrapper) needs to know so it can
   *  swap GroupedLineChart out for MultiLineChart on this widget. */
  onGroupingOverrideChange?: (overridden: boolean) => void;
}

export function ChartCardWrapper({
  metricName,
  groupId,
  renderChart,
  boundsResetKey = 0,
  globalLogXAxis = false,
  globalLogYAxis = false,
  workspaceGroupingActive,
  onGroupingOverrideChange,
}: ChartCardWrapperProps) {
  const [settings, setSettings] = useState<ChartSettings>(() =>
    loadSettings(groupId, metricName)
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { setFullscreen } = useFullscreenContext();
  // Y zoom range shared between mini and fullscreen chart instances
  const [yZoomRange, setYZoomRange] = useState<[number, number] | null>(null);

  // Re-read settings from localStorage when boundsResetKey changes
  const prevResetKeyRef = useRef(boundsResetKey);
  if (boundsResetKey !== prevResetKeyRef.current) {
    prevResetKeyRef.current = boundsResetKey;
    setSettings(loadSettings(groupId, metricName));
  }

  // Compute effective log scale: per-chart override takes precedence over global
  const effectiveLogXAxis = settings.logXAxis ?? globalLogXAxis;
  const effectiveLogYAxis = settings.logYAxis ?? globalLogYAxis;

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

  const handleGroupingOverrideChange = useCallback(
    (overridden: boolean) => {
      setSettings((prev) => {
        const next = {
          ...prev,
          groupingOverride: overridden || undefined,
        };
        saveSettings(groupId, metricName, next);
        return next;
      });
      // Bubble up so MultiGroup picks the right render path on the
      // next pass.
      onGroupingOverrideChange?.(overridden);
    },
    [groupId, metricName, onGroupingOverrideChange],
  );

  // Effective override for the popover toggle's initial state.
  const groupingOverridden = settings.groupingOverride ?? false;

  const handleMaxGroupsChange = useCallback(
    (value: number) => {
      setSettings((prev) => {
        const next = { ...prev, maxGroups: value };
        saveSettings(groupId, metricName, next);
        return next;
      });
    },
    [groupId, metricName],
  );

  const handleYZoomRangeChange = useCallback((range: [number, number] | null) => {
    setYZoomRange(range);
  }, []);

  const chartContainerRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <div ref={chartContainerRef} className="group relative h-full w-full" data-testid="chart-card" data-log-x-scale={effectiveLogXAxis || undefined} data-log-y-scale={effectiveLogYAxis || undefined}>
        {/* Chart content */}
        {renderChart(undefined, effectiveLogXAxis, effectiveLogYAxis, true, yZoomRange, handleYZoomRangeChange, groupingOverridden, settings.maxGroups)}

        {/* Hover toolbar - top right */}
        <div className="absolute top-1 right-1 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <ChartExportMenu
            getContainer={() => chartContainerRef.current}
            fileName={metricName}
            className="size-7 bg-background/80 backdrop-blur-sm hover:bg-background"
            getCaption={() =>
              chartContainerRef.current
                ? extractCaptionFromDOM(chartContainerRef.current)
                : null
            }
          />
          <ChartScalePopover
            logXAxis={effectiveLogXAxis}
            logYAxis={effectiveLogYAxis}
            onLogScaleChange={handleLogScaleChange}
            workspaceGroupingActive={workspaceGroupingActive}
            groupingOverridden={groupingOverridden}
            onGroupingOverrideChange={handleGroupingOverrideChange}
            maxGroups={settings.maxGroups}
            onMaxGroupsChange={handleMaxGroupsChange}
          >
            <Button
              variant="ghost"
              size="icon"
              className="size-7 bg-background/80 backdrop-blur-sm hover:bg-background"
              data-testid="chart-bounds-btn"
            >
              <SlidersHorizontalIcon className="size-3.5" />
            </Button>
          </ChartScalePopover>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 bg-background/80 backdrop-blur-sm hover:bg-background"
            data-testid="chart-fullscreen-btn"
            onClick={() => { setIsFullscreen(true); setFullscreen(true); }}
          >
            <Maximize2Icon className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Fullscreen dialog — conditionally mounted to match the
          AR-DS / AR-DD render pattern (dashboard-builder.tsx:873,
          dynamic-section-grid.tsx:225). Previously this was always
          mounted with `open={isFullscreen}`, which meant every visible
          ChartCardWrapper had a dialog wrapper in the tree even when
          closed. Radix only renders dialog content when open, so the
          extra wrappers were not creating chart instances, but the
          renderChart() child was still being invoked on every render
          for every card and the tree shape diverged from dashboards. */}
      {isFullscreen && (
        <ChartFullscreenDialog
          open={true}
          onOpenChange={(open) => { setIsFullscreen(open); setFullscreen(open); }}
          title={metricName}
          logXAxis={effectiveLogXAxis}
          logYAxis={effectiveLogYAxis}
          onLogScaleChange={handleLogScaleChange}
        >
          {renderChart(undefined, effectiveLogXAxis, effectiveLogYAxis, true, yZoomRange, handleYZoomRangeChange, groupingOverridden, settings.maxGroups)}
        </ChartFullscreenDialog>
      )}
    </>
  );
}
