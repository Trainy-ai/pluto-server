/**
 * Shared chart data utility functions used by both single-run and comparison page charts.
 */

import { smoothData } from "@/lib/math/smoothing";
import { downsampleWithEnvelope } from "@/lib/math/downsample";
import type { SmoothingAlgorithm } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/use-line-settings";

// ============================
// Types
// ============================

/** Data point with step, time, and value — used by both single-run and comparison charts */
export interface ChartDataPoint {
  step: number;
  time: string;
  value: number;
  valueFlag?: string; // "NaN" | "Inf" | "-Inf" | ""
}

/** Smoothing settings subset needed by these utilities */
export interface SmoothingSettings {
  enabled: boolean;
  algorithm: SmoothingAlgorithm;
  parameter: number;
  showOriginalData: boolean;
}

/** Base chart series data */
export interface BaseSeriesData {
  x: number[];
  y: number[];
  label: string;
  color: string;
  seriesId?: string;
  /** uPlot dash pattern, e.g. [10, 5]. undefined = solid. */
  dash?: number[];
  /** Map from x-value to non-finite flag text ("NaN", "Inf", "-Inf") for tooltip display */
  valueFlags?: Map<number, string>;
}

/** Chart series data with all optional fields for smoothing/envelope/display */
export interface ChartSeriesData {
  x: number[];
  y: number[];
  label: string;
  color?: string;
  seriesId?: string;
  /** uPlot dash pattern, e.g. [10, 5]. undefined = solid. */
  dash?: number[];
  opacity?: number;
  hideFromLegend?: boolean;
  envelopeOf?: string;
  envelopeBound?: "min" | "max";
  /** Map from x-value to non-finite flag text ("NaN", "Inf", "-Inf") for tooltip display */
  valueFlags?: Map<number, string>;
}

// ============================
// Functions
// ============================

/**
 * Build a valueFlags map from data points that have non-empty valueFlag.
 * Maps x-value (step or time) to flag text ("NaN", "Inf", "-Inf").
 * Returns undefined if no flags are present (optimization to skip downstream checks).
 */
export function buildValueFlags(
  data: ChartDataPoint[],
  getX: (d: ChartDataPoint) => number,
): Map<number, string> | undefined {
  let flags: Map<number, string> | undefined;
  for (const d of data) {
    if (d.valueFlag && d.valueFlag !== "") {
      if (!flags) flags = new Map();
      flags.set(getX(d), d.valueFlag);
    }
  }
  return flags;
}

/**
 * Determine appropriate time unit based on max seconds for display.
 * Used by both single-run and comparison charts for relative time axes.
 */
export function getTimeUnitForDisplay(maxSeconds: number): {
  divisor: number;
  unit: string;
} {
  if (maxSeconds < 120) {
    return { divisor: 1, unit: "s" };
  } else if (maxSeconds < 3600) {
    return { divisor: 60, unit: "min" };
  } else if (maxSeconds < 86400) {
    return { divisor: 3600, unit: "hr" };
  } else if (maxSeconds < 604800) {
    return { divisor: 86400, unit: "day" };
  } else if (maxSeconds < 2629746) {
    return { divisor: 604800, unit: "week" };
  } else if (maxSeconds < 31556952) {
    return { divisor: 2629746, unit: "month" };
  } else {
    return { divisor: 31556952, unit: "year" };
  }
}

/**
 * Align two metric data series by step and unzip into x/y arrays.
 * Builds a map from xData's step→value, then walks yData to find matching steps.
 * Used for custom X-axis selection (e.g., plot loss vs. learning_rate).
 */
export function alignAndUnzip(
  xData: ChartDataPoint[],
  yData: ChartDataPoint[],
): { x: number[]; y: number[] } {
  const xMap = new Map<number, number>();
  for (const { step, value } of xData) {
    xMap.set(Number(step), Number(value));
  }

  const pairs: [number, number][] = [];
  for (const { step, value: yVal } of yData) {
    const xVal = xMap.get(Number(step));
    if (xVal !== undefined) {
      pairs.push([xVal, Number(yVal)]);
    }
  }

  const sortedPairs = pairs.sort((a, b) => a[0] - b[0]);

  const x: number[] = [];
  const y: number[] = [];
  for (const [xVal, yVal] of sortedPairs) {
    x.push(xVal);
    y.push(yVal);
  }

  return { x, y };
}

