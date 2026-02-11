"use client";

import React, { forwardRef, lazy, Suspense } from "react";
// Import LineData type from uPlot component (canonical source)
import type { LineData, LineChartUPlotRef } from "./line-uplot";

// Re-export for external consumers
export type { LineData, LineChartUPlotRef };

// Lazy load chart implementation for code splitting
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
  /** Sync key for cross-chart cursor sync */
  syncKey?: string;
  /** Manual Y-axis minimum bound */
  yMin?: number;
  /** Manual Y-axis maximum bound */
  yMax?: number;
  /** Callback fired when the actual data range (min/max of all Y values) is computed */
  onDataRange?: (dataMin: number, dataMax: number) => void;
  /** Callback fired on double-click to reset Y-axis bounds for this chart */
  onResetBounds?: () => void;
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
 * LineChart wrapper using uPlot for high-performance chart rendering.
 *
 * Features:
 * - High-performance, lightweight (~50KB bundle)
 * - Drag-to-zoom with double-click to reset
 * - Cross-chart cursor sync
 * - Cross-chart series highlighting
 */
const LineChartWrapper = forwardRef<LineChartUPlotRef, LineChartWrapperProps>(
  ({ syncKey, className, ...props }, ref) => {
    // Use title as key to force remount when switching between different charts
    // This ensures each chart gets a clean uPlot instance with correct data
    const chartKey = props.title || "uplot-chart";
    return (
      <div
        key={chartKey}
        className={className}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          flex: 1,
          minHeight: 0,
        }}
      >
        <Suspense fallback={<ChartLoadingFallback />}>
          <LineChartUPlot
            ref={ref}
            syncKey={syncKey}
            {...props}
          />
        </Suspense>
      </div>
    );
  }
);

LineChartWrapper.displayName = "LineChartWrapper";

export default LineChartWrapper;
