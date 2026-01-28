"use client";

import React, { forwardRef, lazy, Suspense } from "react";
import type { ChartEngine } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/use-line-settings";
// Import LineData type from uPlot component (canonical source)
import type { LineData, LineChartUPlotRef } from "./line-uplot";

// Re-export for external consumers
export type { LineData, LineChartUPlotRef };

// Lazy load chart implementations for code splitting
const LineChartECharts = lazy(() => import("./line"));
const LineChartUPlot = lazy(() => import("./line-uplot"));

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
/**
 * Ref type is unknown because the underlying chart components have incompatible ref types:
 * - ECharts: ReactECharts (class component instance)
 * - uPlot: LineChartUPlotRef (imperative handle with getChart/resetZoom methods)
 * Consumers should cast based on which chartEngine they're using.
 */
const LineChartWrapper = forwardRef<unknown, LineChartWrapperProps>(
  ({ chartEngine = "echarts", syncKey, ...props }, ref) => {
    return (
      <Suspense fallback={<ChartLoadingFallback />}>
        {chartEngine === "uplot" ? (
          <LineChartUPlot
            ref={ref as React.Ref<LineChartUPlotRef>}
            syncKey={syncKey}
            {...props}
          />
        ) : (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          <LineChartECharts ref={ref as React.Ref<any>} {...props} />
        )}
      </Suspense>
    );
  }
);

LineChartWrapper.displayName = "LineChartWrapper";

export default LineChartWrapper;
