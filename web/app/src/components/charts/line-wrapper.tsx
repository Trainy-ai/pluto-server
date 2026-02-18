"use client";

import React, { forwardRef, lazy, Suspense } from "react";
// Import LineData type from uPlot component (canonical source)
import type { LineData, LineChartUPlotRef, RawLineData } from "./line-uplot";
import type { TooltipInterpolation } from "@/lib/math/interpolation";

// Re-export for external consumers
export type { LineData, LineChartUPlotRef, RawLineData };

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
  /** Tooltip interpolation mode for missing values */
  tooltipInterpolation?: TooltipInterpolation;
  /** Raw (pre-downsampled) data for zoom-aware re-downsampling */
  rawLines?: RawLineData[];
  /** Target points for re-downsampling on zoom */
  downsampleTarget?: number;
  /** Callback to reprocess raw data for a zoomed range */
  reprocessForZoom?: (rawLines: RawLineData[], xMin: number, xMax: number) => LineData[];
  /** Callback fired when zoom range changes, for server re-fetch of full-resolution data */
  onZoomRangeChange?: (range: [number, number] | null) => void;
  /** Enable IQR-based outlier detection for Y-axis scaling */
  outlierDetection?: boolean;
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
  ({ syncKey, className, tooltipInterpolation, rawLines, downsampleTarget, reprocessForZoom, onZoomRangeChange, outlierDetection, ...props }, ref) => {
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
            rawLines={rawLines}
            downsampleTarget={downsampleTarget}
            reprocessForZoom={reprocessForZoom}
            onZoomRangeChange={onZoomRangeChange}
            outlierDetection={outlierDetection}
            {...props}
          />
        </Suspense>
      </div>
    );
  }
);

LineChartWrapper.displayName = "LineChartWrapper";

export default LineChartWrapper;
