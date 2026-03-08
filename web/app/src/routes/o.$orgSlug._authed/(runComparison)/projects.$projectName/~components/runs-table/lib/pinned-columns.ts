import type { ColumnConfig } from "../../../~hooks/use-column-config";

// Base columns always pinned to the left (select, status, name)
export const BASE_PINNED_IDS = ["select", "status", "name"] as const;

/** Build the TanStack Table column ID for a custom column config entry. */
export function getColumnTableId(col: ColumnConfig): string {
  return col.source === "metric" && col.aggregation
    ? `custom-${col.source}-${col.id}-${col.aggregation}`
    : `custom-${col.source}-${col.id}`;
}

/** Compute the set of all pinned column IDs (base + user-pinned custom columns). */
export function computePinnedColumnIds(customColumns: ColumnConfig[]): Set<string> {
  const ids = new Set<string>(BASE_PINNED_IDS);
  for (const col of customColumns) {
    if (col.isPinned) {
      ids.add(getColumnTableId(col));
    }
  }
  return ids;
}

/** Compute column ordering: base pinned → custom pinned → custom unpinned. */
export function computeColumnOrder(customColumns: ColumnConfig[]): string[] {
  const basePinned = [...BASE_PINNED_IDS] as string[];
  const customPinned: string[] = [];
  const customUnpinned: string[] = [];
  for (const col of customColumns) {
    const colTableId = getColumnTableId(col);
    if (col.isPinned) {
      customPinned.push(colTableId);
    } else {
      customUnpinned.push(colTableId);
    }
  }
  return [...basePinned, ...customPinned, ...customUnpinned];
}
