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

// ============================
// Multi-metric batch utilities
// ============================

/**
 * Chunk size for multi-metric batch queries.
 * Kept at 20 to handle long metric names (e.g. "training/dataset/alibaba_cluster_trace_2018")
 * that inflate URL-encoded size well beyond short-name estimates, and to limit per-query
 * ClickHouse load so a single widget doesn't saturate the database.
 */
export const MULTI_METRIC_CHUNK = 20;

/** Split an array into chunks of `size` */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}


/** Columnar representation of bucketed series from the multi-metric batch endpoint */
export interface ColumnarBucketedSeries {
  steps: number[];
  times: string[];
  values: (number | null)[];
  minYs: (number | null)[];
  maxYs: (number | null)[];
  counts: number[];
  nfFlags: number[];
}

/** Columnar parametric series: a bucketed series plus the x-metric column.
 *  Returned by runs.data.graphParametricBatchBucketed, where the y-metric and
 *  the x-metric are joined on step server-side BEFORE bucketing, so xs[i] and
 *  values[i] always describe the same underlying rows. */
export interface ColumnarParametricSeries extends ColumnarBucketedSeries {
  xs: number[];
}

/** Convert columnar wire format back to row-oriented BucketedChartDataPoint[] */
export function fromColumnar(series: ColumnarBucketedSeries): BucketedChartDataPoint[] {
  const len = series.steps.length;
  const result = new Array<BucketedChartDataPoint>(len);
  for (let i = 0; i < len; i++) {
    result[i] = {
      step: series.steps[i],
      time: series.times[i],
      value: series.values[i],
      minY: series.minYs[i],
      maxY: series.maxYs[i],
      count: series.counts[i],
      nonFiniteFlags: series.nfFlags[i],
    };
  }
  return result;
}

