/**
 * How many metrics get a curve on a sweep page. The page is a summary, not the
 * Charts tab — a run logging 40 metrics shouldn't turn it into a wall. The
 * objective is always first, so the cap only ever drops incidental metrics.
 */
export const MAX_METRIC_CHARTS = 4;

/**
 * Which metrics get a curve, in order: the sweep's objective first, then the
 * rest, capped at MAX_METRIC_CHARTS.
 *
 * Kept in its own module rather than beside the component: importing the
 * component pulls in the chart stack and `@/utils/trpc`, which validates env at
 * import time and throws under vitest.
 */
export function selectSweepChartMetrics(
  availableMetrics: string[],
  metricName: string | null,
): string[] {
  const rest = availableMetrics.filter((m) => m !== metricName);
  const ordered =
    metricName && availableMetrics.includes(metricName)
      ? [metricName, ...rest]
      : rest;
  return ordered.slice(0, MAX_METRIC_CHARTS);
}
