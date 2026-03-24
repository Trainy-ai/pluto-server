"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import LineChart from "@/components/charts/line-wrapper";
import { ChartCardWrapper } from "@/routes/o.$orgSlug._authed/(runComparison)/projects.$projectName/~components/multi-group/chart-card-wrapper";
import { ensureGetGraph, useGetGraphProgressive } from "../../~queries/get-graph";
import { useCheckDatabaseSize } from "@/lib/db/local-cache";
import { metricsCache, type MetricDataPoint } from "@/lib/db/index";
import { useLineSettings, type LineChartSettings } from "../use-line-settings";
import { useChartSyncContext } from "@/components/charts/context/chart-sync-context";
import { useZoomRefetch, zoomKey } from "@/lib/hooks/use-zoom-refetch";
import {
  alignAndUnzip,
  applySmoothing,
  bucketedAndSmooth,
  type BucketedChartDataPoint,
  type ChartSeriesData,
} from "@/lib/chart-data-utils";
import { parseChTimeMs } from "@/components/charts/lib/format";
import { resolveChartBuckets } from "@/lib/chart-bucket-estimate";

interface LineChartWithFetchProps {
  logName: string;
  tenantId: string;
  projectName: string;
  runId: string;
  boundsResetKey?: number;
  runCreatedAt?: string;
  runName?: string;
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
  lines: ChartSeriesData[];
  xlabel: string;
  isDateTime?: boolean;
  showLegend?: boolean;
  isSystem?: boolean;
  title?: string;
};


/** Relative-time baseline: use run.createdAt when available, else first data point. */
function getBaseline(firstPointMs: number, runCreatedAt?: string): number {
  if (runCreatedAt) return new Date(runCreatedAt).getTime();
  return firstPointMs;
}

// Custom hook to handle system charts
function useSystemChartConfig(
  logName: string,
  data: BucketedChartDataPoint[],
  runCreatedAt?: string,
): ChartConfig | null {
  if (!logName.startsWith("sys/") && !logName.startsWith("_sys/")) {
    return null;
  }

  const sortedData = [...data].sort(
    (a, b) => parseChTimeMs(a.time) - parseChTimeMs(b.time),
  );

  const baselineMs = getBaseline(parseChTimeMs(sortedData[0].time), runCreatedAt);

  const getX = (d: BucketedChartDataPoint) =>
    (parseChTimeMs(d.time) - baselineMs) / 1000;

  return {
    lines: bucketedAndSmooth(
      sortedData, logName, "hsl(216, 66%, 60%)",
      { enabled: false, algorithm: "ema", parameter: 0, showOriginalData: false },
      false, undefined, undefined, getX,
    ),
    title: logName,
    isDateTime: false,
    xlabel: "relative time",
    isSystem: true,
  };
}


/** Inject tooltip metadata (runId / runName / metricName) into chart series */
function withMeta(
  lines: ChartSeriesData[],
  logName: string,
  displayId?: string,
  runName?: string,
): ChartSeriesData[] {
  return lines.map((s) => ({ ...s, metricName: logName, runId: displayId, runName }));
}

// Chart strategy helper — builds chart config from bucketed data
function buildChartStrategy(
  strategy: string,
  data: BucketedChartDataPoint[],
  logName: string,
  color: string,
  smoothingSettings: LineChartSettings["smoothing"],
  zoomData?: BucketedChartDataPoint[],
  runCreatedAt?: string,
  displayId?: string,
  runName?: string,
): ChartConfig {
  const strategies: Record<string, () => ChartConfig> = {
    Step: () => {
      // Use zoom data (re-bucketed for zoomed range) when available
      const sourceData = zoomData ?? data;

      return {
        lines: withMeta(bucketedAndSmooth(
          sourceData, logName, color, smoothingSettings,
        ), logName, displayId, runName),
        xlabel: "step",
        showLegend: true,
      };
    },
    "Absolute Time": () => {
      const getX = (d: BucketedChartDataPoint) => parseChTimeMs(d.time);

      return {
        lines: withMeta(bucketedAndSmooth(
          data, logName, color, smoothingSettings,
          false, undefined, undefined, getX,
        ), logName, displayId, runName),
        xlabel: "absolute time",
        isDateTime: true,
        showLegend: true,
      };
    },
    "Relative Time": () => {
      const baselineMs = getBaseline(parseChTimeMs(data[0].time), runCreatedAt);

      // Keep x-values in raw seconds — the axis formatter picks display units
      // dynamically based on the visible range. This ensures all relative time
      // charts share the same numeric scale and can sync zoom correctly.
      const getX = (d: BucketedChartDataPoint) =>
        (parseChTimeMs(d.time) - baselineMs) / 1000;

      // Use zoom data (re-bucketed for zoomed range) when available
      const sourceData = zoomData ?? data;

      return {
        lines: withMeta(bucketedAndSmooth(
          sourceData, logName, color, smoothingSettings,
          false, undefined, undefined, getX,
        ), logName, displayId, runName),
        xlabel: "relative time",
        showLegend: true,
      };
    },
    default: () => {
      return {
        lines: withMeta(bucketedAndSmooth(data, logName, color, smoothingSettings), logName, displayId, runName),
        xlabel: "step",
        showLegend: true,
      };
    },
  };

  return (strategies[strategy] || strategies.default)();
}

