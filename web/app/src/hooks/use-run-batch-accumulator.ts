import { useRef } from "react";
import { useQuery, type QueryKey } from "@tanstack/react-query";
import {
  computeMissingRunIds,
  mergeRunResults,
  selectAccumulated,
} from "./run-batch-accumulator-core";

export interface RunBatchAccumulatorOptions<T> {
  /** Currently-selected run IDs (SQID strings). */
  selectedRunIds: string[];
  /**
   * Changing this string WIPES the accumulator. Set it to the non-run identity
   * of the data — e.g. `${logName}|${stepCap}` or `${pathPrefix}` — so that
   * switching what's being fetched doesn't mix stale per-run data.
   */
  wipeKey: string;
  /** Stable base for the react-query key (proc name + non-run params). */
  queryKeyBase: QueryKey;
  /**
   * Fetch the given MISSING runs in ONE batched call, returning results keyed
   * by runId. Runs with no data may be omitted from the result — they're still
   * recorded as fetched so they're never re-requested.
   */
  fetchMissing: (missingRunIds: string[]) => Promise<Record<string, T>>;
  enabled?: boolean;
  staleTime?: number;
}

export interface RunBatchAccumulatorResult<T> {
  /** Accumulated data for the currently-selected runs, keyed by runId. */
  data: Record<string, T>;
  /** True only while the first batch (for runs we don't have yet) is in flight. */
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
}

/**
 * Batch-by-widget data fetching with an incremental accumulator.
 *
 * Instead of one query per run (`useQueries(runs.map(...))`) — which fires
 * widgets×runs requests and bloats the batched GET URL into 414s — this fetches
 * ALL selected runs in a single batched request, and on a selection change
 * fetches ONLY the runs not already held (the delta), merging into a kept map.
 *
 * Generalizes the run-table accumulator (`useMetricSummaries`, PR #425) into a
 * reusable hook. Pure diff/merge/select logic lives in
 * run-batch-accumulator-core.ts and is unit-tested there.
 *
 * Add 1 run → 1 small request. Remove a run → 0 requests. Revisit a selection
 * → 0 requests.
 */
export function useRunBatchAccumulator<T>({
  selectedRunIds,
  wipeKey,
  queryKeyBase,
  fetchMissing,
  enabled = true,
  staleTime = 30_000,
}: RunBatchAccumulatorOptions<T>): RunBatchAccumulatorResult<T> {
  // Accumulated per-run results, and the set of runs we've already asked about
  // (tracked separately from `acc` because a run can be "fetched" yet absent
  // from `acc` when it has no data — we must not re-request it).
  const accRef = useRef<Record<string, T>>({});
  const fetchedRef = useRef<Set<string>>(new Set());
  const wipeRef = useRef<string>(wipeKey);

  // Reset when the non-run identity changes (e.g. logName / stepCap / prefix).
  if (wipeRef.current !== wipeKey) {
    accRef.current = {};
    fetchedRef.current = new Set();
    wipeRef.current = wipeKey;
  }

  const missingRunIds = computeMissingRunIds(selectedRunIds, fetchedRef.current);

  const baseKey: unknown[] = Array.isArray(queryKeyBase)
    ? [...queryKeyBase]
    : [queryKeyBase];

  const query = useQuery({
    // missingRunIds is part of the key so each delta is its own cache entry and
    // a new run triggers a fetch for exactly that run.
    queryKey: [...baseKey, wipeKey, missingRunIds],
    queryFn: () => fetchMissing(missingRunIds),
    enabled: enabled && missingRunIds.length > 0,
    staleTime,
  });

  // Merge fresh results and record every asked-about run as fetched (including
  // ones that returned no data). Mirrors useMetricSummaries' in-render merge;
  // idempotent, so a repeat render with the same data is harmless.
  if (query.data) {
    mergeRunResults(accRef.current, query.data);
    for (const id of missingRunIds) fetchedRef.current.add(id);
  }

  const data = selectAccumulated(accRef.current, selectedRunIds);

  return {
    data,
    // Loading only matters when we have runs to fetch and nothing for them yet.
    isLoading: query.isLoading && missingRunIds.length > 0,
    isFetching: query.isFetching,
    isError: query.isError,
  };
}
