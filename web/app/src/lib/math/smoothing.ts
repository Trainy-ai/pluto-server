export type SmoothingAlgorithm = "twema" | "gaussian" | "running" | "ema";

/**
 * Smooths y-data according to the selected algorithm.
 *
 * @param xData - Array of x-values (strictly increasing).
 * @param yData - Array of y-values to smooth (same length as xData).
 * @param algorithm - One of 'twema', 'gaussian', 'running', or 'ema'.
 * @param parameter - Tuning parameter for the algorithm:
 *   - twema: time constant (in same units as xData)
 *   - gaussian: sigma (standard deviation of kernel)
 *   - running: window size (number of points)
 *   - ema: smoothing factor alpha (0 < alpha < 1)
 * @returns A new array of smoothed y-values.
 */
export const smoothData = (
  xData: number[],
  yData: number[],
  algorithm: SmoothingAlgorithm,
  parameter: number,
): number[] => {
  if (xData.length !== yData.length) {
    throw new Error("xData and yData must have the same length");
  }
  switch (algorithm) {
    case "twema":
      return smoothTWEMA(xData, yData, parameter);
    case "gaussian":
      return smoothGaussian(yData, parameter);
    case "running":
      return smoothRunning(yData, Math.round(parameter));
    case "ema":
      return smoothEMA(yData, parameter);
    default:
      throw new Error(`Unsupported algorithm: ${algorithm}`);
  }
};

// Time-Weighted Exponential Moving Average
function smoothTWEMA(x: number[], y: number[], timeConstant: number): number[] {
  const n = y.length;
  const result = new Array<number>(n);
  if (n === 0) return result;
  result[0] = y[0];
  for (let i = 1; i < n; i++) {
    const dt = x[i] - x[i - 1];
    const alpha = 1 - Math.exp(-dt / timeConstant);
    result[i] = alpha * y[i] + (1 - alpha) * result[i - 1];
  }
  return result;
}

// Standard Exponential Moving Average (EMA) with fixed alpha
function smoothEMA(y: number[], alpha: number): number[] {
  if (alpha === 0) {
    return y;
  }
  if (alpha <= 0 || alpha > 1) {
    throw new Error("EMA parameter alpha must be in (0, 1]");
  }
  const n = y.length;
  const result = new Array<number>(n);
  if (n === 0) return result;
  result[0] = y[0];
  for (let i = 1; i < n; i++) {
    result[i] = alpha * y[i] + (1 - alpha) * result[i - 1];
  }
  return result;
}

// Simple running (moving) average over a fixed window length
function smoothRunning(y: number[], windowSize: number): number[] {
  const n = y.length;
  const result = new Array<number>(n);
  if (n === 0 || windowSize <= 1) {
    return [...y];
  }
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += y[i];
    if (i >= windowSize) {
      sum -= y[i - windowSize];
    }
    const count = Math.min(i + 1, windowSize);
    result[i] = sum / count;
  }
  return result;
}

// Gaussian smoothing via convolution with a Gaussian kernel
function smoothGaussian(y: number[], sigma: number): number[] {
  const n = y.length;
  const result = new Array<number>(n);
  if (n === 0 || sigma <= 0) return [...y];

  // Determine kernel radius = 3 * sigma
  const radius = Math.ceil(3 * sigma);
  const size = radius * 2 + 1;

  // Precompute Gaussian kernel
  const kernel = new Array<number>(size);
  const denom = 2 * sigma * sigma;
  let sum = 0;
  for (let k = -radius; k <= radius; k++) {
    const value = Math.exp(-(k * k) / denom);
    kernel[k + radius] = value;
    sum += value;
  }
  // Normalize kernel
  for (let i = 0; i < size; i++) {
    kernel[i] /= sum;
  }

  // Convolve, handling edges by extending boundary values
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = Math.min(n - 1, Math.max(0, i + k));
      acc += y[j] * kernel[k + radius];
    }
    result[i] = acc;
  }
  return result;
}

/**
 * Downsample data using the Largest-Triangle-Three-Buckets (LTTB) algorithm.
 * Preserves visual features of the data while reducing point count.
 *
 * @param xData - Array of x-values
 * @param yData - Array of y-values
 * @param targetPoints - Target number of points after downsampling
 * @returns Object with downsampled x and y arrays
 */
export function downsampleLTTB(
  xData: number[],
  yData: number[],
  targetPoints: number,
): { x: number[]; y: number[] } {
  const dataLength = xData.length;

  // If we have fewer points than target, or target is 0 (no limit), return original
  if (targetPoints <= 0 || dataLength <= targetPoints) {
    return { x: xData, y: yData };
  }

  // Need at least 3 points for LTTB
  if (targetPoints < 3) {
    return {
      x: [xData[0], xData[dataLength - 1]],
      y: [yData[0], yData[dataLength - 1]],
    };
  }

  const sampledX: number[] = [];
  const sampledY: number[] = [];

  // Always include first point
  sampledX.push(xData[0]);
  sampledY.push(yData[0]);

  // Bucket size
  const bucketSize = (dataLength - 2) / (targetPoints - 2);

  let a = 0; // Index of previously selected point
  let nextBucketStart = 1;

  for (let i = 0; i < targetPoints - 2; i++) {
    // Calculate bucket boundaries
    const bucketStart = Math.floor(nextBucketStart);
    const bucketEnd = Math.floor(nextBucketStart + bucketSize);
    const nextBucketEnd = Math.min(
      Math.floor(nextBucketStart + 2 * bucketSize),
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

    // Find point in current bucket with largest triangle area
    let maxArea = -1;
    let maxAreaIndex = bucketStart;

    const pointAX = xData[a];
    const pointAY = yData[a];

    for (let j = bucketStart; j < bucketEnd && j < dataLength - 1; j++) {
      // Calculate triangle area using cross product
      const area = Math.abs(
        (pointAX - avgX) * (yData[j] - pointAY) -
          (pointAX - xData[j]) * (avgY - pointAY),
      );

      if (area > maxArea) {
        maxArea = area;
        maxAreaIndex = j;
      }
    }

    sampledX.push(xData[maxAreaIndex]);
    sampledY.push(yData[maxAreaIndex]);

    a = maxAreaIndex;
    nextBucketStart += bucketSize;
  }

  // Always include last point
  sampledX.push(xData[dataLength - 1]);
  sampledY.push(yData[dataLength - 1]);

  return { x: sampledX, y: sampledY };
}
