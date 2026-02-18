/**
 * Downsampling with min/max envelope preservation.
 *
 * Combines LTTB (Largest-Triangle-Three-Buckets) for visual fidelity
 * with per-bucket min/max tracking so anomalies are never lost.
 */

export interface EnvelopeData {
  /** LTTB-selected x values (bucket representatives) */
  x: number[];
  /** LTTB-selected y values (the "line") */
  y: number[];
  /** Min y value in each bucket */
  yMin: number[];
  /** Max y value in each bucket */
  yMax: number[];
}

/**
 * Downsample data using LTTB while tracking min/max envelopes per bucket.
 *
 * The returned yMin/yMax arrays guarantee that ALL anomalies (spikes/dips)
 * survive downsampling — they show up as wide envelope bands even when the
 * LTTB representative point doesn't land on the exact anomaly.
 *
 * @param xData - Array of x-values (must be sorted ascending)
 * @param yData - Array of y-values (same length as xData)
 * @param targetPoints - Target number of output points
 * @returns EnvelopeData with LTTB line + min/max envelope
 */
export function downsampleWithEnvelope(
  xData: number[],
  yData: number[],
  targetPoints: number,
): EnvelopeData {
  const dataLength = xData.length;

  // If we have fewer points than target, or target is 0 (no limit), return raw data
  if (targetPoints <= 0 || dataLength <= targetPoints) {
    return {
      x: xData.slice(),
      y: yData.slice(),
      yMin: yData.slice(),
      yMax: yData.slice(),
    };
  }

  // Need at least 3 points for LTTB
  if (targetPoints < 3) {
    const x = [xData[0], xData[dataLength - 1]];
    const y = [yData[0], yData[dataLength - 1]];
    // Compute global min/max for envelope
    let globalMin = Infinity;
    let globalMax = -Infinity;
    for (let i = 0; i < dataLength; i++) {
      if (yData[i] < globalMin) globalMin = yData[i];
      if (yData[i] > globalMax) globalMax = yData[i];
    }
    return {
      x,
      y,
      yMin: [Math.min(yData[0], globalMin), Math.min(yData[dataLength - 1], globalMin)],
      yMax: [Math.max(yData[0], globalMax), Math.max(yData[dataLength - 1], globalMax)],
    };
  }

  const sampledX: number[] = [];
  const sampledY: number[] = [];
  const sampledYMin: number[] = [];
  const sampledYMax: number[] = [];

  // Always include first point
  sampledX.push(xData[0]);
  sampledY.push(yData[0]);
  sampledYMin.push(yData[0]);
  sampledYMax.push(yData[0]);

  // Bucket size (how many raw points per output bucket)
  const bucketSize = (dataLength - 2) / (targetPoints - 2);

  let a = 0; // Index of previously selected point

  for (let i = 0; i < targetPoints - 2; i++) {
    // Calculate bucket boundaries
    const bucketStart = Math.floor(1 + i * bucketSize);
    const bucketEnd = Math.min(Math.floor(1 + (i + 1) * bucketSize), dataLength - 1);

    // Next bucket for average calculation (LTTB lookahead)
    const nextBucketEnd = Math.min(
      Math.floor(1 + (i + 2) * bucketSize),
      dataLength - 1,
    );

    // Calculate average of next bucket (for triangle calculation)
    let avgX = 0;
    let avgY = 0;
    let avgCount = 0;
    for (let j = bucketEnd; j < nextBucketEnd; j++) {
      avgX += xData[j];
      avgY += yData[j];
      avgCount++;
    }
    if (avgCount > 0) {
      avgX /= avgCount;
      avgY /= avgCount;
    }

    // Find point in current bucket with largest triangle area (LTTB selection)
    // AND track min/max for envelope
    let maxArea = -1;
    let maxAreaIndex = bucketStart;
    let bucketMin = Infinity;
    let bucketMax = -Infinity;

    const pointAX = xData[a];
    const pointAY = yData[a];

    for (let j = bucketStart; j < bucketEnd && j < dataLength - 1; j++) {
      // Track envelope
      if (yData[j] < bucketMin) bucketMin = yData[j];
      if (yData[j] > bucketMax) bucketMax = yData[j];

      // LTTB: Calculate triangle area using cross product
      const area = Math.abs(
        (pointAX - avgX) * (yData[j] - pointAY) -
          (pointAX - xData[j]) * (avgY - pointAY),
      );

      if (area > maxArea) {
        maxArea = area;
        maxAreaIndex = j;
      }
    }

    // Handle empty buckets (shouldn't happen, but safety)
    if (bucketMin === Infinity) {
      bucketMin = yData[maxAreaIndex];
      bucketMax = yData[maxAreaIndex];
    }

    sampledX.push(xData[maxAreaIndex]);
    sampledY.push(yData[maxAreaIndex]);
    sampledYMin.push(bucketMin);
    sampledYMax.push(bucketMax);

    a = maxAreaIndex;
  }

  // Always include last point
  sampledX.push(xData[dataLength - 1]);
  sampledY.push(yData[dataLength - 1]);
  sampledYMin.push(yData[dataLength - 1]);
  sampledYMax.push(yData[dataLength - 1]);

  return {
    x: sampledX,
    y: sampledY,
    yMin: sampledYMin,
    yMax: sampledYMax,
  };
}
