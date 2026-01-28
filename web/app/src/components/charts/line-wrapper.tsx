"use client";

import React, { forwardRef, lazy, Suspense } from "react";
import type { ChartEngine } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/use-line-settings";

// Lazy load chart implementations for code splitting
const LineChartECharts = lazy(() => import("./line"));
const LineChartUPlot = lazy(() => import("./line-uplot"));

export interface LineData {
  x: number[];
  y: number[];
  label: string;
  color?: string;
  dashed?: boolean;
  hideFromLegend?: boolean;
  opacity?: number;
}

interface LineChartWrapperProps extends React.HTMLAttributes<HTMLDivElement> {
  lines: LineData[];
  isDateTime?: boolean;
  logXAxis?: boolean;
  logYAxis?: boolean;
  xlabel?: string;
  ylabel?: string;
  title?: string;
  showXAxis?: boolean;
  showYAxis?: boolean;
  showLegend?: boolean;
  /** Chart engine to use: "echarts" (Legacy) or "uplot" (Alpha) */
  chartEngine?: ChartEngine;
  /** Sync key for cross-chart cursor sync (uPlot only) */
  syncKey?: string;
}

// Loading fallback for lazy-loaded charts
function ChartLoadingFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
    </div>
  );
}

/**
 * LineChart wrapper that switches between ECharts and uPlot implementations
 * based on the chartEngine prop.
 *
 * - ECharts (Legacy): Full-featured, rich interactions, ~1MB bundle
 * - uPlot (Alpha): High-performance, lightweight, ~50KB bundle
 */
const LineChartWrapper = forwardRef<any, LineChartWrapperProps>(
  ({ chartEngine = "echarts", syncKey, ...props }, ref) => {
    return (
      <Suspense fallback={<ChartLoadingFallback />}>
        {chartEngine === "uplot" ? (
          <LineChartUPlot ref={ref} syncKey={syncKey} {...props} />
        ) : (
          <LineChartECharts ref={ref} {...props} />
        )}
      </Suspense>
    );
  }
);

LineChartWrapper.displayName = "LineChartWrapper";

export default LineChartWrapper;
