import type { ChartResolution } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/use-line-settings";

const PIXELS_PER_BUCKET = 1; // 1:1 — max fidelity, one bucket per horizontal pixel

/** Server-side bucket limit (must match tRPC validation in graph-bucketed.ts) */
const MAX_BUCKETS = 20000;

/** Preview tier bucket count — fixed for fast first paint */
export const PREVIEW_BUCKETS = 200;

/** Named bucket counts for each resolution preset (excludes "auto" which is screen-based) */
export const RESOLUTION_PRESETS: Record<Exclude<ChartResolution, "auto">, number> = {
  high: 3000,
  max: 5000,
  ultra: 20000,
};

/** Estimate standard bucket count based on screen width and column layout */
export function estimateStandardBuckets(columns = 3): number {
  const windowWidth = typeof window !== "undefined" ? window.innerWidth : 1200;
  const available = windowWidth - 280; // sidebar
  const chartWidth = Math.max(
    200,
    (available - (columns - 1) * 16 - 64) / columns,
  );
  return Math.max(10, Math.min(MAX_BUCKETS, Math.round(chartWidth / PIXELS_PER_BUCKET)));
}

/**
 * Resolve the bucket count to request from the server based on user resolution
 * setting and smoothing state.
 *
 * "auto" uses screen-based bucket estimation regardless of smoothing state.
 * Users who want more detail can select a higher preset.
 */
export function resolveChartBuckets(
  resolution: ChartResolution,
  smoothingEnabled: boolean,
  columns?: number,
): number {
  switch (resolution) {
    case "auto":
      return estimateStandardBuckets(columns);
    case "high":
      return RESOLUTION_PRESETS.high;
    case "max":
      return RESOLUTION_PRESETS.max;
    case "ultra":
      return RESOLUTION_PRESETS.ultra;
  }
}
