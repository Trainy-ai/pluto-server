const PIXELS_PER_BUCKET = 1; // 1:1 — max fidelity, one bucket per horizontal pixel

/** Preview tier bucket count — fixed for fast first paint */
export const PREVIEW_BUCKETS = 200;

/** Estimate standard bucket count based on screen width and column layout */
export function estimateStandardBuckets(columns = 3): number {
  const windowWidth = typeof window !== "undefined" ? window.innerWidth : 1200;
  const available = windowWidth - 280; // sidebar
  const chartWidth = Math.max(
    200,
    (available - (columns - 1) * 16 - 64) / columns,
  );
  return Math.max(10, Math.min(5000, Math.round(chartWidth / PIXELS_PER_BUCKET)));
}
