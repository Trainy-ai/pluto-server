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
 * Threshold: auto-smooth series in multi-metric charts above this many
 * (downsampled) points. In multi-metric charts, dashed lines need smoothing
 * so dash patterns are visible (canvas path zigzag merges dashes into solid
 * blur). Solid lines in the same chart also get the same light smoothing so
 * they look visually consistent with the dashed lines.
 */
const AUTO_SMOOTH_THRESHOLD = 500;

/**
 * Apply a single smoothing pass, respecting valueFlags gaps.
 * Splits data into contiguous finite segments and smooths each independently.
 */
function smoothPass(
  x: number[],
  y: number[],
  algorithm: SmoothingAlgorithm,
  parameter: number,
  valueFlags: Map<number, string> | undefined,
): number[] {
  if (valueFlags && valueFlags.size > 0) {
    const result = new Array<number>(x.length);
    let segStart = -1;
    for (let i = 0; i <= x.length; i++) {
      const isFlagged = i < x.length && valueFlags.has(x[i]);
      if (isFlagged || i === x.length) {
        if (segStart >= 0) {
          const segX = x.slice(segStart, i);
          const segY = y.slice(segStart, i);
          const smoothed = smoothData(segX, segY, algorithm, parameter);
          for (let j = 0; j < smoothed.length; j++) {
            result[segStart + j] = smoothed[j];
          }
          segStart = -1;
        }
        if (isFlagged) {
          result[i] = y[i]; // placeholder — will become null gap
        }
      } else if (segStart < 0) {
        segStart = i;
      }
    }
    return result;
  }
  return smoothData(x, y, algorithm, parameter);
}

/**
 * Apply smoothing to chart data. Only smooths main series, not envelope companions.
 * Returns array: smoothed series, plus optionally the original data as a dimmed companion.
 *
 * In multi-metric charts, dense series get a light auto-smooth (Gaussian,
 * sigma=len/640) so dashed lines have visible dash patterns and solid lines
 * look visually consistent. User smoothing is then applied on top.
 */
export function applySmoothing(
  chartData: ChartSeriesData,
  smoothingSettings: SmoothingSettings,
  isMultiMetric: boolean = false,
): ChartSeriesData[] {
  // Don't smooth envelope boundary series — pass through as-is
  if (chartData.envelopeOf) {
    return [chartData];
  }

  // Multi-metric charts auto-smooth dense series so dashed lines have visible
  // dash patterns and solid lines look visually consistent alongside them.
  const needsAutoSmooth = isMultiMetric &&
    chartData.x.length > AUTO_SMOOTH_THRESHOLD;

  if (!smoothingSettings.enabled && !needsAutoSmooth) {
    return [chartData];
  }

  let finalY = chartData.y;

  // Pass 1: auto-smooth for multi-metric charts.
  // Light Gaussian smoothing — the envelope bands from downsampling show
  // the actual data range underneath.
  if (needsAutoSmooth) {
    const sigma = Math.max(4, Math.floor(chartData.x.length / 360));
    finalY = smoothPass(chartData.x, finalY, "gaussian", sigma, chartData.valueFlags);
  }

  // Pass 2: user smoothing on top (if enabled)
  if (smoothingSettings.enabled) {
    finalY = smoothPass(
      chartData.x, finalY,
      smoothingSettings.algorithm, smoothingSettings.parameter,
      chartData.valueFlags,
    );
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

  // Show raw companion for user smoothing (envelope bands cover the dash auto-smooth case).
  if (smoothingSettings.enabled && smoothingSettings.showOriginalData) {
    data.push({
      ...chartData,
      opacity: 0.07,
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
  isMultiMetric: boolean = false,
): ChartSeriesData[] {
  const downsampledSeries = applyDownsampling(baseData, maxPoints);
  return downsampledSeries.flatMap((s) => applySmoothing(s, smoothingSettings, isMultiMetric));
}
