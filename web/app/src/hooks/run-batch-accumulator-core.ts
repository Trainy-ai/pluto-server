// Pure logic for the run-batch accumulator (see use-run-batch-accumulator.ts).
//
// Split out from the hook — mirroring metric-summaries-cache.ts —so the
// diff/merge/select behavior can be unit-tested without dragging in React or
// React Query. The accumulator lets a widget fetch ALL its runs in one batched
// request, then on a selection change fetch only the runs it doesn't already
// have (instead of refetching everything).

/**
 * Run IDs that are selected but not yet fetched. Sorted so the derived
 * react-query key is stable regardless of selection order (adding a run in a
 * different position doesn't churn the key).
 */
export function computeMissingRunIds(
  selectedRunIds: readonly string[],
  fetched: ReadonlySet<string>,
): string[] {
  const missing: string[] = [];
  for (const id of selectedRunIds) {
    if (id && !fetched.has(id)) missing.push(id);
  }
  missing.sort();
  return missing;
}

/**
 * Merge a freshly-fetched batch (keyed by runId) into the accumulator.
 * Mutates `acc` in place (the hook holds it in a ref). Last write wins, so a
 * re-fetch of an existing run refreshes it.
 */
export function mergeRunResults<T>(
  acc: Record<string, T>,
  fresh: Record<string, T>,
): void {
  for (const runId of Object.keys(fresh)) {
    acc[runId] = fresh[runId];
  }
}

/**
 * Project the accumulator down to just the currently-selected runs, in the
 * given order. Runs with no accumulated entry (e.g. a run that returned no
 * data) are simply absent — callers treat a missing entry as "no data".
 */
export function selectAccumulated<T>(
  acc: Record<string, T>,
  selectedRunIds: readonly string[],
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const id of selectedRunIds) {
    if (Object.prototype.hasOwnProperty.call(acc, id)) out[id] = acc[id];
  }
  return out;
}
