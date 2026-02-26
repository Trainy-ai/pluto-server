"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import LineChart, { type RawLineData } from "@/components/charts/line-wrapper";
import { ChartCardWrapper } from "@/routes/o.$orgSlug._authed/(runComparison)/projects.$projectName/~components/multi-group/chart-card-wrapper";
import { ensureGetGraph, useGetGraphProgressive } from "../../~queries/get-graph";
import { useCheckDatabaseSize } from "@/lib/db/local-cache";
import { metricsCache } from "@/lib/db/index";
import { useLineSettings, type LineChartSettings } from "../use-line-settings";
import { useZoomRefetch, zoomKey } from "@/lib/hooks/use-zoom-refetch";
import {
  getTimeUnitForDisplay,
  alignAndUnzip,
  downsampleAndSmooth,
  buildValueFlags,
  type ChartDataPoint,
} from "@/lib/chart-data-utils";

export type MetricDataPoint = ChartDataPoint;

interface LineChartWithFetchProps {
  logName: string;
  tenantId: string;
  projectName: string;
  runId: string;
}

type ChartData = {
  x: number[];
  y: number[];
  label: string;
  color?: string;
  opacity?: number;
  hideFromLegend?: boolean;
  valueFlags?: Map<number, string>;
};

type ChartConfig = {
  lines: ChartData[];
  rawLines?: RawLineData[];
  xlabel: string;
  isDateTime?: boolean;
  showLegend?: boolean;
  isSystem?: boolean;
  title?: string;
};