// Custom hook for chart configuration generation
function useChartConfig(
  data: BucketedChartDataPoint[] | undefined,
  logName: string,
  tenantId: string,
  projectName: string,
  runId: string,
  settings: LineChartSettings,
  zoomData?: BucketedChartDataPoint[],
  runCreatedAt?: string,
  runName?: string,
): [ChartConfig | null, boolean] {
  const [chartConfig, setChartConfig] = useState<ChartConfig | null>(null);
  const [isLoadingCustomChart, setIsLoadingCustomChart] = useState(false);
  const COLOR = "hsl(216, 66%, 60%)";

  useEffect(() => {
    if (!data || data.length === 0) {
      setChartConfig(null);
      return;
    }

    const generateChartConfig = async () => {
      // Check if this is a system chart
      const systemConfig = useSystemChartConfig(logName, data, runCreatedAt);
      if (systemConfig) {
        // Inject metadata and enable legend for system charts too
        systemConfig.lines = withMeta(systemConfig.lines, logName, runId, runName);
        systemConfig.showLegend = true;
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
            zoomData,
            runCreatedAt,
            runId,
            runName,
          ),
        );
        return;
      }

      // Custom selected log chart — need raw graph data for x-axis alignment
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
            buildChartStrategy("default", data, logName, COLOR, settings.smoothing, undefined, undefined, runId, runName),
          );
          return;
        }

        // Convert bucketed data to step/value for alignment, filtering out null values
        const yData = data
          .filter((d) => d.value != null)
          .map((d) => ({
            step: d.step,
            time: d.time,
            value: d.value as number,
          }));

        const { x, y } = alignAndUnzip(selectLogData, yData);

        if (x.length === 0 || y.length === 0) {
          setChartConfig(null);
          return;
        }

        const baseData = {
          x,
          y,
          label: logName,
          color: COLOR,
          metricName: logName,
          runId,
          runName,
        };

        setChartConfig({
          lines: withMeta(applySmoothing(baseData, settings.smoothing), logName, runId, runName),
          xlabel: selectedLog,
          showLegend: true,
        });
      } catch (error) {
        console.error("Error generating custom chart:", error);
        setChartConfig(
          buildChartStrategy("default", data, logName, COLOR, settings.smoothing, undefined, undefined, runId, runName),
        );
      } finally {
        setIsLoadingCustomChart(false);
      }
    };

    generateChartConfig();
  }, [data, logName, settings, tenantId, projectName, runId, zoomData, runCreatedAt, runName]);

  return [chartConfig, isLoadingCustomChart];
}

