import { arrayMin, arrayMax } from "./data-processing";

/** Check if a zoom range [min, max] overlaps with the data in an x-axis array. */
export function zoomOverlapsData(zoom: [number, number], xData: readonly number[]): boolean {
  if (xData.length === 0) return false;
  const dataMin = arrayMin(xData as number[]);
  const dataMax = arrayMax(xData as number[]);
  return zoom[0] < dataMax && zoom[1] > dataMin;
}