/**
 * Apply downsampling with min/max envelope to reduce data points.
 * Always produces 3 series (main + min envelope + max envelope) for consistent series count.
 */
export function applyDownsampling(
  chartData: BaseSeriesData,
  maxPoints: number,
): ChartSeriesData[] {
  const envelope = downsampleWithEnvelope(chartData.x, chartData.y, maxPoints);
  const main: ChartSeriesData = { ...chartData, x: envelope.x, y: envelope.y, valueFlags: chartData.valueFlags };

  return [
    main,
    {
      x: envelope.x,
      y: envelope.yMin,
      label: `${chartData.label}_env_min`,
      seriesId: chartData.seriesId ? `${chartData.seriesId}_env_min` : undefined,
      color: chartData.color,
      hideFromLegend: true,
      envelopeOf: chartData.label,
      envelopeBound: "min" as const,
      valueFlags: chartData.valueFlags,
    },
    {
      x: envelope.x,
      y: envelope.yMax,
      label: `${chartData.label}_env_max`,
      seriesId: chartData.seriesId ? `${chartData.seriesId}_env_max` : undefined,
      color: chartData.color,
      hideFromLegend: true,
      envelopeOf: chartData.label,
      envelopeBound: "max" as const,
      valueFlags: chartData.valueFlags,
    },
  ];
}

/**
 * Apply smoothing to chart data. Only smooths main series, not envelope companions.
 * Returns array: smoothed series, plus optionally the original data as a dimmed companion.
 */
export function applySmoothing(
  chartData: ChartSeriesData,
  smoothingSettings: SmoothingSettings,
): ChartSeriesData[] {
  // Don't smooth envelope boundary series — pass through as-is
  if (chartData.envelopeOf) {
    return [chartData];
  }

  if (!smoothingSettings.enabled) {
    return [chartData];
  }

  // Split data into contiguous segments of finite values and smooth each
  // independently. This prevents smoothing from interpolating across
  // NaN/Inf/-Inf gaps — the smoothed curve has the same gaps as the raw
  // data, and the EMA state resets after each gap.
  let finalY: number[];
  if (chartData.valueFlags && chartData.valueFlags.size > 0) {
    finalY = new Array(chartData.x.length);
    let segStart = -1;
    for (let i = 0; i <= chartData.x.length; i++) {
      const isFlagged = i < chartData.x.length && chartData.valueFlags.has(chartData.x[i]);
      if (isFlagged || i === chartData.x.length) {
        // End of a contiguous finite segment — smooth it independently
        if (segStart >= 0) {
          const segX = chartData.x.slice(segStart, i);
          const segY = chartData.y.slice(segStart, i);
          const smoothedSeg = smoothData(segX, segY, smoothingSettings.algorithm, smoothingSettings.parameter);
          for (let j = 0; j < smoothedSeg.length; j++) {
            finalY[segStart + j] = smoothedSeg[j];
          }
          segStart = -1;
        }
        if (isFlagged) {
          finalY[i] = chartData.y[i]; // placeholder — will become null gap
        }
      } else if (segStart < 0) {
        segStart = i;
      }
    }
  } else {
    finalY = smoothData(chartData.x, chartData.y, smoothingSettings.algorithm, smoothingSettings.parameter);
  }

  const data: ChartSeriesData[] = [
    {
      ...chartData,
      y: finalY,
      opacity: 1,
      hideFromLegend: false,
      valueFlags: chartData.valueFlags,
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

/**
 * Apply downsampling then smoothing to chart data.
 * Handles the fact that downsampling produces envelope companion series.
 */
export function downsampleAndSmooth(
  baseData: BaseSeriesData,
  maxPoints: number,
  smoothingSettings: SmoothingSettings,
): ChartSeriesData[] {
  const downsampledSeries = applyDownsampling(baseData, maxPoints);
  return downsampledSeries.flatMap((s) => applySmoothing(s, smoothingSettings));
}
