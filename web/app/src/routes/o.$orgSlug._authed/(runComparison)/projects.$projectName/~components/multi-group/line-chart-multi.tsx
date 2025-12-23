"use client";

import { default as LineChart } from "@/components/charts/line";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import ReactECharts from "echarts-for-react";
import { memo, useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { trpc, trpcClient } from "@/utils/trpc";
import { useCheckDatabaseSize } from "@/lib/db/local-cache";
import { metricsCache, type MetricDataPoint } from "@/lib/db/index";
import { useLocalQueries } from "@/lib/hooks/use-local-query";
import {
  useLineSettings,
  type SmoothingAlgorithm,
} from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/use-line-settings";
import { smoothData } from "@/lib/math/smoothing";

const SYNC_REFRESH_INTERVAL = 5 * 1000; // 5 seconds
const GC_TIME = 0; // Immediate garbage collection when query is inactive

interface MultiLineChartProps {
  lines: {
    runId: string;
    runName: string;
    color: string;
  }[];
  title: string;
  xlabel: string;
  ref: (ref: ReactECharts | null) => void;
  onLoad: () => void;
  organizationId: string;
  projectName: string;
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
    ref,
    onLoad,
    organizationId,
    projectName,
  }: MultiLineChartProps) => {
    useCheckDatabaseSize(metricsCache);

    // Use global chart settings with runId="full"
    const { settings } = useLineSettings(organizationId, projectName, "full");

    // Track loading state for custom chart data
    const [isLoadingCustomChart, setIsLoadingCustomChart] = useState(false);

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
          staleTime: SYNC_REFRESH_INTERVAL,
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
              staleTime: SYNC_REFRESH_INTERVAL,
              gcTime: GC_TIME,
              localCache: metricsCache,
              enabled: true,
            };
          })
        : [],
    );

    // Check error states and get data
    const isError = queries.some((query) => query.isError);
    const allData = queries
      .map((query, index) => ({
        data: (query.data ?? []) as MetricDataPoint[],
        isLoading: query.isLoading,
        runInfo: lines[index],
      }))
      .filter((item) => item.data.length > 0);

    // Also get custom log data if applicable
    const customLogData = customLogQueries.map((query, index) => ({
      data: (query.data ?? []) as MetricDataPoint[],
      runId: lines[index]?.runId,
    }));

    // Notify parent when all data loads
    useEffect(() => {
      if (queries.every((query) => query.data !== undefined)) {
        onLoad();
      }
    }, [queries, onLoad]);

    // Error state
    if (isError) {
      return (
        <div className="flex h-full w-full flex-grow flex-col items-center justify-center bg-red-500">
          <h2 className="text-2xl font-bold">{title}</h2>
          <p className="text-sm text-gray-200">Error fetching data</p>
        </div>
      );
    }

    const hasAnyData = allData.some((item) => item.data?.length > 0);
    const allQueriesDone = queries.every((query) => !query.isLoading);

    // We're also loading if we're fetching custom log data
    const isLoadingCustomLogData =
      customLogQueries.length > 0 &&
      !customLogQueries.every((q) => q.data !== undefined);

    const isInitialLoading =
      !hasAnyData && (!allQueriesDone || isLoadingCustomLogData);

    // Initial loading state - only show when we have no data and queries are still loading
    if (isInitialLoading) {
      return <Skeleton className="h-full w-full flex-grow" />;
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
            color: runInfo.color,
          };

          return applySmoothing(baseData, settings.smoothing);
        });

      return (
        <LineChart
          lines={chartData}
          className="h-full min-h-96 w-full flex-grow"
          title={title}
          xlabel={`relative time (${unit})`}
          ref={ref}
          showLegend={true}
          isDateTime={false}
          logXAxis={settings.xAxisLogScale}
          logYAxis={settings.yAxisLogScale}
        />
      );
    }

    // Prepare chart data based on selected strategy
    let chartDataWithStrategy;

    // Handle different chart types based on settings
    switch (settings.selectedLog) {
      case "Absolute Time":
        chartDataWithStrategy = allData
          .filter((item) => item.data.length > 0)
          .flatMap(({ data, runInfo }) => {
            const baseData = {
              x: data.map((d: MetricDataPoint) => new Date(d.time).getTime()),
              y: data.map((d: MetricDataPoint) => Number(d.value)),
              label: runInfo.runName,
              color: runInfo.color,
            };
            return applySmoothing(baseData, settings.smoothing);
          });

        return (
          <LineChart
            lines={chartDataWithStrategy}
            className="h-full w-full"
            title={title}
            xlabel="absolute time"
            ref={ref}
            showLegend={true}
            isDateTime={true}
            logXAxis={settings.xAxisLogScale}
            logYAxis={settings.yAxisLogScale}
          />
        );

      case "Relative Time":
        chartDataWithStrategy = allData
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
              color: runInfo.color,
            };

            return applySmoothing(baseData, settings.smoothing);
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

        return (
          <LineChart
            lines={chartDataWithStrategy}
            className="h-full w-full"
            title={title}
            xlabel={`relative time (${unit})`}
            ref={ref}
            showLegend={true}
            logXAxis={settings.xAxisLogScale}
            logYAxis={settings.yAxisLogScale}
          />
        );

      case "Step":
        // Default step-based chart
        chartDataWithStrategy = allData
          .filter((item) => item.data.length > 0)
          .flatMap(({ data, runInfo }) => {
            const baseData = {
              x: data.map((d: MetricDataPoint) => Number(d.step)),
              y: data.map((d: MetricDataPoint) => Number(d.value)),
              label: runInfo.runName,
              color: runInfo.color,
            };
            return applySmoothing(baseData, settings.smoothing);
          });

        return (
          <LineChart
            lines={chartDataWithStrategy}
            className="h-full w-full"
            title={title}
            xlabel={xlabel}
            ref={ref}
            showLegend={true}
            logXAxis={settings.xAxisLogScale}
            logYAxis={settings.yAxisLogScale}
          />
        );

      default:
        // Custom selected log chart - use the selected log for x-axis values
        if (customLogData.length === 0) {
          // No custom data, show message that we can't compare
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

        // Create chart data from valid comparisons
        chartDataWithStrategy = validChartData
          .filter((item) => item.alignedData !== null)
          .flatMap(({ runInfo, alignedData }) => {
            const baseData = {
              x: alignedData!.x,
              y: alignedData!.y,
              label: runInfo.runName,
              color: runInfo.color,
            };
            return applySmoothing(baseData, settings.smoothing);
          });

        return (
          <LineChart
            lines={chartDataWithStrategy}
            className="h-full w-full"
            title={title}
            xlabel={settings.selectedLog}
            ref={ref}
            showLegend={true}
            logXAxis={settings.xAxisLogScale}
            logYAxis={settings.yAxisLogScale}
          />
        );
    }
  },
);
