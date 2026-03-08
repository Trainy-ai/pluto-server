import { describe, it, expect } from "vitest";
import type { ColumnConfig } from "../../../~hooks/use-column-config";
import { getColumnTableId } from "../lib/pinned-columns";

/**
 * Characterization test for the column index mapping logic used by
 * useColumnDrag in data-table.tsx.
 *
 * This function maps a TanStack Table column ID (e.g. "custom-config-lr")
 * back to its index in the customColumns array, using getColumnTableId
 * for consistent ID generation.
 */
function getCustomIndex(
  customColumns: ColumnConfig[],
  columnId: string,
): number {
  return customColumns.findIndex(
    (col) => getColumnTableId(col) === columnId,
  );
}

function makeCol(
  source: "config" | "systemMetadata" | "metric",
  id: string,
  aggregation?: string,
): ColumnConfig {
  return { source, id, aggregation } as ColumnConfig;
}

describe("getCustomIndex (column drag mapping)", () => {
  const columns: ColumnConfig[] = [
    makeCol("config", "lr"),
    makeCol("config", "batch_size"),
    makeCol("systemMetadata", "createdAt"),
    makeCol("metric", "train/loss", "LAST"),
    makeCol("metric", "val/acc", "AVG"),
    makeCol("metric", "eval/f1"),
  ];

  it("maps config column ID to correct index", () => {
    expect(getCustomIndex(columns, "custom-config-lr")).toBe(0);
    expect(getCustomIndex(columns, "custom-config-batch_size")).toBe(1);
  });

  it("maps systemMetadata column ID to correct index", () => {
    expect(getCustomIndex(columns, "custom-systemMetadata-createdAt")).toBe(2);
  });

  it("maps metric column with aggregation suffix", () => {
    expect(getCustomIndex(columns, "custom-metric-train/loss-LAST")).toBe(3);
    expect(getCustomIndex(columns, "custom-metric-val/acc-AVG")).toBe(4);
  });

  it("maps metric column without aggregation", () => {
    expect(getCustomIndex(columns, "custom-metric-eval/f1")).toBe(5);
  });

  it("returns -1 for unknown column ID", () => {
    expect(getCustomIndex(columns, "custom-config-unknown")).toBe(-1);
  });

  it("returns -1 for non-custom column ID", () => {
    expect(getCustomIndex(columns, "name")).toBe(-1);
    expect(getCustomIndex(columns, "status")).toBe(-1);
  });

  it("returns -1 for empty columns array", () => {
    expect(getCustomIndex([], "custom-config-lr")).toBe(-1);
  });

  it("handles metric column with wrong aggregation", () => {
    // "train/loss" has aggregation "LAST", so "AVG" shouldn't match
    expect(getCustomIndex(columns, "custom-metric-train/loss-AVG")).toBe(-1);
  });
});
