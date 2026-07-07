import { describe, it, expect } from "vitest";
import { getRowRange, getCustomColumnValue, formatCellValue } from "../columns-utils";
import type { Row } from "@tanstack/react-table";
import type { Run } from "../../../~queries/list-runs";
import type { ColumnConfig } from "../../../~hooks/use-column-config";
import { makeRun } from "./_fixtures";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Minimal TanStack Row stub — only `id` and `original` are used by getRowRange */
function makeRow(id: string): Row<Run> {
  return { id, original: makeRun(id) } as unknown as Row<Run>;
}

// ── getRowRange ──────────────────────────────────────────────────────────

describe("getRowRange", () => {
  const rows = [makeRow("A"), makeRow("B"), makeRow("C"), makeRow("D"), makeRow("E")];

  it("returns inclusive range A→D in forward order", () => {
    const range = getRowRange(rows, "A", "D");
    expect(range.map((r) => r.id)).toEqual(["A", "B", "C", "D"]);
  });

  it("returns inclusive range D→A (reversed args, same array order)", () => {
    const range = getRowRange(rows, "D", "A");
    expect(range.map((r) => r.id)).toEqual(["A", "B", "C", "D"]);
  });

  it("returns adjacent rows B→C", () => {
    const range = getRowRange(rows, "B", "C");
    expect(range.map((r) => r.id)).toEqual(["B", "C"]);
  });

  it("throws when idA === idB (foundEnd never set separately)", () => {
    expect(() => getRowRange(rows, "A", "A")).toThrow("Could not find whole row range");
  });

  it("throws when idA is missing from rows", () => {
    expect(() => getRowRange(rows, "MISSING", "B")).toThrow("Could not find whole row range");
  });

  it("throws when idB is missing from rows", () => {
    expect(() => getRowRange(rows, "A", "MISSING")).toThrow("Could not find whole row range");
  });

  it("throws on empty rows array", () => {
    expect(() => getRowRange([], "A", "B")).toThrow("Could not find whole row range");
  });
});

// ── getCustomColumnValue ─────────────────────────────────────────────────

describe("getCustomColumnValue", () => {
  describe("system columns", () => {
    it("returns createdAt date", () => {
      const run = makeRun("1");
      const col: ColumnConfig = { id: "createdAt", source: "system", label: "Created" };
      expect(getCustomColumnValue(run, col)).toBe("2025-03-01T12:00:00.000Z");
    });

    it("returns runId with prefix when project has runPrefix", () => {
      const run = makeRun("sqid123", { number: 42, project: { runPrefix: "PRJ" } });
      const col: ColumnConfig = { id: "runId", source: "system", label: "Id" };
      expect(getCustomColumnValue(run, col)).toBe("PRJ-42");
    });

    it("falls back to SQID when no prefix", () => {
      const run = makeRun("sqid123", { number: 42 });
      const col: ColumnConfig = { id: "runId", source: "system", label: "Id" };
      expect(getCustomColumnValue(run, col)).toBe("sqid123");
    });

    it("returns creator name when available", () => {
      const run = makeRun("1", { creator: { name: "Alice", email: "alice@example.com" } });
      const col: ColumnConfig = { id: "creator.name", source: "system", label: "Owner" };
      expect(getCustomColumnValue(run, col)).toBe("Alice");
    });

    it("falls back to creator email when name is null", () => {
      const run = makeRun("1", { creator: { name: null, email: "alice@example.com" } });
      const col: ColumnConfig = { id: "creator.name", source: "system", label: "Owner" };
      expect(getCustomColumnValue(run, col)).toBe("alice@example.com");
    });

    it("returns notes", () => {
      const run = makeRun("1", { notes: "experiment notes" });
      const col: ColumnConfig = { id: "notes", source: "system", label: "Notes" };
      expect(getCustomColumnValue(run, col)).toBe("experiment notes");
    });

    it('returns "-" for unknown system column', () => {
      const run = makeRun("1");
      const col: ColumnConfig = { id: "unknown-field", source: "system", label: "Unknown" };
      expect(getCustomColumnValue(run, col)).toBe("-");
    });
  });

  describe("metric columns", () => {
    it("returns metric summary value by aggregation key", () => {
      const run = makeRun("1", { metricSummaries: { "train/loss|LAST": 0.0342 } });
      const col: ColumnConfig = { id: "train/loss", source: "metric", label: "Loss", aggregation: "LAST" };
      expect(getCustomColumnValue(run, col)).toBe(0.0342);
    });

    it("returns undefined when metricSummaries is missing", () => {
      const run = makeRun("1");
      const col: ColumnConfig = { id: "train/loss", source: "metric", label: "Loss", aggregation: "LAST" };
      expect(getCustomColumnValue(run, col)).toBeUndefined();
    });
  });

  describe("config columns", () => {
    it("returns value from _flatConfig", () => {
      const run = makeRun("1", { _flatConfig: { "lr": "0.001", "batch_size": "32" } });
      const col: ColumnConfig = { id: "lr", source: "config", label: "Learning Rate" };
      expect(getCustomColumnValue(run, col)).toBe("0.001");
    });

    it("returns undefined when _flatConfig is missing", () => {
      const run = makeRun("1");
      const col: ColumnConfig = { id: "lr", source: "config", label: "Learning Rate" };
      expect(getCustomColumnValue(run, col)).toBeUndefined();
    });
  });
});

// ── formatCellValue ──────────────────────────────────────────────────────

