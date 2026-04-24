/**
 * Pure helpers for the useMetricSummaries accumulator. Kept in their
 * own module so tests can import them without transitively loading
 * `@/utils/trpc`, which validates env at import time.
 */

/**
 * Should the accumulator be discarded given a metric-spec change?
 *
 * Wipe iff the new spec set introduces a metric the accumulator hasn't
 * fetched values for. Pure removals — or no-op renders where the sets
 * are identical — leave the accumulator alone, so removing a metric
 * column never triggers a refetch and re-adding a removed column is
 * served instantly from cache.
 */
export function metricSpecRequiresWipe(
  prevKeys: ReadonlySet<string>,
  currKeys: ReadonlySet<string>,
): boolean {
  for (const key of currKeys) {
    if (!prevKeys.has(key)) return true;
  }
  return false;
}
