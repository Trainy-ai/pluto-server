import { useMemo } from "react";
import uPlot from "uplot";
import { arrayMin, arrayMax } from "../lib/data-processing";

/**
 * Pre-calculate y-axis range from actual data, with IQR-based outlier detection.
 * Returns [min, max, isOutlierAware] where isOutlierAware indicates the range
 * was narrowed to exclude statistical outliers.
 */
export function useYRange(
  uplotData: uPlot.AlignedData,
  logYAxis: boolean,
  outlierDetection: boolean,
): [number, number, boolean] {
  return useMemo<[number, number, boolean]>(() => {
    // Skip for log scale (handled by distr: 3)
    if (logYAxis) return [0, 1, false];

    // Collect all y values from uplotData
    const allYValues: number[] = [];
    for (let i = 1; i < uplotData.length; i++) {
      const series = uplotData[i] as (number | null)[];
      for (const v of series) {
        if (v !== null && Number.isFinite(v)) {
          allYValues.push(v);
        }
      }
    }

    // Default range if no valid data
    if (allYValues.length === 0) {
      return [0, 1, false];
    }

    const dataMin = arrayMin(allYValues);
    const dataMax = arrayMax(allYValues);
    const fullRange = dataMax - dataMin;

    // IQR-based outlier detection: focus Y-axis on normal data range
    // when extreme outliers (rare spikes) would otherwise squish the main data.
    let effectiveMin = dataMin;
    let effectiveMax = dataMax;

    if (outlierDetection && allYValues.length >= 20) {
      const sorted = [...allYValues].sort((a, b) => a - b);
      const n = sorted.length;
      const q1 = sorted[Math.floor(n * 0.25)];
      const q3 = sorted[Math.floor(n * 0.75)];
      const iqr = q3 - q1;

      if (iqr > 0) {
        const lowerFence = q1 - 1.5 * iqr;
        const upperFence = q3 + 1.5 * iqr;
        const fencedRange = upperFence - lowerFence;

        let outlierCount = 0;
        for (const v of allYValues) {
          if (v < lowerFence || v > upperFence) {
            outlierCount++;
          }
        }

        const outlierRatio = outlierCount / allYValues.length;

        // Activate outlier-aware range only when:
        // - Full range is >3x the fenced range (spikes dominate the axis)
        // - Outliers are <5% of data (truly rare spikes, not bimodal data)
        if (fullRange > 3 * fencedRange && outlierRatio < 0.05) {
          effectiveMin = lowerFence;
          effectiveMax = upperFence;
        }
      }
    }

    const range = effectiveMax - effectiveMin;
    const dataMagnitude = Math.max(Math.abs(effectiveMax), Math.abs(effectiveMin), 0.1);

    // Ensure minimum visible range of 10% of data magnitude
    const minRange = dataMagnitude * 0.1;

    let yMin: number, yMax: number;

    if (range < minRange) {
      const center = (effectiveMin + effectiveMax) / 2;
      const halfRange = minRange / 2;
      yMin = center - halfRange;
      yMax = center + halfRange;

      // Don't show negative values if all data is non-negative
      if (effectiveMin >= 0 && yMin < 0) {
        yMin = 0;
        yMax = minRange;
      }
    } else {
      // Add 10% padding for outlier-aware range, 5% for normal range
      const isOutlierAware = effectiveMin !== dataMin || effectiveMax !== dataMax;
      const paddingFactor = isOutlierAware ? 0.10 : 0.05;
      const padding = range * paddingFactor;
      yMin = effectiveMin - padding;
      yMax = effectiveMax + padding;

      // Don't show negative values if all data is non-negative
      if (dataMin >= 0 && yMin < 0) {
        yMin = 0;
      }
    }

    const isOutlierAwareResult = effectiveMin !== dataMin || effectiveMax !== dataMax;
    return [yMin, yMax, isOutlierAwareResult];
  }, [uplotData, logYAxis, outlierDetection]);
}