describe("formatCellValue", () => {
  it('returns "-" for null', () => {
    const col: ColumnConfig = { id: "lr", source: "config", label: "LR" };
    expect(formatCellValue(null, col)).toBe("-");
  });

  it('returns "-" for undefined', () => {
    const col: ColumnConfig = { id: "lr", source: "config", label: "LR" };
    expect(formatCellValue(undefined, col)).toBe("-");
  });

  it("formats date column as locale string", () => {
    const col: ColumnConfig = { id: "createdAt", source: "system", label: "Created" };
    const result = formatCellValue("2025-03-01T12:00:00.000Z", col);
    // Result is locale-dependent but should contain month and day parts
    expect(result).toBeTruthy();
    expect(result).not.toBe("-");
    expect(result.length).toBeGreaterThan(5);
  });

  it("formats number via formatValue", () => {
    const col: ColumnConfig = { id: "lr", source: "config", label: "LR" };
    const result = formatCellValue(0.001, col);
    expect(result).toBeTruthy();
    expect(result).not.toBe("-");
  });

  it("returns string values as-is via formatValue", () => {
    const col: ColumnConfig = { id: "hostname", source: "systemMetadata", label: "Host" };
    expect(formatCellValue("gpu-node-01", col)).toBe("gpu-node-01");
  });

  it("falls back to String(value) for invalid date", () => {
    const col: ColumnConfig = { id: "createdAt", source: "system", label: "Created" };
    // "not-a-date" will create an Invalid Date, toLocaleString throws in some environments
    // but the catch block returns String(value)
    const result = formatCellValue("not-a-date", col);
    expect(typeof result).toBe("string");
  });
});

// ── duration (computed system column) ─────────────────────────────────────

describe("getCustomColumnValue — duration", () => {
  const durationCol: ColumnConfig = { id: "duration", source: "system", label: "Duration" };

  it("computes a finished run's duration as (end − createdAt) in ms", () => {
    // fixture: COMPLETED, created 03-01 12:00, updated 03-02 14:30 → 26h30m
    const run = makeRun("1");
    expect(getCustomColumnValue(run, durationCol)).toBe(95_400_000);
  });

  it("prefers statusUpdated over updatedAt as the end time", () => {
    // The OOM that died 90s in: terminal status change at +90s, even though
    // the row was touched again much later.
    const run = makeRun("1", {
      status: "FAILED",
      statusUpdated: "2025-03-01T12:01:30.000Z",
      updatedAt: "2025-03-05T00:00:00.000Z",
    });
    expect(getCustomColumnValue(run, durationCol)).toBe(90_000);
  });

  it("uses heartbeatAt (last metric time, not now()) as the end for a running run", () => {
    // A live run's true end is its ClickHouse heartbeat, NOT updatedAt (which
    // steady-state metric logging never advances). Here heartbeat is 03-02 14:30
    // (26h30m in) while updatedAt is stale at +1m — we must use the heartbeat.
    const run = makeRun("1", {
      status: "RUNNING",
      updatedAt: "2025-03-01T12:01:00.000Z",
      heartbeatAt: "2025-03-02T14:30:00.000Z",
    });
    expect(getCustomColumnValue(run, durationCol)).toBe(95_400_000);
  });

  it("falls back to updatedAt for a running run with no heartbeatAt yet", () => {
    // Run started before the first stale-monitor/enrichment cycle populated a
    // heartbeat → fall back to updatedAt (03-02 14:30 = 26h30m).
    const run = makeRun("1", { status: "RUNNING", heartbeatAt: null });
    expect(getCustomColumnValue(run, durationCol)).toBe(95_400_000);
  });

  it("ignores heartbeatAt for a terminal run (ends at statusUpdated)", () => {
    // heartbeatAt only governs RUNNING runs; a finished run still ends at its
    // terminal status change even if a later stray heartbeat exists.
    const run = makeRun("1", {
      status: "FAILED",
      statusUpdated: "2025-03-01T12:01:30.000Z",
      updatedAt: "2025-03-05T00:00:00.000Z",
      heartbeatAt: "2025-03-06T00:00:00.000Z",
    });
    expect(getCustomColumnValue(run, durationCol)).toBe(90_000);
  });

  it("is deterministic across calls (no wall-clock dependency)", () => {
    const run = makeRun("1", { status: "RUNNING", heartbeatAt: "2025-03-02T14:30:00.000Z" });
    expect(getCustomColumnValue(run, durationCol)).toBe(
      getCustomColumnValue(run, durationCol),
    );
  });

  it("returns null when timestamps are unparseable", () => {
    const run = makeRun("1", { createdAt: "nope", updatedAt: "nope" });
    expect(getCustomColumnValue(run, durationCol)).toBeNull();
  });

  it("clamps a negative interval to 0 (end before start), matching server GREATEST(0, …)", () => {
    // Clock skew / out-of-order backfill: the terminal status change is
    // recorded BEFORE createdAt. The client uses Math.max(0, end - start) and
    // the server wraps the same expression in GREATEST(0, …); both must yield 0
    // so a skewed run never sorts as if it had a "negative" duration.
    const run = makeRun("1", {
      status: "FAILED",
      createdAt: "2025-03-01T12:00:00.000Z",
      statusUpdated: "2025-03-01T11:59:00.000Z", // 60s before createdAt
      updatedAt: "2025-03-01T11:59:00.000Z",
    });
    expect(getCustomColumnValue(run, durationCol)).toBe(0);
  });
});

describe("formatCellValue — duration", () => {
  const durationCol: ColumnConfig = { id: "duration", source: "system", label: "Duration" };

  it("formats a numeric ms value as a compact h/m/s string", () => {
    expect(formatCellValue(95_400_000, durationCol)).toBe("26h 30m 0s");
    expect(formatCellValue(90_000, durationCol)).toBe("1m 30s");
    expect(formatCellValue(5_000, durationCol)).toBe("5s");
  });

  it('returns "-" for a non-numeric duration value', () => {
    expect(formatCellValue("oops", durationCol)).toBe("-");
  });
});
