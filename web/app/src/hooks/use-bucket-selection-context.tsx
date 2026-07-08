import { createContext, useContext } from "react";

/** Bucket-tree selection / chart-visibility signal, derived client-side
 *  in GroupedBucketTree from `selectedRunsWithColors` + `hiddenRunIds`
 *  via `computeRunGroupTrail`. Two sets, both keyed by leaf pathKey
 *  (JSON-stringified `[{field, value}, …]` trail):
 *
 *  - `selected` — leaf pathKey has AT LEAST ONE run in the selection
 *    (regardless of per-run hide state).
 *  - `visible` — leaf pathKey has AT LEAST ONE run that is in the
 *    selection AND NOT in `hiddenRunIds`. This is what the chart
 *    actually draws lines for.
 *
 *  Bucket headers use both to render a 3-state eye:
 *    - !selected                                  → gray Eye  (deselected)
 *    - selected && !visible (all per-run hidden)  → closed Eye (selected+hidden)
 *    - selected && visible                        → open Eye  (selected+visible)
 *  Group-level toggle hide (`hiddenGroupPaths`) is an additional
 *  override layered on top of these. */
export interface BucketSelectionSignal {
  selected: ReadonlySet<string>;
  visible: ReadonlySet<string>;
  /** Deselect every run whose leaf pathKey is at or below
   *  `bucketPathKey`. Mirrors the per-run X button (handleDeselect
   *  in columns.tsx) but fanned out across the bucket's descendants.
   *  No-op when called with an empty signal (flat mode). */
  deselectBucket: (bucketPathKey: string) => void;
  /** Select every run whose leaf pathKey is at or below the bucket
   *  identified by `bucketFilters`. Fires a `runs.list` fetch with
   *  those filters and adds each returned run to the selection.
   *  Used by the bucket-header eye when clicked in the "deselected"
   *  state — turns it into a "select all in this group" action. */
  selectAllInBucket: (
    bucketFilters: Array<{ field: string; value: string | null }>,
  ) => Promise<void>;
  /** Bulk-set the chart visibility of every selected descendant run
   *  of `bucketPathKey`. Fanned out across `hiddenRunIds` so a single
   *  child can later override the group state (per-run eye unhides
   *  just that one). No-op when the bucket has no selected runs. */
  setBucketHidden: (bucketPathKey: string, hidden: boolean) => void;
}

const EMPTY_SIGNAL: BucketSelectionSignal = {
  selected: new Set<string>(),
  visible: new Set<string>(),
  deselectBucket: () => {},
  selectAllInBucket: async () => {},
  setBucketHidden: () => {},
};

const BucketSelectionContext =
  createContext<BucketSelectionSignal>(EMPTY_SIGNAL);

export const BucketSelectionProvider = BucketSelectionContext.Provider;

export function useBucketSelectionSignal(): BucketSelectionSignal {
  return useContext(BucketSelectionContext);
}

/** True iff some leaf pathKey in the given set is at or below
 *  `bucketPathKey`. O(1) when called on the precomputed
 *  `coveredSelected` / `coveredVisible` sets in BucketSelectionSignal
 *  (each ancestor pathKey is already in the set). Falls back to the
 *  O(N) prefix scan if the caller passes a raw leaf-keys set. */
export function isBucketCovered(
  bucketPathKey: string,
  keys: ReadonlySet<string>,
): boolean {
  if (keys.size === 0) return false;
  return keys.has(bucketPathKey);
}
