"use client";

import { default as LineChart } from "@/components/charts/line";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import ReactECharts from "echarts-for-react";
import { memo, useEffect } from "react";
import { useQueries } from "@tanstack/react-query";
import { trpc, trpcClient } from "@/utils/trpc";
import { useCheckDatabaseSize } from "@/lib/db/local-cache";
import { metricsCache, type MetricDataPoint } from "@/lib/db/index";
import { useLocalQueries } from "@/lib/hooks/use-local-query";
import { BYTES_LOGS } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/group/line-chart";

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

    // Check error states and get data
    const isError = queries.some((query) => query.isError);
    const allData = queries.map((query, index) => ({
      data: (query.data ?? []) as MetricDataPoint[],
      isLoading: query.isLoading,
      runInfo: lines[index],
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
    const isInitialLoading = !hasAnyData && !allQueriesDone;

    // Initial loading state - only show when we have no data and queries are still loading
    if (isInitialLoading) {
      return <Skeleton className="h-full w-full flex-grow" />;
    }

    // Empty state - only if we have no data and all queries are done loading
    if (allQueriesDone && !hasAnyData) {
      return (
        <div className="h-full w-full flex-grow">
          <div className="flex h-full w-full flex-col items-center justify-center bg-accent">
            <h2 className="text-2xl font-bold">{title}</h2>
            <p className="text-sm text-gray-500">No data received yet</p>
          </div>
        </div>
      );
    }

    if (title.startsWith("sys/") || title.startsWith("_sys/")) {
      const chartData = allData
        .filter((item) => item.data.length > 0)
        .map(({ data, runInfo }) => {
          const sortedData = [...data].sort(
            (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
          );
          return {
            x: sortedData.map((d: MetricDataPoint) =>
              new Date(d.time + "Z").getTime(),
            ),
            y: sortedData.map((d: MetricDataPoint) => Number(d.value)),
            label: runInfo.runName,
            color: runInfo.color,
          };
        });

      const isBytesLog = BYTES_LOGS.some((bytesLog) =>
        title.includes(bytesLog),
      );

      return (
        <LineChart
          lines={chartData}
          className="h-full min-h-96 w-full flex-grow"
          title={title}
          xlabel={"time"}
          ref={ref}
          showLegend={true}
          isDateTime={true}
          isBytes={isBytesLog}
        />
      );
    }

    // Prepare chart data - only include lines that have data
    const chartData = allData
      .filter((item) => item.data.length > 0)
      .map(({ data, runInfo }) => ({
        x: data.map((d: MetricDataPoint) => Number(d.step)),
        y: data.map((d: MetricDataPoint) => Number(d.value)),
        label: runInfo.runName,
        color: runInfo.color,
      }));

    // Render chart as long as we have any data
    return (
      <LineChart
        lines={chartData}
        className="h-full w-full"
        title={title}
        xlabel={xlabel}
        ref={ref}
        showLegend={true}
      />
    );
  },
);