/** Bucketed data point from server-side downsampling (graphBucketed endpoint) */
export interface BucketedChartDataPoint {
  step: number;
  time: string;
  value: number | null;   // avg(finite values) — the line (null if all non-finite)
  minY: number | null;    // min(finite values) — envelope bottom (null if all non-finite)
  maxY: number | null;    // max(finite values) — envelope top (null if all non-finite)
  count: number;   // points in bucket
  nonFiniteFlags?: number; // bitmask: bit0=hasNaN, bit1=hasInf(+), bit2=hasNegInf(-)
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
    const nff = d.nonFiniteFlags ?? 0;
    if (nff !== 0) {
      if (!nonFiniteMarkers) nonFiniteMarkers = new Map();
      const flags: NonFiniteFlags = new Set();
      if ((nff & 1) !== 0) flags.add("NaN");
      if ((nff & 2) !== 0) flags.add("Inf");
      if ((nff & 4) !== 0) flags.add("-Inf");
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

  return [main, ...envelopeSeries(x, yMin, yMax, label, color, seriesId)];
}

/**
 * The two hidden companion series that carry a bucket's min/max.
 *
 * They are what the tooltip's MIN and MAX columns read (see
 * `collectCompanionValues` in tooltip-plugin.ts, which finds them by
 * `envelopeOf` + `envelopeBound`) and what draws the shaded band behind the
 * line. A chart that omits them still renders, so the omission shows up only
 * as two silently empty tooltip columns — which is exactly how the parametric
 * charts shipped.
 */
export function envelopeSeries(
  x: number[],
  yMin: (number | null)[],
  yMax: (number | null)[],
  label: string,
  color: string,
  seriesId?: string,
): ChartSeriesData[] {
  return [
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


/** One maximal stretch of a parametric curve that moves in a single x direction. */
export interface MonotonicLeg {
  x: number[];
  y: number[];
  /** 1 = x increasing over the leg, -1 = decreasing */
  direction: 1 | -1;
  /** Source index of each point, in leg order (so already reversed for a
   *  descending leg). Lets a caller carry companion arrays — bucket min/max,
   *  counts — through the split without re-deriving where the cuts fell. */
  indices: number[];
}

/**
 * Split a parametric curve into legs that are each monotonic in x.
 *
 * uPlot draws one y per x, left to right, so a curve that doubles back cannot
 * be a single series. The tempting fix — bucket along x and average whatever
 * lands together — reports values that never occurred: on a warmup-then-decay
 * learning rate, LR 1e-4 happens once early (high loss) and once late (low
 * loss), and their mean describes neither. Splitting at the turning points
 * keeps both branches intact and each one renderable.
 *
 * Points must arrive in curve order (i.e. ordered by step), NOT sorted by x.
 *
 * A reversal only counts once x has retraced more than `tolerance` of the total
 * x range, so an x that merely wobbles — a noisy throughput counter — stays one
 * leg instead of shattering into hundreds.
 *
 * Descending legs are reversed on the way out, since uPlot still needs ascending
 * x within a series; direction is reported so callers can label them.
 */
/** [0, 1, ... n-1] */
function allIndices(n: number): number[] {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = i;
  return out;
}

export function splitMonotonicLegs(
  x: number[],
  y: number[],
  tolerance = 0.02,
): MonotonicLeg[] {
  const n = Math.min(x.length, y.length);
  if (n < 3) {
    if (n === 0) return [];
    // Too few points to detect a turn, but a 2-point window on a decay branch
    // (a narrow zoom, say) can still arrive descending. Returning it as-is
    // would hand uPlot an unsorted series and break its own contract.
    const lx = x.slice(0, n);
    const ly = y.slice(0, n);
    if (n === 2 && lx[1] < lx[0]) {
      return [{ x: [lx[1], lx[0]], y: [ly[1], ly[0]], direction: -1, indices: [1, 0] }];
    }
    return [{ x: lx, y: ly, direction: 1, indices: lx.map((_, i) => i) }];
  }

  let lo = x[0];
  let hi = x[0];
  for (let i = 1; i < n; i++) {
    if (x[i] < lo) lo = x[i];
    if (x[i] > hi) hi = x[i];
  }
  const minRetrace = (hi - lo) * tolerance;
  if (!(minRetrace > 0)) {
    return [{ x: x.slice(0, n), y: y.slice(0, n), direction: 1, indices: allIndices(n) }];
  }

  const cuts: number[] = [];
  let dir: 1 | -1 | 0 = 0;
  let extremeIdx = 0;
  let extremeVal = x[0];

  for (let i = 1; i < n; i++) {
    const d = x[i] - x[i - 1];
    if (dir === 0) {
      if (d !== 0) {
        dir = d > 0 ? 1 : -1;
        extremeIdx = i;
        extremeVal = x[i];
      }
      continue;
    }
    // Strictly advancing, so a plateau at the turn keeps the FIRST point that
    // reached the extreme. Ties otherwise drag the cut past the turn and the
    // ascending leg inherits the first descending sample.
    const advancing = dir === 1 ? x[i] > extremeVal : x[i] < extremeVal;
    if (advancing) {
      extremeVal = x[i];
      extremeIdx = i;
    } else if (Math.abs(x[i] - extremeVal) > minRetrace) {
      // Retraced far enough to be a real turn, not noise. The leg ends at the
      // extreme itself so the two legs meet at the turning point.
      cuts.push(extremeIdx);
      dir = dir === 1 ? -1 : 1;
      extremeVal = x[i];
      extremeIdx = i;
    }
  }

  const bounds = [0, ...cuts, n - 1];
  const legs: MonotonicLeg[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i];
    const end = bounds[i + 1];
    if (end <= start) continue;
    let lx = x.slice(start, end + 1);
    let ly = y.slice(start, end + 1);
    let li = allIndices(end + 1 - start).map((k) => start + k);
    const direction: 1 | -1 = lx[lx.length - 1] >= lx[0] ? 1 : -1;
    if (direction === -1) {
      lx = lx.slice().reverse();
      ly = ly.slice().reverse();
      li = li.slice().reverse();
    }
    legs.push({ x: lx, y: ly, direction, indices: li });
  }
  return legs.length > 0
    ? legs
    : [{ x: x.slice(0, n), y: y.slice(0, n), direction: 1, indices: allIndices(n) }];
}
