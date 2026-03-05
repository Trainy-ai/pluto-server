import type uPlot from "uplot";
import type { LineData } from "../line-uplot";

// ============================
// Data Processing — Pure Functions
// ============================

/** Stack-safe min for large arrays (Math.min(...arr) overflows at ~10k elements) */
export function arrayMin(arr: number[]): number {
  let min = Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] < min) min = arr[i];
  }
  return min;
}

/** Stack-safe max for large arrays (Math.max(...arr) overflows at ~10k elements) */
export function arrayMax(arr: number[]): number {
  let max = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > max) max = arr[i];
  }
  return max;
}

/**
 * Filter data for log scale (remove non-positive values).
 * Optimized to use single loop instead of multiple map/filter calls.
 */
export function filterDataForLogScale(
  lines: LineData[],
  logXAxis: boolean,
  logYAxis: boolean
): LineData[] {
  if (!logXAxis && !logYAxis) return lines;

  return lines
    .map((line) => {
      const x: number[] = [];
      const y: number[] = [];
      for (let i = 0; i < line.x.length; i++) {
        const xVal = line.x[i];
        const yVal = line.y[i];
        if (logXAxis && xVal <= 0) continue;
        if (logYAxis && yVal <= 0) continue;
        x.push(xVal);
        y.push(yVal);
      }
      return { ...line, x, y };
    })
    .filter((line) => line.x.length > 0);
}

/**
 * Detect the typical step interval for a sorted x-array.
 * Returns the median of consecutive differences, which is robust to outliers.
 */
function detectStepInterval(sortedX: number[]): number {
  if (sortedX.length < 2) return 0;
  const diffs: number[] = [];
  for (let i = 1; i < sortedX.length; i++) {
    diffs.push(sortedX[i] - sortedX[i - 1]);
  }
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

/**
 * For a single series, find x-positions where the gap between consecutive
 * data points exceeds `gapThreshold` times the typical step interval.
 * Returns the set of x-values to insert as gap markers (midpoint of each gap).
 */
function findGapMarkers(
  sortedX: number[],
  gapThreshold: number = 2,
): number[] {
  if (sortedX.length < 2) return [];
  const interval = detectStepInterval(sortedX);
  if (interval <= 0) return [];

  const markers: number[] = [];
  for (let i = 1; i < sortedX.length; i++) {
    const diff = sortedX[i] - sortedX[i - 1];
    if (diff > interval * gapThreshold) {
      // Insert a gap marker just after the last valid point
      markers.push(sortedX[i - 1] + interval);
    }
  }
  return markers;
}

/**
 * Convert LineData[] to uPlot's AlignedData format.
 * Collects all unique x values, sorts them, and creates aligned y arrays
 * with nulls where a series has no value at that step.
 *
 * When `spanGaps` is false, detects gaps in each series' x-values and inserts
 * explicit null markers so uPlot breaks lines at data gaps. This is essential
 * for single-series charts where the data simply omits missing steps rather
 * than having nulls at a shared x-axis position.
 */
export function alignDataForUPlot(
  processedLines: LineData[],
  options?: { spanGaps?: boolean },
): uPlot.AlignedData {
  if (processedLines.length === 0) {
    return [[]] as uPlot.AlignedData;
  }

  const spanGaps = options?.spanGaps ?? true;

  // Collect all unique x values
  const xSet = new Set<number>();
  processedLines.forEach((line) => {
    line.x.forEach((x) => xSet.add(x));
  });

  // When spanGaps is false, detect gaps in the data and insert null markers
  // so uPlot breaks lines at missing data regions.
  //
  // Gap detection is only needed when all series share the same x-values
  // (single-run view, possibly with smoothed/envelope companion series).
  // In comparison view, multiple runs have different x-values, and the
  // alignment step already produces nulls wherever a series lacks data at a
  // shared x-position — no gap markers needed.
  //
  // We detect the "same x-values" case by checking if ALL series have exactly
  // the same x-array length. Companion series (smoothed, original, envelope)
  // always share the base series' x-array, while different runs almost never
  // have the exact same number of data points.
  if (!spanGaps && processedLines.length > 0) {
    const firstLen = processedLines[0].x.length;
    const allSameLength = processedLines.every((l) => l.x.length === firstLen);

    if (allSameLength) {
      // Use the first series to detect gaps (all share the same x-values)
      const line = processedLines[0];
      if (line.x.length >= 2) {
        const sorted = [...line.x].sort((a, b) => a - b);
        const markers = findGapMarkers(sorted);
        for (const m of markers) {
          xSet.add(m);
        }
      }
    }
  }

  const xValues = Array.from(xSet).sort((a, b) => a - b);

  // Create maps for efficient lookup
  const lineMaps = processedLines.map((line) => {
    const map = new Map<number, number>();
    line.x.forEach((x, i) => map.set(x, line.y[i]));
    return map;
  });

  // Build aligned data arrays
  const data: uPlot.AlignedData = [xValues];
  lineMaps.forEach((map, lineIdx) => {
    const flags = processedLines[lineIdx].valueFlags;
    const yValues = xValues.map((x) => {
      const y = map.get(x);
      if (y === undefined) return null;
      // Substitute null for non-finite flagged values to create gaps in the line
      if (flags && flags.has(x)) return null;
      return y;
    });
    data.push(yValues as (number | null)[]);
  });

  return data;
}
