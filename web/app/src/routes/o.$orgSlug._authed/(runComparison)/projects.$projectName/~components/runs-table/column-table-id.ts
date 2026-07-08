/** Canonical TanStack table-column id for a custom (config / systemMetadata /
 *  metric) column. This MUST be built identically everywhere — the sort code
 *  (sortRunsByColumn) matches the active sort's column id against this string,
 *  so any divergence silently turns sorting into a no-op. Extracted from the
 *  three sites (columns.tsx, data-table.tsx, use-data-table-state.ts) that had
 *  hand-copied this formula and already drifted once. */
export function columnTableId(col: {
  source: string;
  id: string;
  aggregation?: string | null;
}): string {
  return col.source === "metric" && col.aggregation
    ? `custom-metric-${col.id}-${col.aggregation}`
    : `custom-${col.source}-${col.id}`;
}
