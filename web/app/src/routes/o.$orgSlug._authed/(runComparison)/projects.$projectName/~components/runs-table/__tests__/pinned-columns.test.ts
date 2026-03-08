import { describe, it, expect } from "vitest";
import type { ColumnConfig } from "../../../~hooks/use-column-config";
import {
  computePinnedColumnIds,
  computeColumnOrder,
} from "../lib/pinned-columns";

function makeCol(
  source: "config" | "systemMetadata" | "metric",
  id: string,
  opts?: { aggregation?: string; isPinned?: boolean },
): ColumnConfig {
  return {
    source,
    id,
    aggregation: opts?.aggregation,
    isPinned: opts?.isPinned,
  } as ColumnConfig;
}

// ── computePinnedColumnIds ──────────────────────────────────────────────

describe("computePinnedColumnIds", () => {
  it("always includes base pinned IDs", () => {
    const result = computePinnedColumnIds([]);
    expect(result).toEqual(new Set(["select", "status", "name"]));
  });

  it("adds user-pinned custom columns", () => {
    const cols = [
      makeCol("config", "lr", { isPinned: true }),
      makeCol("config", "batch_size"),
    ];
    const result = computePinnedColumnIds(cols);
    expect(result.has("custom-config-lr")).toBe(true);
    expect(result.has("custom-config-batch_size")).toBe(false);
  });

  it("handles pinned metric columns with aggregation", () => {
    const cols = [
      makeCol("metric", "train/loss", { aggregation: "LAST", isPinned: true }),
    ];
    const result = computePinnedColumnIds(cols);
    expect(result.has("custom-metric-train/loss-LAST")).toBe(true);
  });

  it("handles pinned metric columns without aggregation", () => {
    const cols = [makeCol("metric", "eval/f1", { isPinned: true })];
    const result = computePinnedColumnIds(cols);
    expect(result.has("custom-metric-eval/f1")).toBe(true);
  });
});

// ── computeColumnOrder ──────────────────────────────────────────────────

describe("computeColumnOrder", () => {
  it("returns only base columns when no custom columns", () => {
    expect(computeColumnOrder([])).toEqual(["select", "status", "name"]);
  });

  it("puts unpinned custom columns after base columns", () => {
    const cols = [
      makeCol("config", "lr"),
      makeCol("config", "batch_size"),
    ];
    expect(computeColumnOrder(cols)).toEqual([
      "select", "status", "name",
      "custom-config-lr",
      "custom-config-batch_size",
    ]);
  });

  it("puts pinned custom columns before unpinned", () => {
    const cols = [
      makeCol("config", "lr"),
      makeCol("config", "batch_size", { isPinned: true }),
      makeCol("systemMetadata", "createdAt"),
    ];
    expect(computeColumnOrder(cols)).toEqual([
      "select", "status", "name",
      "custom-config-batch_size", // pinned
      "custom-config-lr",         // unpinned, preserves config order
      "custom-systemMetadata-createdAt",
    ]);
  });

  it("preserves order within pinned and unpinned groups", () => {
    const cols = [
      makeCol("config", "a", { isPinned: true }),
      makeCol("config", "b"),
      makeCol("config", "c", { isPinned: true }),
      makeCol("config", "d"),
    ];
    expect(computeColumnOrder(cols)).toEqual([
      "select", "status", "name",
      "custom-config-a",  // pinned, original order
      "custom-config-c",  // pinned, original order
      "custom-config-b",  // unpinned, original order
      "custom-config-d",  // unpinned, original order
    ]);
  });

  it("formats metric columns with aggregation suffix", () => {
    const cols = [
      makeCol("metric", "loss", { aggregation: "LAST" }),
    ];
    expect(computeColumnOrder(cols)).toEqual([
      "select", "status", "name",
      "custom-metric-loss-LAST",
    ]);
  });
});
