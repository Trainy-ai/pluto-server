/**
 * Shared chart data utility functions used by both single-run and comparison page charts.
 */

import { smoothData } from "@/lib/math/smoothing";
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

/** Set of non-finite value types found in a bucketed aggregation range */
export type NonFiniteFlags = Set<"NaN" | "Inf" | "-Inf">;

/** Chart series data with all optional fields for smoothing/envelope/display */
export interface ChartSeriesData {
  x: number[];
  y: (number | null)[];
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
  /** Map from x-value to set of non-finite flags found in the aggregation bucket.
   *  Used for rendering markers (△ for +Inf, ▽ for -Inf, ⊗ for NaN). */
  nonFiniteMarkers?: Map<number, NonFiniteFlags>;
  /** Human-readable run name (for tooltip column customization) */
  runName?: string;
  /** Run ID / external ID (for tooltip column customization) */
  runId?: string;
  /** Metric name this series is plotting (for tooltip column customization) */
  metricName?: string;
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
  y: (number | null)[],
  algorithm: SmoothingAlgorithm,
  parameter: number,
  valueFlags: Map<number, string> | undefined,
): (number | null)[] {
  // Segment the data at gaps (flagged positions OR null y-values) and smooth
  // each contiguous finite segment independently. This prevents null→0 coercion
  // in the smoothing kernel which would create artificial dips.
  const hasFlags = valueFlags && valueFlags.size > 0;
  const hasNulls = y.some((v) => v === null);

  if (!hasFlags && !hasNulls) {
    return smoothData(x, y as number[], algorithm, parameter);
  }

  const result = new Array<number | null>(x.length);
  let segStart = -1;
  for (let i = 0; i <= x.length; i++) {
    const isGap = i < x.length && (
      (hasFlags && valueFlags!.has(x[i])) || y[i] === null
    );
    if (isGap || i === x.length) {
      if (segStart >= 0) {
        const segX = x.slice(segStart, i);
        const segY = y.slice(segStart, i) as number[];
        const smoothed = smoothData(segX, segY, algorithm, parameter);
        for (let j = 0; j < smoothed.length; j++) {
          result[segStart + j] = smoothed[j];
        }
        segStart = -1;
      }
      if (i < x.length) {
        result[i] = y[i]; // preserve null / flagged placeholder
      }
    } else if (segStart < 0) {
      segStart = i;
    }
  }
  return result;
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

/** Bucketed data point from server-side downsampling (graphBucketed endpoint) */
export interface BucketedChartDataPoint {
  step: number;
  time: string;
  value: number | null;   // avg(finite values) — the line (null if all non-finite)
  minY: number | null;    // min(finite values) — envelope bottom (null if all non-finite)
  maxY: number | null;    // max(finite values) — envelope top (null if all non-finite)
  count: number;   // points in bucket
  hasNaN?: boolean;    // bucket contained NaN value(s)
  hasInf?: boolean;    // bucket contained +Infinity value(s)
  hasNegInf?: boolean; // bucket contained -Infinity value(s)
}

/**
 * Convert server-side bucketed data into 3 chart series (main + min/max envelopes).
 * Converts server-bucketed data into chart series with min/max envelopes.
 *
 * @param getX - Optional custom x-value mapper. Defaults to step. Use for time-based axes.
 */
export function applyServerBuckets(
  bucketedData: BucketedChartDataPoint[],
  label: string,
  color: string,
  seriesId?: string,
  dash?: number[],
  getX: (d: BucketedChartDataPoint) => number = (d) => Number(d.step),
): ChartSeriesData[] {
  const x = bucketedData.map(getX);
  const y = bucketedData.map((d) => d.value != null ? Number(d.value) : null);
  const yMin = bucketedData.map((d) => d.minY != null ? Number(d.minY) : null);
  const yMax = bucketedData.map((d) => d.maxY != null ? Number(d.maxY) : null);

  // Build non-finite markers map from bucket flags
  let nonFiniteMarkers: Map<number, NonFiniteFlags> | undefined;
  for (let i = 0; i < bucketedData.length; i++) {
    const d = bucketedData[i];
    if (d.hasNaN || d.hasInf || d.hasNegInf) {
      if (!nonFiniteMarkers) nonFiniteMarkers = new Map();
      const flags: NonFiniteFlags = new Set();
      if (d.hasNaN) flags.add("NaN");
      if (d.hasInf) flags.add("Inf");
      if (d.hasNegInf) flags.add("-Inf");
      nonFiniteMarkers.set(x[i], flags);
    }
  }

  const main: ChartSeriesData = {
    x,
    y,
    label,
    color,
    seriesId,
    dash,
    nonFiniteMarkers,
  };

  return [
    main,
    {
      x,
      y: yMin,
      label: `${label}_env_min`,
      seriesId: seriesId ? `${seriesId}_env_min` : undefined,
      color,
      hideFromLegend: true,
      envelopeOf: label,
      envelopeBound: "min" as const,
    },
    {
      x,
      y: yMax,
      label: `${label}_env_max`,
      seriesId: seriesId ? `${seriesId}_env_max` : undefined,
      color,
      hideFromLegend: true,
      envelopeOf: label,
      envelopeBound: "max" as const,
    },
  ];
}

/**
 * Apply smoothing then produce envelope series from server-bucketed data.
 * Combines applyServerBuckets + applySmoothing in one step.
 *
 * @param getX - Optional custom x-value mapper. Defaults to step.
 */
export function bucketedAndSmooth(
  bucketedData: BucketedChartDataPoint[],
  label: string,
  color: string,
  smoothingSettings: SmoothingSettings,
  isMultiMetric: boolean = false,
  seriesId?: string,
  dash?: number[],
  getX?: (d: BucketedChartDataPoint) => number,
): ChartSeriesData[] {
  const series = applyServerBuckets(bucketedData, label, color, seriesId, dash, getX);
  return series.flatMap((s) => applySmoothing(s, smoothingSettings, isMultiMetric));
}

