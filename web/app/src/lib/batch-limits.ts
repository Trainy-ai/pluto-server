/**
 * Max runs one batched request may cover. Mirrors the `runIds` cap the batch
 * procedures share — `z.array(z.string()).max(200)` on graphBatchBucketed,
 * graphMultiMetricBatchBucketed, graphBatch, and `MAX_RUNS_PER_BATCH` on
 * filesBatch / histogramBatch / barsDataBatch. Past it the server rejects the
 * whole request with a zod `too_big` error, so widgets check the count before
 * querying and explain the limit instead of failing.
 *
 * Keep in sync with `MAX_RUNS_PER_BATCH` in
 * server/trpc/routers/runs/routers/data/procs/histogram.schema.ts.
 */
export const MAX_RUNS_PER_BATCH = 200;

/** What a chart's limits work out to for a given metric/run count. */
export interface ChartLimit {
  /** Series (metrics × runs) the chart may draw before it refuses. */
  effectiveMaxSeries: number;
  overLimit: boolean;
  /**
   * True when the server's run cap is the binding limit rather than the user's
   * maxSeries. Only then is "drop to N runs" sufficient advice — when maxSeries
   * binds first, dropping runs alone can still leave the chart over budget.
   */
  isRunBound: boolean;
}

/**
 * Resolve a chart's two limits into one number.
 *
 * The batch endpoints cap `runIds` at MAX_RUNS_PER_BATCH per request, which on
 * a chart of M metrics is a ceiling of `MAX_RUNS_PER_BATCH * M` series — since
 * series = metrics × runs, "runs > cap" and "series > cap × M" are the same
 * condition. Expressing both limits in series lets the chart report a single
 * count that never contradicts the max-series setting.
 *
 * Checking only maxSeries (default 500) was the original bug: 460 runs on a
 * single-metric chart is 460 series, under 500, so the request went out and the
 * server rejected it.
 */
export function resolveChartLimit(params: {
  /** Number of metrics on the chart (0 is treated as 1 — the title metric). */
  metricCount: number;
  /** Series the chart wants to draw, i.e. metrics × runs. */
  seriesCount: number;
  /** The user's max-series setting; 0 means "no limit". */
  maxSeries: number;
}): ChartLimit {
  const { metricCount, seriesCount, maxSeries } = params;
  const runDerivedMaxSeries = MAX_RUNS_PER_BATCH * Math.max(1, metricCount);
  const effectiveMaxSeries =
    maxSeries > 0 ? Math.min(maxSeries, runDerivedMaxSeries) : runDerivedMaxSeries;
  return {
    effectiveMaxSeries,
    overLimit: seriesCount > effectiveMaxSeries,
    isRunBound: effectiveMaxSeries === runDerivedMaxSeries,
  };
}
