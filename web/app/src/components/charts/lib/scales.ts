import type uPlot from "uplot";
import { arrayMin, arrayMax } from "./data-processing";

/** Check if a zoom range [min, max] overlaps with the data in an x-axis array. */
export function zoomOverlapsData(zoom: [number, number], xData: readonly number[]): boolean {
  if (xData.length === 0) return false;
  const dataMin = arrayMin(xData as number[]);
  const dataMax = arrayMax(xData as number[]);
  return zoom[0] < dataMax && zoom[1] > dataMin;
}

/**
 * Compute data min/max from uPlot series data when uPlot passes null bounds
 * (happens when auto:false is set, since uPlot skips data range accumulation).
 * For log scale, only positive values are considered.
 */
export function computeFallbackRange(u: uPlot, isLog: boolean): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 1; i < u.data.length; i++) {
    const s = u.data[i] as (number | null | undefined)[];
    if (!s) { continue; }
    for (let j = 0; j < s.length; j++) {
      const v = s[j];
      if (v != null && Number.isFinite(v) && (!isLog || v > 0)) {
        if (v < min) { min = v; }
        if (v > max) { max = v; }
      }
    }
  }
  return min > max ? null : [min, max];
}
