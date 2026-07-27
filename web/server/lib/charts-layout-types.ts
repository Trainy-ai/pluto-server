import { z } from "zod";

/**
 * Persisted layout overlay for the default "Charts" (All Metrics) view.
 *
 * The Charts view auto-groups every metric on the fly; this overlay is applied
 * on top of that computed grouping so newly logged metrics still appear
 * automatically. It only records *intent* keyed by group id:
 *
 * - `order`      — group keys in the user's preferred order. Groups not listed
 *                  fall back to the default sort order and are appended.
 * - `hidden`     — group keys the user has hidden from the view.
 * - `metricOrder`— per-group metric (chart) names in the user's preferred
 *                  order, keyed by group key. Metrics not listed keep their
 *                  default position after the ordered ones.
 * - `customSections` — user-created sections layered on top of the derived
 *                      grouping. Keys are prefixed "custom:".
 * - `membership`     — per-chart section overrides (metricName → sectionKey).
 *                      Entries pointing at a section that no longer exists are
 *                      ignored at render time and pruned on the next save.
 *
 * Collapse is intentionally NOT part of this shared overlay: sections always
 * start expanded so users can confirm ingestion at a glance, and per-user
 * collapse remains a local (localStorage) preference.
 *
 * Unknown keys (e.g. a group or metric that no longer exists) are ignored at
 * render time, so the overlay degrades gracefully as metrics come and go.
 * `metricOrder` defaults to `{}`, so rows saved before it existed still parse.
 */
export const ChartsCustomSectionSchema = z.object({
  /** Stable key, prefixed "custom:" so it can never collide with a derived group key. */
  key: z.string(),
  /** User-visible, renamable label. */
  name: z.string(),
});

export const ChartsLayoutConfigSchema = z.object({
  // v1 rows predate customSections/membership; both versions parse, defaults
  // fill the gaps, and the first save after an edit writes v2.
  version: z.union([z.literal(1), z.literal(2)]).default(2),
  order: z.array(z.string()).default([]),
  hidden: z.array(z.string()).default([]),
  metricOrder: z.record(z.string(), z.array(z.string())).default({}),
  /** User-created sections, materialized on top of the derived grouping. */
  customSections: z.array(ChartsCustomSectionSchema).default([]),
  /** metricName → sectionKey overrides for charts moved out of their derived home. */
  membership: z.record(z.string(), z.string()).default({}),
});

export type ChartsLayoutConfig = z.infer<typeof ChartsLayoutConfigSchema>;

export function createEmptyChartsLayoutConfig(): ChartsLayoutConfig {
  return {
    version: 2,
    order: [],
    hidden: [],
    metricOrder: {},
    customSections: [],
    membership: {},
  };
}
