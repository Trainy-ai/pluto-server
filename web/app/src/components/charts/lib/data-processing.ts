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
 * Convert LineData[] to uPlot's AlignedData format.
 * Collects all unique x values, sorts them, and creates aligned y arrays
 * with nulls where a series has no value at that step.
 */
export function alignDataForUPlot(processedLines: LineData[]): uPlot.AlignedData {
  if (processedLines.length === 0) {
    return [[]] as uPlot.AlignedData;
  }

  // Collect all unique x values and sort them
  const xSet = new Set<number>();
  processedLines.forEach((line) => {
    line.x.forEach((x) => xSet.add(x));
  });
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
