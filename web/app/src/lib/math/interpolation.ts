export type TooltipInterpolation = "none" | "linear" | "last";

/**
 * Interpolates a missing (null) value at the given index in aligned chart data.
 *
 * When comparing experiments that log at different step frequencies,
 * the aligned data will have nulls where a series didn't log at a particular x value.
 * This function fills in those gaps for tooltip display.
 *
 * @param xValues - The shared x-axis values (no nulls)
 * @param yValues - The y-axis values for one series (may contain nulls)
 * @param idx - The index at which to interpolate
 * @param mode - Interpolation mode: "linear" or "last"
 * @returns The interpolated value, or null if interpolation isn't possible
 */
export function interpolateValue(
  xValues: number[],
  yValues: (number | null | undefined)[],
  idx: number,
  mode: "linear" | "last",
): number | null {
  // If there's already a value, no interpolation needed
  const currentVal = yValues[idx];
  if (currentVal != null) {
    return currentVal;
  }

  // Find the nearest non-null value to the left
  let leftIdx: number | null = null;
  for (let i = idx - 1; i >= 0; i--) {
    if (yValues[i] != null) {
      leftIdx = i;
      break;
    }
  }

  if (mode === "last") {
    // Forward-fill: use the last known value
    if (leftIdx !== null) {
      return yValues[leftIdx] as number;
    }
    return null;
  }

  // Linear interpolation: need both left and right neighbors
  let rightIdx: number | null = null;
  for (let i = idx + 1; i < yValues.length; i++) {
    if (yValues[i] != null) {
      rightIdx = i;
      break;
    }
  }

  if (leftIdx === null || rightIdx === null) {
    // Can't interpolate at edges - only between known points
    return null;
  }

  const x0 = xValues[leftIdx];
  const x1 = xValues[rightIdx];
  const y0 = yValues[leftIdx] as number;
  const y1 = yValues[rightIdx] as number;
  const x = xValues[idx];

  // Avoid division by zero (shouldn't happen with sorted unique x values, but be safe)
  if (x1 === x0) {
    return y0;
  }

  // Linear interpolation: y = y0 + (y1 - y0) * (x - x0) / (x1 - x0)
  const t = (x - x0) / (x1 - x0);
  return y0 + (y1 - y0) * t;
}
