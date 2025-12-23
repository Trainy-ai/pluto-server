"use client";

import { DropdownRegion } from "@/components/core/runs/dropdown-region/dropdown-region";
import { MultiLineChart } from "./line-chart-multi";
import { MultiGroupAudio } from "./audio";
import { MultiGroupImage } from "./image";
import { MultiGroupVideo } from "./video";
import { MultiHistogramView } from "./histogram-view";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMemo, useState, useCallback, memo } from "react";
import { useChartSync } from "@/components/charts/hooks/use-chart-sync";
import ReactECharts from "echarts-for-react";
import { cn } from "@/lib/utils";
import type { RunLogType } from "@/lib/grouping/types";
import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";

interface MultiGroupProps {
  title: string;
  groupId: string;
  metrics: {
    name: string;
    type: RunLogType;
    data: {
      runId: string;
      runName: string;
      color: string;
    }[];
  }[];
  className?: string;
  organizationId: string;
  projectName: string;
}

// Constants for responsive design
const CHART_HEIGHTS = {
  sm: "h-[300px]",
  md: "h-[400px]",
  lg: "h-[500px]",
};

/**
 * Displays a group of metrics with various visualization components
 * based on the metric type (line chart, histogram, audio, or image)
 */
export const MultiGroup = ({
  title,
  groupId,
  metrics,
  className,
  organizationId,
  projectName,
}: MultiGroupProps) => {
  const [loadedCharts, setLoadedCharts] = useState<number>(0);
  const { setChartRef } = useChartSync(groupId, loadedCharts);

  const handleChartLoad = useCallback(() => {
    setLoadedCharts((prev: number) => prev + 1);
  }, []);

  const components = useMemo(
    () =>
      metrics.map((metric, index) => {
        if (metric.type === "METRIC") {
          const lines = metric.data.map((line) => ({
            runId: line.runId,
            runName: line.runName,
            color: line.color,
          }));

          return (
            <MultiLineChart
              lines={lines}
              title={metric.name}
              xlabel="step"
              ref={setChartRef(index)}
              onLoad={handleChartLoad}
              organizationId={organizationId}
              projectName={projectName}
            />
          );
        }

        if (metric.type === "HISTOGRAM") {
          return (
            <MultiHistogramView
              logName={metric.name}
              tenantId={organizationId}
              projectName={projectName}
              runs={metric.data}
            />
          );
        }

        if (metric.type === "AUDIO") {
          return (
            <MultiGroupAudio
              logName={metric.name}
              organizationId={organizationId}
              projectName={projectName}
              runs={metric.data}
              className="h-full"
            />
          );
        }

        if (metric.type === "IMAGE") {
          return (
            <MultiGroupImage
              logName={metric.name}
              organizationId={organizationId}
              projectName={projectName}
              runs={metric.data}
              className="h-full"
            />
          );
        }

        if (metric.type === "VIDEO") {
          return (
            <MultiGroupVideo
              logName={metric.name}
              organizationId={organizationId}
              projectName={projectName}
              runs={metric.data}
              className="h-full"
            />
          );
        }

        return null;
      }),
    [
      metrics,
      setChartRef,
      handleChartLoad,
      className,
      organizationId,
      projectName,
    ],
  );

  return (
    <DropdownRegion title={title} components={components} groupId={groupId} />
  );
};

// Memoized version of MultiGroup to prevent unnecessary re-renders
export const MemoizedMultiGroup = memo(MultiGroup);
