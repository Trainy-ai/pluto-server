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

export const CUSTOM_SECTION_KEY_PREFIX = "custom:";

export const EMPTY_CHARTS_LAYOUT: ChartsLayoutConfig = {
  version: 2,
  order: [],
  hidden: [],
  metricOrder: {},
  customSections: [],
  membership: {},
};

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
 * Apply a saved per-group chart order to a group's metric list. Same
 * semantics (and same reference-preserving fast path) as group ordering.
 */
export function orderGroupMetrics<T extends { name: string }>(
  metrics: T[],
  savedOrder: string[] | null | undefined,
): T[] {
  return sortBySavedOrder(metrics, (m) => m.name, savedOrder);
}

export interface SectionSource<TItem> {
  key: string;
  groupName: string;
  items: TItem[];
}

export interface LaidOutSection<TItem> {
  key: string;
  groupName: string;
  /** Items after membership re-homing, pre-`metricOrder` — apply orderGroupMetrics on top. */
  items: TItem[];
  hidden: boolean;
  isCustom: boolean;
}

function sameItems<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/**
 * Membership-and-sections layer of the layout overlay: re-homes items whose
 * `membership` entry points at another (still existing) section, materializes
 * the user's custom sections, then applies the saved order and hidden flags.
 * Invalid membership targets fall back to the derived home, so the overlay
 * degrades gracefully as sections come and go. Untouched sections reuse the
 * source `items` array by reference for memoized consumers.
 */
export function applyChartsSections<TItem>(
  sources: Array<SectionSource<TItem>>,
  nameOf: (item: TItem) => string,
  layout: ChartsLayoutConfig | null | undefined,
  opts?: { keepEmpty?: boolean },
): Array<LaidOutSection<TItem>> {
  const membership = layout?.membership ?? {};
  const hiddenSet = new Set(layout?.hidden ?? []);
  const keepEmpty = opts?.keepEmpty ?? false;

  const sourceKeys = new Set(sources.map((s) => s.key));
  // Colliding custom sections (same key as a derived section) are ignored; their items
  // won't be collected and membership entries targeting them degrade to the derived section.
  const customSections = (layout?.customSections ?? []).filter(
    (s) => !sourceKeys.has(s.key),
  );

  const validKeys = new Set(sourceKeys);
  customSections.forEach((s) => validKeys.add(s.key));

  const itemsByKey = new Map<string, TItem[]>();
  validKeys.forEach((key) => itemsByKey.set(key, []));

  // First pass: add items that stay in their original section
  sources.forEach((s) => {
    s.items.forEach((item) => {
      const target = membership[nameOf(item)];
      if (!target || target === s.key || !validKeys.has(target)) {
        itemsByKey.get(s.key)!.push(item);
      }
    });
  });

  // Second pass: add items that are being re-homed
  sources.forEach((s) => {
    s.items.forEach((item) => {
      const target = membership[nameOf(item)];
      if (target && target !== s.key && validKeys.has(target)) {
        itemsByKey.get(target)!.push(item);
      }
    });
  });

  const derived: Array<LaidOutSection<TItem>> = sources.map((s) => {
    const collected = itemsByKey.get(s.key)!;
    return {
      key: s.key,
      groupName: s.groupName,
      items: sameItems(collected, s.items) ? s.items : collected,
      hidden: hiddenSet.has(s.key),
      isCustom: false,
    };
  });
  const custom: Array<LaidOutSection<TItem>> = customSections.map((s) => ({
    key: s.key,
    groupName: s.name,
    items: itemsByKey.get(s.key)!,
    hidden: hiddenSet.has(s.key),
    isCustom: true,
  }));

  return sortBySavedOrder([...derived, ...custom], (s) => s.key, layout?.order).filter(
    (s) => keepEmpty || s.items.length > 0,
  );
}