// Main component with refactored structure
export const LineChartWithFetch = memo(
  ({
    logName,
    tenantId,
    projectName,
    runId,
    boundsResetKey,
    runCreatedAt,
    runName,
  }: LineChartWithFetchProps) => {
    useCheckDatabaseSize(metricsCache);

    const { settings } = useLineSettings(tenantId, projectName, runId);

    const resolvedBuckets = useMemo(
      () => resolveChartBuckets(settings.chartResolution, settings.smoothing.enabled),
      [settings.chartResolution, settings.smoothing.enabled],
    );

    const { data, isLoading, isError } = useGetGraphProgressive(
      tenantId,
      projectName,
      runId,
      logName,
      resolvedBuckets,
    );

    // Register step<->time mapping for cross-axis zoom sync (single-run view)
    const chartSync = useChartSyncContext();
    useEffect(() => {
      if (!data || data.length === 0 || !chartSync) return;
      // Only register if no mapping exists yet (first chart to load wins)
      if (chartSync.stepTimeMappingRef.current) return;
      const sorted = [...data].sort((a, b) => a.step - b.step);
      const baselineMs = getBaseline(parseChTimeMs(sorted[0].time), runCreatedAt);
      const steps = sorted.map((d) => d.step);
      const relTimeSecs = sorted.map(
        (d) => (parseChTimeMs(d.time) - baselineMs) / 1000,
      );
      chartSync.setStepTimeMapping(steps, relTimeSecs);
    }, [data, runCreatedAt, chartSync]);

    // Build time→step mapping for zoom refetch on relative-time charts
    const timeStepMapping = useMemo(() => {
      const mapping = chartSync?.stepTimeMappingRef.current;
      if (!mapping) return null;
      const map = new Map<string, { relTimeSecs: number[]; steps: number[] }>();
      map.set(runId, mapping);
      return map;
    }, [chartSync?.stepTimeMappingRef.current, runId]);

    // Resolve synced zoom range for this chart's axis type.
    // In single-run view, cross-axis zoom sync is supported: a Step zoom should
    // trigger refetch for Relative Time charts (and vice versa) via the
    // step↔time mapping. Use same-group range directly, or cross-group
    // translated range when the mapping exists.
    const syncedZoomRange = useMemo(() => {
      const range = chartSync?.syncedZoomRange ?? null;
      const group = chartSync?.syncedZoomGroupRef?.current ?? null;
      const isRelativeTime = settings.selectedLog === "Relative Time";
      const myGroup = isRelativeTime ? "relative-time" : "step";

      // Same group: use directly
      if (range && group === myGroup) return range;

      // Cross-group: use translated range if available
      const cross = chartSync?.crossGroupZoomRef?.current;
      if (cross && cross.group === myGroup) return cross.range;

      return null;
    }, [chartSync?.syncedZoomRange, settings.selectedLog]);

    // Extract original step bounds from cross-axis zoom to skip lossy roundtrip
    const sourceStepRange = useMemo(() => {
      const cross = chartSync?.crossGroupZoomRef?.current;
      const isRelativeTime = settings.selectedLog === "Relative Time";
      if (isRelativeTime && cross?.group === "relative-time" && cross.sourceStepRange) {
        return cross.sourceStepRange;
      }
      return null;
    }, [chartSync?.syncedZoomRange, settings.selectedLog]);

    // Zoom-triggered server re-fetch using bucketed downsampling
    const runIdsMemo = useMemo(() => [runId], [runId]);
    const logNamesMemo = useMemo(() => [logName], [logName]);
    const { zoomDataMap, onZoomRangeChange, isZoomFetching } = useZoomRefetch({
      organizationId: tenantId,
      projectName,
      logNames: logNamesMemo,
      runIds: runIdsMemo,
      selectedLog: settings.selectedLog,
      syncedZoomRange,
      sourceStepRange,
      timeStepMapping,
      buckets: resolvedBuckets,
    });
    const zoomData = zoomDataMap?.get(zoomKey(runId, logName));

    const [chartConfig, isLoadingCustomChart] = useChartConfig(
      data,
      logName,
      tenantId,
      projectName,
      runId,
      settings,
      zoomData,
      runCreatedAt,
      runName,
    );

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
        boundsResetKey={boundsResetKey}
        renderChart={(yMin, yMax, onDataRange, onResetBounds, logXAxis, logYAxis, _yZoom, yZoomRange, onYZoomRangeChange) => {
          const commonProps = {
            className: "h-full",
            title: logName,
            logXAxis: logXAxis ?? settings.xAxisLogScale,
            logYAxis: logYAxis ?? settings.yAxisLogScale,
            tooltipInterpolation: settings.tooltipInterpolation,
            outlierDetection: settings.yAxisScaleMode === "outlier-aware",
            spanGaps: !settings.skipMissingValues,
            yZoomRange,
            onYZoomRangeChange,
          };

          return (
            <div className="relative h-full w-full">
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
                  showLegend={chartConfig.showLegend}
                  yMin={yMin}
                  yMax={yMax}
                  onDataRange={onDataRange}
                  onResetBounds={onResetBounds}
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
