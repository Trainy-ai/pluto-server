import type uPlot from "uplot";
import type { LineData } from "../line-uplot";
import { interpolateValue, isInsideDataGap, type TooltipInterpolation } from "@/lib/math/interpolation";

// ============================
// setCursor Hook Builders
// ============================

export interface FocusDetectionDeps {
  processedLines: LineData[];
  tooltipInterpolation: TooltipInterpolation;
  spanGaps: boolean;
  isActiveChart: () => boolean;
  lastFocusedSeriesRef: { current: number | null };
  highlightedSeriesRef: { current: string | null };
  chartLineWidthRef: { current: number };
  chartId: string;
  chartSyncContextRef: {
    current: {
      highlightUPlotSeries: (chartId: string, runId: string | null) => void;
      setHighlightedSeriesName: (name: string | null) => void;
      setHighlightedRunId: (runId: string | null) => void;
    } | null;
  };
}

/**
 * Build the focus-detection setCursor hook.
 * Finds the closest series to cursor Y position and broadcasts emphasis.
 */
export function buildFocusDetectionHook(deps: FocusDetectionDeps): (u: uPlot) => void {
  return (u: uPlot) => {
    // Manual focus detection - uPlot's built-in focus doesn't work with cursor sync
    // because synced charts receive bad Y coordinates

    // Only run focus detection on the actively hovered chart
    if (!deps.isActiveChart()) return;

    const idx = u.cursor.idx;
    const top = u.cursor.top;

    // Skip if cursor not on chart
    if (idx == null || top == null || top < 0) return;

    // Find the series closest to the cursor Y position
    let closestSeriesIdx: number | null = null;
    let closestDistance = Infinity;

    const yScale = u.scales.y;

    for (let si = 1; si < u.series.length; si++) {
      const series = u.series[si];
      if (!series.show) continue; // Skip hidden series

      // Skip raw/original series from smoothing - only smoothed lines should compete for emphasis
      const lineData = deps.processedLines[si - 1];
      if (lineData?.hideFromLegend) continue;

      const yData = u.data[si] as (number | null)[];
      let yVal = yData[idx];
      // If null and interpolation is enabled, use interpolated value for distance calc
      // But don't interpolate across real data gaps when spanGaps is false
      if (yVal == null && deps.tooltipInterpolation !== "none") {
        if (!deps.spanGaps && isInsideDataGap(yData, idx)) {
          continue;
        }
        yVal = interpolateValue(u.data[0] as number[], yData, idx, deps.tooltipInterpolation);
      }
      if (yVal == null) continue;

      // Convert data value to pixel position using uPlot's scale-aware conversion.
      // This correctly handles log scales (distr: 3) unlike manual linear mapping.
      if (yScale.min == null || yScale.max == null) continue;
      const yPx = u.valToPos(yVal, "y");

      const distance = Math.abs(yPx - top);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestSeriesIdx = si;
      }
    }

    // Skip if no change from last focus
    if (closestSeriesIdx === deps.lastFocusedSeriesRef.current) return;

    // Apply emphasis (always pick closest, no threshold)
    if (closestSeriesIdx != null && closestDistance < Infinity) {
      // Update focus ref - stroke functions will read this during redraw
      deps.lastFocusedSeriesRef.current = closestSeriesIdx;
      // Also update chart instance so the stroke function can read synchronously
      (u as any)._lastFocusedSeriesIdx = closestSeriesIdx;
      // Clear cross-chart highlight on the source chart (we're locally focused)
      (u as any)._crossHighlightRunId = null;

      // Apply width emphasis on this chart (matches cross-chart applySeriesHighlight)
      const lw = deps.chartLineWidthRef.current;
      const highlightedWidth = Math.max(1, lw * 1.25);
      const dimmedWidth = Math.max(0.4, lw * 0.85);
      for (let si = 1; si < u.series.length; si++) {
        u.series[si].width = si === closestSeriesIdx ? highlightedWidth : dimmedWidth;
      }

      // Trigger redraw so stroke functions re-evaluate with new focus.
      // Pass false to skip rebuildPaths (which calls _setScale("x", ...) internally,
      // causing Y auto-range to recalculate and overwrite any user Y-axis zoom).
      u.redraw(false);

      // CROSS-CHART highlighting
      const seriesLabel = deps.processedLines[closestSeriesIdx - 1]?.label ?? null;
      if (seriesLabel) {
        // Update tooltip ref immediately (context state is async)
        deps.highlightedSeriesRef.current = seriesLabel;
        deps.chartSyncContextRef.current?.setHighlightedSeriesName(seriesLabel);

        // Extract run ID from seriesId for cross-chart matching
        // seriesId is either "runId" (single-metric) or "runId:metricName" (multi-metric)
        const seriesId = deps.processedLines[closestSeriesIdx - 1]?.seriesId;
        const runId = seriesId ? seriesId.split(':')[0] : null;
        if (runId) {
          deps.chartSyncContextRef.current?.highlightUPlotSeries(deps.chartId, runId);
          deps.chartSyncContextRef.current?.setHighlightedRunId(runId);
        }
      }
    }
  };
}

export interface InterpolationDotsDeps {
  processedLines: LineData[];
  tooltipInterpolation: TooltipInterpolation;
  spanGaps: boolean;
  isActiveChart: () => boolean;
}

/**
 * Build the interpolation-dots setCursor hook.
 * Shows hollow dots at interpolated values for series with missing data at the cursor position.
 */
export function buildInterpolationDotsHook(deps: InterpolationDotsDeps): (u: uPlot) => void {
  return (u: uPlot) => {
    const dots = (u as any)._interpDots as HTMLDivElement[] | undefined;
    if (!dots) return;

    const idx = u.cursor.idx;
    // Hide all dots when cursor is off chart or interpolation is disabled
    if (idx == null || deps.tooltipInterpolation === "none" || !deps.isActiveChart()) {
      for (const dot of dots) dot.style.display = "none";
      return;
    }

    for (let si = 1; si < u.series.length; si++) {
      const dot = dots[si - 1];
      if (!dot) continue;

      const lineData = deps.processedLines[si - 1];

      // Skip hidden series and raw/original companions from smoothing
      if (!u.series[si].show || lineData?.hideFromLegend) {
        dot.style.display = "none";
        continue;
      }

      const yVal = (u.data[si] as (number | null)[])[idx];

      // If real data exists at this index, uPlot draws its own cursor dot
      if (yVal != null) {
        dot.style.display = "none";
        continue;
      }

      // Try interpolation for the missing value
      // Don't interpolate across real data gaps when spanGaps is false
      const yData = u.data[si] as (number | null | undefined)[];
      if (!deps.spanGaps && isInsideDataGap(yData, idx)) {
        dot.style.display = "none";
        continue;
      }

      const interpolated = interpolateValue(
        u.data[0] as number[],
        yData,
        idx,
        deps.tooltipInterpolation,
      );

      if (interpolated == null) {
        dot.style.display = "none";
        continue;
      }

      // Position the dot at the interpolated value
      const xPos = u.valToPos(u.data[0][idx], "x");
      const yPos = u.valToPos(interpolated, "y");
      const color = lineData?.color || `hsl(${((si - 1) * 137) % 360}, 70%, 50%)`;

      dot.style.display = "block";
      dot.style.left = xPos + "px";
      dot.style.top = yPos + "px";
      dot.style.borderColor = color;
    }
  };
}
