/**
 * Client-side helpers for the persisted layout overlay of the default
 * "Charts" (All Metrics) view.
 *
 * The overlay records only *intent* keyed by metric-group id (reorder + hide)
 * plus per-group chart order. It is applied on top of the auto-computed
 * grouping so newly logged metrics still appear automatically, and unknown
 * keys degrade gracefully as groups come and go. Collapse is deliberately
 * excluded — sections always start expanded and per-user collapse stays a
 * local preference.
 */

import type { GetChartsLayoutResponse } from "../~queries/charts-layout";

/**
 * The overlay config, derived from the server's zod schema via the tRPC
 * response type so the client can't drift from `charts-layout-types.ts`.
 */
export type ChartsLayoutConfig = GetChartsLayoutResponse["config"];

export const EMPTY_CHARTS_LAYOUT: ChartsLayoutConfig = {
  version: 1,
  order: [],
  hidden: [],
  metricOrder: {},
};

export interface LaidOutGroup<T> {
  /** Stable group key (used for ordering/hidden lookups). */
  key: string;
  /** The group payload, untouched. */
  data: T;
  /** Whether the user has hidden this group from the view. */
  hidden: boolean;
}

/**
 * Stable-sort `items` by a saved key order: keys listed in `savedOrder` come
 * first, in saved order; everything else keeps its incoming relative position
 * and is appended after. Unknown saved keys are ignored.
 *
 * Returns the input array by reference when the saved order doesn't change
 * anything, so memoized consumers don't re-render on a same-order copy.
 */
export function sortBySavedOrder<T>(
  items: T[],
  keyOf: (item: T) => string,
  savedOrder: string[] | null | undefined,
): T[] {
  if (!savedOrder || savedOrder.length === 0) {
    return items;
  }
  const orderIndex = new Map<string, number>();
  savedOrder.forEach((key, i) => orderIndex.set(key, i));

  const decorated = items.map((item, i) => ({ item, i }));
  decorated.sort((a, b) => {
    const ai = orderIndex.has(keyOf(a.item))
      ? (orderIndex.get(keyOf(a.item)) as number)
      : Number.MAX_SAFE_INTEGER;
    const bi = orderIndex.has(keyOf(b.item))
      ? (orderIndex.get(keyOf(b.item)) as number)
      : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) {
      return ai - bi;
    }
    // Preserve the original order for unlisted items (and any ties).
    return a.i - b.i;
  });

  if (decorated.every(({ item }, i) => item === items[i])) {
    return items;
  }
  return decorated.map(({ item }) => item);
}

/**
 * Apply a saved layout overlay to the default-sorted groups.
 *
 * The hidden flag is attached per group but the groups themselves are always
 * returned, so callers can choose to show hidden groups (e.g. while editing)
 * or filter them out (normal view).
 */
export function applyChartsLayout<T>(
  sortedGroups: Array<[string, T]>,
  layout: ChartsLayoutConfig | null | undefined,
): Array<LaidOutGroup<T>> {
  const hidden = new Set(layout?.hidden ?? []);
  return sortBySavedOrder(sortedGroups, ([key]) => key, layout?.order).map(
    ([key, data]) => ({
      key,
      data,
      hidden: hidden.has(key),
    }),
  );
}

/**
 * Apply a saved per-group chart order to a group's metric list. Same
 * semantics (and same reference-preserving fast path) as group ordering.
 */
export function orderGroupMetrics<T extends { name: string }>(
  metrics: T[],
  savedOrder: string[] | null | undefined,
): T[] {
  return sortBySavedOrder(metrics, (m) => m.name, savedOrder);
}
