"use client";

import { memo, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import LineChart from "@/components/charts/line";
import ReactECharts from "echarts-for-react";
import { ensureGetGraph, useGetGraph } from "../../~queries/get-graph";
import { useCheckDatabaseSize } from "@/lib/db/local-cache";
import { metricsCache } from "@/lib/db/index";
import { useLineSettings, type LineChartSettings } from "../use-line-settings";
import { smoothData } from "@/lib/math/smoothing";

export type MetricDataPoint = {
  step: number;
  time: string;
  value: number;
};

function alignAndUnzip(
  a: MetricDataPoint[],
  b: MetricDataPoint[],
): { x: number[]; y: number[] } {
  // 1. Build a map from step → value for series "a"
  const aMap = new Map<number, number>();
  for (const { step, value } of a) {
    aMap.set(step, value);
  }

  // 2. Walk series "b", pick only those points whose step exists in aMap
  const pairs: [number, number][] = [];
  let resMap = new Map<number, number>();
  for (const { step, value: bVal } of b) {
    const aVal = aMap.get(step);
    if (aVal !== undefined) {
      resMap.set(aVal, bVal);
    }
  }

  // 3. Sort by x values ascending
  const sortedPairs = Array.from(resMap.entries()).sort((a, b) => a[0] - b[0]);

  const x: number[] = [];
  const y: number[] = [];
  for (const [aVal, bVal] of sortedPairs) {
    x.push(aVal);
    y.push(bVal);
  }

  return { x, y };
}

interface LineChartWithFetchProps {
  logName: string;
  tenantId: string;
  projectName: string;
  runId: string;
  setChartRef: (index: number) => (ref: ReactECharts | null) => void;
  index: number;
  onLoad: () => void;
}

type ChartData = {
  x: number[];
  y: number[];
  label: string;
  color?: string;
  opacity?: number;
  hideFromLegend?: boolean;
};

type ChartConfig = {
  lines: ChartData[];
  xlabel: string;
  isDateTime?: boolean;
  showLegend?: boolean;
  isSystem?: boolean;
  title?: string;
};

// Custom hook to apply smoothing to chart data
function applySmoothing(
  chartData: ChartData,
  smoothingSettings: LineChartSettings["smoothing"],
): ChartData[] {
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
      label: chartData.label,
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

  return {
    lines: [
      {
        x: normalizedTimes,
        y: sortedData.map((d) => Number(d.value)),
        label: logName,
      },
    ],
    title: logName,
    isDateTime: false,
    xlabel: `relative time (${unit})`,
    isSystem: true,
  };
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

// Custom hook to handle chart strategy selection
function useChartStrategy(
  strategy: string,
  data: MetricDataPoint[],
  logName: string,
  color: string,
  smoothingSettings: LineChartSettings["smoothing"],
): ChartConfig {
  const strategies: Record<string, () => ChartConfig> = {
    Step: () => {
      const baseChartData: ChartData = {
        x: data.map((d) => Number(d.step)),
        y: data.map((d) => Number(d.value)),
        label: logName,
        color,
      };

      return {
        lines: applySmoothing(baseChartData, smoothingSettings),
        xlabel: "step",
      };
    },
    "Absolute Time": () => {
      const baseChartData: ChartData = {
        x: data.map((d) => new Date(d.time).getTime()),
        y: data.map((d) => Number(d.value)),
        label: logName,
        color,
      };

      return {
        lines: applySmoothing(baseChartData, smoothingSettings),
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

      const baseChartData: ChartData = {
        x: normalizedTimes,
        y: data.map((d) => Number(d.value)),
        label: logName,
        color,
      };

      return {
        lines: applySmoothing(baseChartData, smoothingSettings),
        xlabel: `relative time (${unit})`,
        showLegend: smoothingSettings.enabled,
      };
    },
    default: () => {
      const baseChartData: ChartData = {
        x: data.map((d) => Number(d.step)),
        y: data.map((d) => Number(d.value)),
        label: logName,
        color,
      };

      return {
        lines: applySmoothing(baseChartData, smoothingSettings),
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
      const systemConfig = useSystemChartConfig(logName, data);
      if (systemConfig) {
        setChartConfig(systemConfig);
        return;
      }

      // Standard chart strategy
      const selectedLog = settings.selectedLog;

      if (["Step", "Absolute Time", "Relative Time"].includes(selectedLog)) {
        setChartConfig(
          useChartStrategy(
            selectedLog,
            data,
            logName,
            COLOR,
            settings.smoothing,
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
            useChartStrategy(
              "default",
              data,
              logName,
              COLOR,
              settings.smoothing,
            ),
          );
          return;
        }

        const { x, y } = alignAndUnzip(selectLogData, data);

        if (x.length === 0 || y.length === 0) {
          console.log("No matching data points found, fall back to default");
          // No matching data points found, fall back to default
          setChartConfig(null);
          return;
        }

        const baseChartData: ChartData = {
          x,
          y,
          label: logName,
          color: COLOR,
        };

        setChartConfig({
          lines: applySmoothing(baseChartData, settings.smoothing),
          xlabel: selectedLog,
          showLegend: settings.smoothing.enabled,
        });
      } catch (error) {
        console.error("Error generating custom chart:", error);
        setChartConfig(
          useChartStrategy("default", data, logName, COLOR, settings.smoothing),
        );
      } finally {
        setIsLoadingCustomChart(false);
      }
    };

    generateChartConfig();
  }, [data, logName, settings, tenantId, projectName, runId]);

  return [chartConfig, isLoadingCustomChart];
}

// Main component with refactored structure
export const LineChartWithFetch = memo(
  ({
    logName,
    tenantId,
    projectName,
    runId,
    setChartRef,
    index,
    onLoad,
  }: LineChartWithFetchProps) => {
    useCheckDatabaseSize(metricsCache);

    const { data, isLoading, isError } = useGetGraph(
      tenantId,
      projectName,
      runId,
      logName,
    );

    const { settings } = useLineSettings(tenantId, projectName, runId);

    const [chartConfig, isLoadingCustomChart] = useChartConfig(
      data,
      logName,
      tenantId,
      projectName,
      runId,
      settings,
    );

    // Notify the parent when new data loads
    useEffect(() => {
      if (data) {
        onLoad();
      }
    }, [data, onLoad]);

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

    // Render empty state
    if (!data || data.length === 0) {
      return (
        <div className="flex h-full flex-grow flex-col items-center justify-center bg-accent">
          <h2 className="text-2xl font-bold">{logName}</h2>
          <p className="text-sm text-gray-500">No data received yet</p>
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

    // Common props for charts
    const commonProps = {
      className: "h-full",
      title: logName,
      ref: setChartRef(index),
      logXAxis: settings.xAxisLogScale,
      logYAxis: settings.yAxisLogScale,
    };

    // Render appropriate chart based on configuration
    return chartConfig.isSystem ? (
      <LineChart
        lines={chartConfig.lines}
        title={chartConfig.title}
        isDateTime={chartConfig.isDateTime}
        xlabel={chartConfig.xlabel}
        ref={setChartRef(index)}
      />
    ) : (
      <LineChart
        {...commonProps}
        lines={chartConfig.lines}
        xlabel={chartConfig.xlabel}
        isDateTime={chartConfig.isDateTime}
        showLegend={chartConfig.showLegend}
      />
    );
  },
);
