"use client";

import React, { forwardRef, lazy, Suspense } from "react";
// Import LineData type from uPlot component (canonical source)
import type { LineData, LineChartUPlotRef } from "./line-uplot";
import type { TooltipInterpolation } from "@/lib/math/interpolation";

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
  /** Subtitle shown in tooltip header (e.g. chip/pattern names) */
  subtitle?: string;
  showXAxis?: boolean;
  showYAxis?: boolean;
  showLegend?: boolean;
  /** Sync key for cross-chart cursor sync */
  syncKey?: string;
  /** Tooltip interpolation mode for missing values */
  tooltipInterpolation?: TooltipInterpolation;
  /** Callback fired when zoom range changes, for server re-fetch of full-resolution data */
  onZoomRangeChange?: (range: [number, number] | null) => void;
  /** Enable IQR-based outlier detection for Y-axis scaling */
  outlierDetection?: boolean;
  /** When false, lines break at null/missing values instead of connecting across gaps */
  spanGaps?: boolean;
  /** Enable Y-axis drag-to-zoom (adaptive: horizontal drag zooms X, vertical drag zooms Y) */
  yZoom?: boolean;
  /** Externally-stored Y zoom range for persistence across mini/fullscreen */
  yZoomRange?: [number, number] | null;
  /** Called when user drags to zoom Y axis, or null on reset */
  onYZoomRangeChange?: (range: [number, number] | null) => void;
  /** Map of runId → forkStep for drawing vertical fork annotations */
  forkSteps?: Map<string, number>;
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
  ({ syncKey, className, tooltipInterpolation, onZoomRangeChange, outlierDetection, spanGaps, yZoom, yZoomRange, onYZoomRangeChange, forkSteps, ...props }, ref) => {
    // Use title as key to force remount when switching between different charts
    // This ensures each chart gets a clean uPlot instance with correct data
    const chartKey = props.title || "uplot-chart";
    return (
      <div
        key={chartKey}
        data-testid="line-chart-wrapper"
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
            tooltipInterpolation={tooltipInterpolation}
            onZoomRangeChange={onZoomRangeChange}
            outlierDetection={outlierDetection}
            spanGaps={spanGaps}
            yZoom={yZoom}
            yZoomRange={yZoomRange}
            onYZoomRangeChange={onYZoomRangeChange}
            forkSteps={forkSteps}
            {...props}
          />
        </Suspense>
      </div>
    );
  }
);

LineChartWrapper.displayName = "LineChartWrapper";

export default LineChartWrapper;
