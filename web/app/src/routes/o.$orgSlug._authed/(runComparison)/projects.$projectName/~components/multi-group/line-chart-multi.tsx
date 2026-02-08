"use client";

import { default as LineChart } from "@/components/charts/line-wrapper";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { memo, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { trpc, trpcClient } from "@/utils/trpc";
import { useCheckDatabaseSize } from "@/lib/db/local-cache";
import { metricsCache, type MetricDataPoint } from "@/lib/db/index";
import { useLocalQueries } from "@/lib/hooks/use-local-query";
import {
  useLineSettings,
  type SmoothingAlgorithm,
} from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/use-line-settings";
import { smoothData, downsampleLTTB } from "@/lib/math/smoothing";

// For active runs, refresh every 30 seconds
// For completed runs, data never changes so use Infinity
const ACTIVE_RUN_STALE_TIME = 30 * 1000; // 30 seconds
const COMPLETED_RUN_STALE_TIME = Infinity; // Never refetch completed runs
const GC_TIME = 0; // Immediate garbage collection when query is inactive

interface MultiLineChartProps {
  lines: {
    runId: string;
    runName: string;
    color: string;
  }[];
  title: string;
  xlabel: string;
  organizationId: string;
  projectName: string;
  /** When true, all runs are in a terminal state and data won't change */
  allRunsCompleted?: boolean;
}

// Helper to determine appropriate time unit based on max seconds
function getTimeUnitForDisplay(maxSeconds: number): {
  divisor: number;
  unit: string;
} {
  if (maxSeconds < 120) {
    return { divisor: 1, unit: "s" }; // seconds
  } else if (maxSeconds < 3600) {
    return { divisor: 60, unit: "min" }; // minutes
  } else if (maxSeconds < 86400) {
    return { divisor: 3600, unit: "hr" }; // hours
  } else if (maxSeconds < 604800) {
    return { divisor: 86400, unit: "day" }; // days
  } else if (maxSeconds < 2629746) {
    return { divisor: 604800, unit: "week" }; // weeks
  } else if (maxSeconds < 31556952) {
    return { divisor: 2629746, unit: "month" }; // months (approx)
  } else {
    return { divisor: 31556952, unit: "year" }; // years (approx)
  }
}

// Apply downsampling to reduce data points
function applyDownsampling(
  chartData: {
    x: number[];
    y: number[];
    label: string;
    color: string;
  },
  maxPoints: number,
): {
  x: number[];
  y: number[];
  label: string;
  color: string;
} {
  if (maxPoints <= 0 || chartData.x.length <= maxPoints) {
    return chartData;
  }

  const { x, y } = downsampleLTTB(chartData.x, chartData.y, maxPoints);
  return { ...chartData, x, y };
}

// Apply smoothing to chart data
function applySmoothing(
  chartData: {
    x: number[];
    y: number[];
    label: string;
    color: string;
  },
  smoothingSettings: {
    enabled: boolean;
    algorithm: SmoothingAlgorithm;
    parameter: number;
    showOriginalData: boolean;
  },
): {
  x: number[];
  y: number[];
  label: string;
  color: string;
  opacity?: number;
  hideFromLegend?: boolean;
}[] {
  if (!smoothingSettings.enabled) {
    return [chartData];
  }

  const data = [
    {
      ...chartData,
      y: smoothData(
        chartData.x,
        chartData.y,
        smoothingSettings.algorithm,
        smoothingSettings.parameter,
      ),
      opacity: 1,
      hideFromLegend: false,
    },
  ];

  if (smoothingSettings.showOriginalData) {
    data.push({
      ...chartData,
      opacity: 0.1,
      hideFromLegend: true,
      label: chartData.label + " (original)",
    });
  }

  return data;
}

// Helper function to align and unzip data points
function alignAndUnzip(
  xData: MetricDataPoint[],
  yData: MetricDataPoint[],
): { x: number[]; y: number[] } {
  // Build a map from step → value for x data
  const xMap = new Map<number, number>();
  for (const { step, value } of xData) {
    xMap.set(Number(step), Number(value));
  }

  // Walk y data, pick only matching steps
  const pairs: [number, number][] = [];
  for (const { step, value: yVal } of yData) {
    const xVal = xMap.get(Number(step));
    if (xVal !== undefined) {
      pairs.push([xVal, Number(yVal)]);
    }
  }

  // Sort by x values ascending
  const sortedPairs = pairs.sort((a, b) => a[0] - b[0]);

  const x: number[] = [];
  const y: number[] = [];
  for (const [xVal, yVal] of sortedPairs) {
    x.push(xVal);
    y.push(yVal);
  }

  return { x, y };
}

export const MultiLineChart = memo(
  ({
    lines,
    title,
    xlabel,
    organizationId,
    projectName,
    allRunsCompleted = false,
  }: MultiLineChartProps) => {
    useCheckDatabaseSize(metricsCache);

    // Use global chart settings with runId="full"
    const { settings } = useLineSettings(organizationId, projectName, "full");

    // Use Infinity staleTime for completed runs since their data won't change
    const staleTime = allRunsCompleted ? COMPLETED_RUN_STALE_TIME : ACTIVE_RUN_STALE_TIME;

    // Fetch data for all lines in parallel with optimized settings for quick cancellation
    const queries = useLocalQueries<MetricDataPoint>(
      lines.map((line) => {
        const opts = {
          organizationId,
          projectName,
          runId: line.runId,
          logName: title,
        };

        const queryOptions = trpc.runs.data.graph.queryOptions(opts);

        return {
          queryKey: queryOptions.queryKey,
          queryFn: () => trpcClient.runs.data.graph.query(opts),
          staleTime,
          gcTime: GC_TIME,
          localCache: metricsCache,
          enabled: true,
        };
      }),
    );

    // If the selected log is not a standard one, fetch that data for each run
    // to use as x-axis values
    const customLogQueries = useLocalQueries<MetricDataPoint>(
      settings.selectedLog !== "Step" &&
        settings.selectedLog !== "Absolute Time" &&
        settings.selectedLog !== "Relative Time"
        ? lines.map((line) => {
            const opts = {
              organizationId,
              projectName,
              runId: line.runId,
              logName: settings.selectedLog,
            };

            const queryOptions = trpc.runs.data.graph.queryOptions(opts);

            return {
              queryKey: queryOptions.queryKey,
              queryFn: () => trpcClient.runs.data.graph.query(opts),
              staleTime,
              gcTime: GC_TIME,
              localCache: metricsCache,
              enabled: true,
            };
          })
        : [],
    );

    // Check error states and get data
    const isError = queries.some((query) => query.isError);

    // Memoize allData to prevent chart recreations on every render
    const allData = useMemo(() => {
      return queries
        .map((query, index) => ({
          data: (query.data ?? []) as MetricDataPoint[],
          isLoading: query.isLoading,
          runInfo: lines[index],
        }))
        .filter((item) => item.data.length > 0);
    }, [queries, lines]);

    // Also get custom log data if applicable - memoized
    const customLogData = useMemo(() => {
      return customLogQueries.map((query, index) => ({
        data: (query.data ?? []) as MetricDataPoint[],
        runId: lines[index]?.runId,
      }));
    }, [customLogQueries, lines]);

    const hasAnyData = allData.some((item) => item.data?.length > 0);
    const allQueriesDone = queries.every((query) => !query.isLoading);

    // We're also loading if we're fetching custom log data
    const isLoadingCustomLogData =
      customLogQueries.length > 0 &&
      !customLogQueries.every((q) => q.data !== undefined);

    const isInitialLoading =
      !hasAnyData && (!allQueriesDone || isLoadingCustomLogData);

    // Memoize all chart data computations to prevent chart recreation on every render
    // IMPORTANT: This useMemo must be called BEFORE any early returns to maintain hook order
    const chartResult = useMemo(() => {
      // Return null for loading/empty states - will be handled by early returns below
      if (!hasAnyData) {
        return null;
      }
      // System metrics chart - always uses relative time like in line-chart.tsx
      if (title.startsWith("sys/") || title.startsWith("_sys/")) {
        // Calculate the appropriate time unit across all datasets
        let unit = "s";
        let divisor = 1;
        if (allData.length > 0 && allData[0].data.length > 0) {
          // For each run, find the max time span
          const timeSpans = allData.map(({ data }) => {
            if (data.length < 2) return 0;
            const sortedData = [...data].sort(
              (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
            );
            const firstTime = new Date(sortedData[0].time).getTime();
            const lastTime = new Date(
              sortedData[sortedData.length - 1].time,
            ).getTime();
            return (lastTime - firstTime) / 1000; // time span in seconds
          });

          // Use the largest time span to determine the unit
          const maxTimeSpan = Math.max(...timeSpans);
          const timeUnit = getTimeUnitForDisplay(maxTimeSpan);
          unit = timeUnit.unit;
          divisor = timeUnit.divisor;
        }

        const chartData = allData
          .filter((item) => item.data.length > 0)
          .flatMap(({ data, runInfo }) => {
            const sortedData = [...data].sort(
              (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
            );

            // Calculate all time differences in seconds from the first data point
            const relativeTimes = sortedData.map(
              (d) =>
                (new Date(d.time).getTime() -
                  new Date(sortedData[0].time).getTime()) /
                1000,
            );

            // Convert all values to the selected unit using the consistent divisor
            const normalizedTimes = relativeTimes.map(
              (seconds) => seconds / divisor,
            );

            const baseData = {
              x: normalizedTimes,
              y: sortedData.map((d: MetricDataPoint) => Number(d.value)),
              label: runInfo.runName,
              seriesId: runInfo.runId,
              color: runInfo.color,
            };

            const downsampledData = applyDownsampling(baseData, settings.maxPointsPerSeries);
            return applySmoothing(downsampledData, settings.smoothing);
          });

        return {
          type: "system" as const,
          data: chartData,
          xlabel: `relative time (${unit})`,
          isDateTime: false,
          className: "h-full min-h-96 w-full flex-grow",
        };
      }

      // Handle different chart types based on settings
      switch (settings.selectedLog) {
        case "Absolute Time": {
          const data = allData
            .filter((item) => item.data.length > 0)
            .flatMap(({ data, runInfo }) => {
              const baseData = {
                x: data.map((d: MetricDataPoint) => new Date(d.time).getTime()),
                y: data.map((d: MetricDataPoint) => Number(d.value)),
                label: runInfo.runName,
                seriesId: runInfo.runId,
                color: runInfo.color,
              };
              const downsampledData = applyDownsampling(baseData, settings.maxPointsPerSeries);
              return applySmoothing(downsampledData, settings.smoothing);
            });

          return {
            type: "data" as const,
            data,
            xlabel: "absolute time",
            isDateTime: true,
            className: "h-full w-full",
          };
        }

        case "Relative Time": {
          const data = allData
            .filter((item) => item.data.length > 0)
            .flatMap(({ data, runInfo }) => {
              // Calculate relative times in seconds from first data point
              const firstTime = new Date(data[0].time).getTime();
              const relativeTimes = data.map(
                (d) => (new Date(d.time).getTime() - firstTime) / 1000,
              );

              // Determine appropriate time unit
              const maxSeconds = Math.max(...relativeTimes);
              const { divisor, unit } = getTimeUnitForDisplay(maxSeconds);

              // Convert to appropriate unit
              const normalizedTimes = relativeTimes.map(
                (seconds) => seconds / divisor,
              );

              const baseData = {
                x: normalizedTimes,
                y: data.map((d: MetricDataPoint) => Number(d.value)),
                label: runInfo.runName,
                seriesId: runInfo.runId,
                color: runInfo.color,
              };

              const downsampledData = applyDownsampling(baseData, settings.maxPointsPerSeries);
              return applySmoothing(downsampledData, settings.smoothing);
            });

          // Determine time unit from the first dataset
          const firstDataset = allData[0]?.data || [];
          const firstTime =
            firstDataset.length > 0
              ? new Date(firstDataset[0].time).getTime()
              : 0;
          const lastTime =
            firstDataset.length > 0
              ? new Date(firstDataset[firstDataset.length - 1].time).getTime()
              : 0;
          const maxSeconds = (lastTime - firstTime) / 1000;
          const { unit } = getTimeUnitForDisplay(maxSeconds);

          return {
            type: "data" as const,
            data,
            xlabel: `relative time (${unit})`,
            isDateTime: false,
            className: "h-full w-full",
          };
        }

        case "Step": {
          // Default step-based chart
          const data = allData
            .filter((item) => item.data.length > 0)
            .flatMap(({ data, runInfo }) => {
              const baseData = {
                x: data.map((d: MetricDataPoint) => Number(d.step)),
                y: data.map((d: MetricDataPoint) => Number(d.value)),
                label: runInfo.runName,
                seriesId: runInfo.runId,
                color: runInfo.color,
              };
              const downsampledData = applyDownsampling(baseData, settings.maxPointsPerSeries);
              return applySmoothing(downsampledData, settings.smoothing);
            });

          return {
            type: "data" as const,
            data,
            xlabel,
            isDateTime: false,
            className: "h-full w-full",
          };
        }

        default: {
          // Custom selected log chart - use the selected log for x-axis values
          if (customLogData.length === 0) {
            return {
              type: "error" as const,
              errorType: "no-custom-data" as const,
            };
          }

          // Match up x values (selected log) with y values (current log)
          const validChartData: {
            runInfo: { runId: string; runName: string; color: string };
            alignedData: { x: number[]; y: number[] } | null;
          }[] = allData
            .filter((item) => item.data.length > 0)
            .map(({ data, runInfo }) => {
              // Find matching custom log data for this run
              const matchingXData = customLogData.find(
                (d) => d.runId === runInfo.runId,
              )?.data;

              if (!matchingXData || matchingXData.length === 0) {
                return { runInfo, alignedData: null };
              }

              // Align and unzip x and y data
              const alignedData = alignAndUnzip(matchingXData, data);

              if (alignedData.x.length === 0 || alignedData.y.length === 0) {
                return { runInfo, alignedData: null };
              }

              return { runInfo, alignedData };
            });

          // Check if we have any valid data to show
          const hasValidData = validChartData.some(
            (item) => item.alignedData !== null,
          );

          if (!hasValidData) {
            return {
              type: "error" as const,
              errorType: "no-valid-data" as const,
            };
          }

          // Create chart data from valid comparisons
          const data = validChartData
            .filter((item) => item.alignedData !== null)
            .flatMap(({ runInfo, alignedData }) => {
              const baseData = {
                x: alignedData!.x,
                y: alignedData!.y,
                label: runInfo.runName,
                seriesId: runInfo.runId,
                color: runInfo.color,
              };
              const downsampledData = applyDownsampling(baseData, settings.maxPointsPerSeries);
              return applySmoothing(downsampledData, settings.smoothing);
            });

          return {
            type: "data" as const,
            data,
            xlabel: settings.selectedLog,
            isDateTime: false,
            className: "h-full w-full",
          };
        }
      }
    }, [allData, customLogData, settings, title, xlabel, hasAnyData]);

    // Error state
    if (isError) {
      return (
        <div className="flex h-full w-full flex-grow flex-col items-center justify-center bg-red-500">
          <h2 className="text-2xl font-bold">{title}</h2>
          <p className="text-sm text-gray-200">Error fetching data</p>
        </div>
      );
    }

    // Initial loading state - show metric title and series names while loading
    if (isInitialLoading) {
      return (
        <div className="relative flex h-full w-full flex-grow flex-col bg-accent/50">
          {/* Title */}
          <div className="p-3 text-center">
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          </div>
          {/* Series/run names being loaded */}
          <div className="flex-1 overflow-hidden px-4 pb-4">
            <div className="flex flex-wrap gap-2">
              {lines.slice(0, 10).map((line) => (
                <div
                  key={line.runId}
                  className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 text-xs"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: line.color }}
                  />
                  <span className="max-w-[120px] truncate text-muted-foreground">
                    {line.runName}
                  </span>
                </div>
              ))}
              {lines.length > 10 && (
                <div className="rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
                  +{lines.length - 10} more
                </div>
              )}
            </div>
          </div>
          {/* Loading spinner overlay */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
          </div>
        </div>
      );
    }

    // Empty state - only if we have no data and all queries are done loading
    if (allQueriesDone && !hasAnyData) {
      return (
        <div className="flex h-full w-full flex-grow flex-col items-center justify-center bg-accent">
          <h2 className="text-2xl font-bold">{title}</h2>
          <p className="text-sm text-gray-500">No data received yet</p>
        </div>
      );
    }

    // Handle error cases from chart data computation
    if (!chartResult || chartResult.type === "error") {
      return (
        <div className="flex h-full flex-grow flex-col items-center justify-center bg-accent p-4">
          <p className="text-center text-sm text-gray-500">
            Could not compare{" "}
            <code className="rounded bg-muted px-1">{title}</code> with{" "}
            <code className="rounded bg-muted px-1">
              {settings.selectedLog}
            </code>
          </p>
        </div>
      );
    }

    // Render the chart with memoized data
    return (
      <LineChart
        lines={chartResult.data}
        className={chartResult.className}
        title={title}
        xlabel={chartResult.xlabel}
        showLegend={true}
        isDateTime={chartResult.isDateTime}
        logXAxis={settings.xAxisLogScale}
        logYAxis={settings.yAxisLogScale}
      />
    );
  },
);
