"use client";

import { DropdownRegion } from "@/components/core/runs/dropdown-region/dropdown-region";
import { MultiLineChart } from "./line-chart-multi";
import { MultiGroupAudio } from "./audio";
import { MultiGroupImage } from "./image";
import { MultiGroupVideo } from "./video";
import { MultiHistogramView } from "./histogram-view";
import { ChartCardWrapper } from "./chart-card-wrapper";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMemo, useCallback, memo } from "react";
import { cn } from "@/lib/utils";
import type { RunLogType, RunStatus } from "@/lib/grouping/types";
import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import { arePropsEqual } from "./props-comparison";

// Re-export for backwards compatibility
export { arePropsEqual } from "./props-comparison";

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
      status: RunStatus;
    }[];
  }[];
  className?: string;
  organizationId: string;
  projectName: string;
  /** Incrementing this key forces all charts to re-read bounds from localStorage */
  boundsResetKey?: number;
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
  boundsResetKey,
}: MultiGroupProps) => {
  // Memoize lines arrays for each metric to prevent recreation
  const memoizedLines = useMemo(() => {
    return metrics.map((metric) => {
      if (metric.type !== "METRIC") return null;
      return metric.data.map((line) => ({
        runId: line.runId,
        runName: line.runName,
        color: line.color,
      }));
    });
  }, [metrics]);

  // Return render functions instead of elements for lazy evaluation
  // Components are only created when DropdownRegion calls the render function
  const components = useMemo(
    () =>
      metrics.map((metric, index) => {
        if (metric.type === "METRIC") {
          const lines = memoizedLines[index];
          if (!lines) return () => null;

          // Check if all runs are in a terminal state (not actively running)
          const allRunsCompleted = metric.data.every(
            (line) => line.status !== "RUNNING"
          );

          return () => (
            <ChartCardWrapper
              metricName={metric.name}
              groupId={groupId}
              boundsResetKey={boundsResetKey}
              renderChart={(yMin, yMax, onDataRange, onResetBounds) => (
                <MultiLineChart
                  lines={lines}
                  title={metric.name}
                  xlabel="step"
                  organizationId={organizationId}
                  projectName={projectName}
                  allRunsCompleted={allRunsCompleted}
                  yMin={yMin}
                  yMax={yMax}
                  onDataRange={onDataRange}
                  onResetBounds={onResetBounds}
                />
              )}
            />
          );
        }

        if (metric.type === "HISTOGRAM") {
          return () => (
            <MultiHistogramView
              logName={metric.name}
              tenantId={organizationId}
              projectName={projectName}
              runs={metric.data}
            />
          );
        }

        if (metric.type === "AUDIO") {
          return () => (
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
          return () => (
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
          return () => (
            <MultiGroupVideo
              logName={metric.name}
              organizationId={organizationId}
              projectName={projectName}
              runs={metric.data}
              className="h-full"
            />
          );
        }

        return () => null;
      }),
    [
      metrics,
      memoizedLines,
      className,
      organizationId,
      projectName,
      boundsResetKey,
    ],
  );

  return (
    <DropdownRegion title={title} components={components} groupId={groupId} />
  );
};


// Memoized version of MultiGroup to prevent unnecessary re-renders
export const MemoizedMultiGroup = memo(MultiGroup, arePropsEqual);
