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
 *
 * Collapse is intentionally NOT part of this shared overlay: sections always
 * start expanded so users can confirm ingestion at a glance, and per-user
 * collapse remains a local (localStorage) preference.
 *
 * Unknown keys (e.g. a group or metric that no longer exists) are ignored at
 * render time, so the overlay degrades gracefully as metrics come and go.
 * `metricOrder` defaults to `{}`, so rows saved before it existed still parse.
 */
export const ChartsLayoutConfigSchema = z.object({
  // Only v1 exists today; pin it until a versioned migration path is added.
  version: z.literal(1).default(1),
  order: z.array(z.string()).default([]),
  hidden: z.array(z.string()).default([]),
  metricOrder: z.record(z.string(), z.array(z.string())).default({}),
});

export type ChartsLayoutConfig = z.infer<typeof ChartsLayoutConfigSchema>;

export function createEmptyChartsLayoutConfig(): ChartsLayoutConfig {
  return { version: 1, order: [], hidden: [], metricOrder: {} };
}