// Custom hook to handle system charts
function useSystemChartConfig(
  logName: string,
  data: MetricDataPoint[],
): ChartConfig | null {
  if (!logName.startsWith("sys/") && !logName.startsWith("_sys/")) {
    return null;
  }

  const sortedData = [...data].sort(
    (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
  );

  // Calculate all time differences in seconds from the first data point
  const relativeTimes = sortedData.map(
    (d) =>
      (new Date(d.time).getTime() - new Date(sortedData[0].time).getTime()) /
      1000,
  );

  // Determine appropriate time unit based on max value
  const maxSeconds = Math.max(...relativeTimes);
  const { divisor, unit } = getTimeUnitForDisplay(maxSeconds);

  // Convert all values to the selected unit
  const normalizedTimes = relativeTimes.map((seconds) => seconds / divisor);

  // Build valueFlags map for non-finite values
  let valueFlags: Map<number, string> | undefined;
  for (let i = 0; i < sortedData.length; i++) {
    const flag = sortedData[i].valueFlag;
    if (flag && flag !== "") {
      if (!valueFlags) valueFlags = new Map();
      valueFlags.set(normalizedTimes[i], flag);
    }
  }

  return {
    lines: [
      {
        x: normalizedTimes,
        y: sortedData.map((d) => Number(d.value)),
        label: logName,
        valueFlags,
      },
    ],
    title: logName,
    isDateTime: false,
    xlabel: `relative time (${unit})`,
    isSystem: true,
  };
}


// Chart strategy helper — builds chart config with downsampling + rawLines tracking
function buildChartStrategy(
  strategy: string,
  data: MetricDataPoint[],
  logName: string,
  color: string,
  smoothingSettings: LineChartSettings["smoothing"],
  maxPointsPerSeries: number,
  zoomData?: MetricDataPoint[],
): ChartConfig {
  const strategies: Record<string, () => ChartConfig> = {
    Step: () => {
      // Use zoom data (full-resolution for zoomed range) when available
      const isUsingZoomData = !!zoomData;
      const sourceData = zoomData ?? data;
      const baseData = {
        x: sourceData.map((d) => Number(d.step)),
        y: sourceData.map((d) => Number(d.value)),
        label: logName,
        color,
        valueFlags: buildValueFlags(sourceData, (d) => Number(d.step)),
      };

      // Store raw (pre-downsampled) data for zoom-aware re-downsampling
      const rawLines: RawLineData[] = maxPointsPerSeries > 0 ? [baseData] : [];

      // Skip downsampling for zoom data — it's already range-limited by the server,
      // so downsampling would re-introduce step gaps the zoom refetch was meant to fill.
      const effectiveMaxPoints = isUsingZoomData ? 0 : maxPointsPerSeries;

      return {
        lines: downsampleAndSmooth(baseData, effectiveMaxPoints, smoothingSettings),
        rawLines: rawLines.length > 0 ? rawLines : undefined,
        xlabel: "step",
      };
    },
    "Absolute Time": () => {
      const baseData = {
        x: data.map((d) => new Date(d.time).getTime()),
        y: data.map((d) => Number(d.value)),
        label: logName,
        color,
        valueFlags: buildValueFlags(data, (d) => new Date(d.time).getTime()),
      };

      const rawLines: RawLineData[] = maxPointsPerSeries > 0 ? [baseData] : [];

      return {
        lines: downsampleAndSmooth(baseData, maxPointsPerSeries, smoothingSettings),
        rawLines: rawLines.length > 0 ? rawLines : undefined,
        xlabel: "absolute time",
        isDateTime: true,
        showLegend: smoothingSettings.enabled,
      };
    },
    "Relative Time": () => {
      // Calculate all time differences in seconds
      const relativeTimes = data.map(
        (d) =>
          (new Date(d.time).getTime() - new Date(data[0].time).getTime()) /
          1000,
      );

      // Determine appropriate time unit based on max value
      const maxSeconds = Math.max(...relativeTimes);
      const { divisor, unit } = getTimeUnitForDisplay(maxSeconds);

      // Convert all values to the selected unit
      const normalizedTimes = relativeTimes.map((seconds) => seconds / divisor);

      // Build valueFlags map for non-finite values
      let valueFlags: Map<number, string> | undefined;
      for (let i = 0; i < data.length; i++) {
        const flag = data[i].valueFlag;
        if (flag && flag !== "") {
          if (!valueFlags) valueFlags = new Map();
          valueFlags.set(normalizedTimes[i], flag);
        }
      }

      const baseData = {
        x: normalizedTimes,
        y: data.map((d) => Number(d.value)),
        label: logName,
        color,
        valueFlags,
      };

      const rawLines: RawLineData[] = maxPointsPerSeries > 0 ? [baseData] : [];

      return {
        lines: downsampleAndSmooth(baseData, maxPointsPerSeries, smoothingSettings),
        rawLines: rawLines.length > 0 ? rawLines : undefined,
        xlabel: `relative time (${unit})`,
        showLegend: smoothingSettings.enabled,
      };
    },
    default: () => {
      const baseData = {
        x: data.map((d) => Number(d.step)),
        y: data.map((d) => Number(d.value)),
        label: logName,
        color,
        valueFlags: buildValueFlags(data, (d) => Number(d.step)),
      };

      const rawLines: RawLineData[] = maxPointsPerSeries > 0 ? [baseData] : [];

      return {
        lines: downsampleAndSmooth(baseData, maxPointsPerSeries, smoothingSettings),
        rawLines: rawLines.length > 0 ? rawLines : undefined,
        xlabel: "step",
      };
    },
  };

  return (strategies[strategy] || strategies.default)();
}

// Custom hook for chart configuration generation
function useChartConfig(
  data: MetricDataPoint[] | undefined,
  logName: string,
  tenantId: string,
  projectName: string,
  runId: string,
  settings: LineChartSettings,
  zoomData?: MetricDataPoint[],
): [ChartConfig | null, boolean] {
  const [chartConfig, setChartConfig] = useState<ChartConfig | null>(null);
  const [isLoadingCustomChart, setIsLoadingCustomChart] = useState(false);
  const COLOR = "hsl(216, 66%, 60%)";
  const maxPts = settings.maxPointsPerSeries;

  useEffect(() => {
    if (!data || data.length === 0) {
      setChartConfig(null);
      return;
    }

    const generateChartConfig = async () => {
      // Check if this is a system chart
      const systemConfig = useSystemChartConfig(logName, data);
      if (systemConfig) {
        setChartConfig(systemConfig);
        return;
      }

      // Standard chart strategy
      const selectedLog = settings.selectedLog;

      if (["Step", "Absolute Time", "Relative Time"].includes(selectedLog)) {
        setChartConfig(
          buildChartStrategy(
            selectedLog,
            data,
            logName,
            COLOR,
            settings.smoothing,
            maxPts,
            zoomData,
          ),
        );
        return;
      }

      // Custom selected log chart
      setIsLoadingCustomChart(true);

      try {
        const selectLogData = await ensureGetGraph(
          tenantId,
          projectName,
          runId,
          selectedLog,
        );

        if (!selectLogData || selectLogData.length === 0) {
          setChartConfig(
            buildChartStrategy(
              "default",
              data,
              logName,
              COLOR,
              settings.smoothing,
              maxPts,
            ),
          );
          return;
        }

        const { x, y } = alignAndUnzip(selectLogData, data);

        if (x.length === 0 || y.length === 0) {
          // No matching data points found, fall back to default
          setChartConfig(null);
          return;
        }

        const baseData = {
          x,
          y,
          label: logName,
          color: COLOR,
        };

        const rawLines: RawLineData[] = maxPts > 0 ? [baseData] : [];

        setChartConfig({
          lines: downsampleAndSmooth(baseData, maxPts, settings.smoothing),
          rawLines: rawLines.length > 0 ? rawLines : undefined,
          xlabel: selectedLog,
          showLegend: settings.smoothing.enabled,
        });
      } catch (error) {
        console.error("Error generating custom chart:", error);
        setChartConfig(
          buildChartStrategy("default", data, logName, COLOR, settings.smoothing, maxPts),
        );
      } finally {
        setIsLoadingCustomChart(false);
      }
    };

    generateChartConfig();
  }, [data, logName, settings, tenantId, projectName, runId, zoomData, maxPts]);

  return [chartConfig, isLoadingCustomChart];
}

// Main component with refactored structure
export const LineChartWithFetch = memo(
  ({
    logName,
    tenantId,
    projectName,
    runId,
  }: LineChartWithFetchProps) => {
    useCheckDatabaseSize(metricsCache);

    const { data, isLoading, isError, tier, fullProgress, isSampled } = useGetGraphProgressive(
      tenantId,
      projectName,
      runId,
      logName,
    );

    const { settings } = useLineSettings(tenantId, projectName, runId);

    // Zoom-triggered server re-fetch for full-resolution step data
    // Disabled when full tier is loaded (all data already client-side)
    const runIdsMemo = useMemo(() => [runId], [runId]);
    const logNamesMemo = useMemo(() => [logName], [logName]);
    const { zoomDataMap, onZoomRangeChange, isZoomFetching } = useZoomRefetch({
      organizationId: tenantId,
      projectName,
      logNames: logNamesMemo,
      runIds: runIdsMemo,
      selectedLog: settings.selectedLog,
      enabled: tier !== "full",
    });
    const zoomData = tier !== "full" ? zoomDataMap?.get(zoomKey(runId, logName)) : undefined;

    const [chartConfig, isLoadingCustomChart] = useChartConfig(
      data,
      logName,
      tenantId,
      projectName,
      runId,
      settings,
      zoomData,
    );

    // Callback for zoom-aware re-downsampling: slices raw data to visible range
    // and runs the full downsample+smooth pipeline to produce consistent series structure.
    const reprocessForZoom = useMemo(() => {
      if (settings.maxPointsPerSeries <= 0) return undefined;
      const smoothing = settings.smoothing;
      return (raws: RawLineData[], xMin: number, xMax: number) => {
        return raws.flatMap((raw) => {
          // Find visible range with 1-point margin on each side
          let startIdx = 0;
          let endIdx = raw.x.length;
          for (let j = 0; j < raw.x.length; j++) {
            if (raw.x[j] >= xMin) { startIdx = Math.max(0, j - 1); break; }
          }
          for (let j = raw.x.length - 1; j >= 0; j--) {
            if (raw.x[j] <= xMax) { endIdx = Math.min(raw.x.length, j + 2); break; }
          }
          const sliced = {
            x: raw.x.slice(startIdx, endIdx),
            y: raw.y.slice(startIdx, endIdx),
            label: raw.label,
            seriesId: raw.seriesId,
            color: raw.color,
          };
          // Show ALL raw data points in the visible range (maxPts=0).
          // downsampleAndSmooth always produces consistent series count
          // (main + envelope), matching the initial render for setData compatibility.
          return downsampleAndSmooth(sliced, 0, smoothing);
        });
      };
    }, [settings.maxPointsPerSeries, settings.smoothing]);

    // Render loading state
    if ((isLoading && !data) || isLoadingCustomChart) {
      return (
        <Card className="h-full">
          <Skeleton className="h-full" />
        </Card>
      );
    }

    // Render error state
    if (isError) {
      return (
        <div className="flex h-full flex-grow flex-col items-center justify-center bg-red-500">
          <h2 className="text-2xl font-bold">{logName}</h2>
          <p className="text-sm text-gray-200">Error fetching data</p>
        </div>
      );
    }

    // Show "no data" state when the run has no data points at all
    if (!data || data.length === 0) {
      return (
        <div className="flex h-full flex-grow flex-col items-center justify-center bg-accent p-4">
          <p className="text-center text-sm text-gray-500">
            No data received yet
          </p>
        </div>
      );
    }

    if (!chartConfig) {
      return (
        <div className="flex h-full flex-grow flex-col items-center justify-center bg-accent p-4">
          <p className="text-center text-sm text-gray-500">
            Could not compare{" "}
            <code className="rounded bg-muted px-1">{logName}</code> with{" "}
            <code className="rounded bg-muted px-1">
              {settings.selectedLog}
            </code>
          </p>
        </div>
      );
    }

    // Render chart wrapped in ChartCardWrapper for fullscreen + Y-axis bounds + log scale
    return (
      <ChartCardWrapper
        metricName={logName}
        groupId={`run-${runId}`}
        globalLogXAxis={settings.xAxisLogScale}
        globalLogYAxis={settings.yAxisLogScale}
        renderChart={(yMin, yMax, onDataRange, onResetBounds, logXAxis, logYAxis) => {
          const commonProps = {
            className: "h-full",
            title: logName,
            logXAxis: logXAxis ?? settings.xAxisLogScale,
            logYAxis: logYAxis ?? settings.yAxisLogScale,
            tooltipInterpolation: settings.tooltipInterpolation,
            outlierDetection: settings.yAxisScaleMode === "outlier-aware",
          };

          return (
            <div className="relative h-full w-full">
              {/* Full-resolution loading progress bar */}
              {isSampled && tier !== "full" && fullProgress > 0 && (
                <div className="absolute top-0 right-0 left-0 z-10 h-0.5 bg-muted">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${fullProgress * 100}%` }}
                  />
                </div>
              )}
              {/* Zoom refetch loading indicator */}
              {isZoomFetching && (
                <div className="absolute top-0 right-0 left-0 z-10 h-0.5 overflow-hidden bg-muted">
                  <div className="h-full w-1/3 animate-[shimmer_1s_ease-in-out_infinite] bg-primary" />
                </div>
              )}
              {chartConfig.isSystem ? (
                <LineChart
                  {...commonProps}
                  lines={chartConfig.lines}
                  isDateTime={chartConfig.isDateTime}
                  xlabel={chartConfig.xlabel}
                  yMin={yMin}
                  yMax={yMax}
                  onDataRange={onDataRange}
                  onResetBounds={onResetBounds}
                  rawLines={chartConfig.rawLines}
                  downsampleTarget={settings.maxPointsPerSeries}
                  reprocessForZoom={reprocessForZoom}
                  onZoomRangeChange={onZoomRangeChange}
                />
              ) : (
                <LineChart
                  {...commonProps}
                  lines={chartConfig.lines}
                  xlabel={chartConfig.xlabel}
                  isDateTime={chartConfig.isDateTime}
                  showLegend={chartConfig.showLegend}
                  yMin={yMin}
                  yMax={yMax}
                  onDataRange={onDataRange}
                  onResetBounds={onResetBounds}
                  rawLines={chartConfig.rawLines}
                  downsampleTarget={settings.maxPointsPerSeries}
                  reprocessForZoom={reprocessForZoom}
                  onZoomRangeChange={onZoomRangeChange}
                />
              )}
            </div>
          );
        }}
      />
    );
  },
);
