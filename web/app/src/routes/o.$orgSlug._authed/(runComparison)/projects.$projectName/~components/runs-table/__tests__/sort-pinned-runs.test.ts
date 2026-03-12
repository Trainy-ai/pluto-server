import { describe, it, expect } from "vitest";
import { sortPinnedRuns } from "../hooks/use-data-table-state";
import type { Run } from "../../../~queries/list-runs";
import type { ColumnConfig } from "../../../~hooks/use-column-config";

// ── Helpers ──────────────────────────────────────────────────────────────

function makeRun(id: string, overrides: Partial<Run> & Record<string, any> = {}): Run {
  return {
    id,
    name: `run-${id}`,
    status: "COMPLETED",
    tags: [],
    createdAt: "2025-03-01T12:00:00.000Z",
    updatedAt: "2025-03-02T14:30:00.000Z",
    ...overrides,
  } as Run;
}

function makeSelected(runs: Run[]): Record<string, { run: Run; color: string }> {
  const result: Record<string, { run: Run; color: string }> = {};
  runs.forEach((run, i) => {
    result[run.id] = { run, color: `#color${i}` };
  });
  return result;
}

const names = (runs: Run[]) => runs.map((r) => r.name);

// ── Tests ────────────────────────────────────────────────────────────────

describe("sortPinnedRuns", () => {
  it("returns empty array when pinning is inactive", () => {
    const runs = [makeRun("1"), makeRun("2")];
    const result = sortPinnedRuns(false, makeSelected(runs), [], []);
    expect(result).toEqual([]);
  });

  it("returns unsorted runs when no sorting is active", () => {
    const runs = [makeRun("c", { name: "charlie" }), makeRun("a", { name: "alice" }), makeRun("b", { name: "bob" })];
    const result = sortPinnedRuns(true, makeSelected(runs), [], []);
    expect(names(result)).toEqual(["charlie", "alice", "bob"]);
  });

  // ── Name column ──────────────────────────────────────────────────────

  describe("sort by name", () => {
    const runs = [
      makeRun("3", { name: "charlie" }),
      makeRun("1", { name: "alice" }),
      makeRun("2", { name: "bob" }),
    ];

    it("ascending", () => {
      const result = sortPinnedRuns(
        true, makeSelected(runs),
        [{ id: "name", desc: false }], [],
      );
      expect(names(result)).toEqual(["alice", "bob", "charlie"]);
    });

    it("descending", () => {
      const result = sortPinnedRuns(
        true, makeSelected(runs),
        [{ id: "name", desc: true }], [],
      );
      expect(names(result)).toEqual(["charlie", "bob", "alice"]);
    });
  });

  // ── System columns (createdAt, updatedAt) ────────────────────────────

  describe("sort by createdAt", () => {
    const cols: ColumnConfig[] = [
      { id: "createdAt", source: "system", label: "Created" },
    ];
    const runs = [
      makeRun("2", { name: "mid", createdAt: "2025-03-02T00:00:00Z" }),
      makeRun("3", { name: "latest", createdAt: "2025-03-03T00:00:00Z" }),
      makeRun("1", { name: "earliest", createdAt: "2025-03-01T00:00:00Z" }),
    ];

    it("ascending", () => {
      const result = sortPinnedRuns(
        true, makeSelected(runs),
        [{ id: "custom-systemMetadata-createdAt", desc: false }], cols,
      );
      expect(names(result)).toEqual(["earliest", "mid", "latest"]);
    });

    it("descending", () => {
      const result = sortPinnedRuns(
        true, makeSelected(runs),
        [{ id: "custom-systemMetadata-createdAt", desc: true }], cols,
      );
      expect(names(result)).toEqual(["latest", "mid", "earliest"]);
    });
  });

  // ── Config columns (lr, batch_size, etc.) ────────────────────────────

  describe("sort by config field (learning rate)", () => {
    const cols: ColumnConfig[] = [
      { id: "lr", source: "config", label: "Learning Rate" },
    ];
    const runs = [
      makeRun("2", { name: "mid-lr", _flatConfig: { lr: "0.01" } }),
      makeRun("1", { name: "low-lr", _flatConfig: { lr: "0.001" } }),
      makeRun("3", { name: "high-lr", _flatConfig: { lr: "0.1" } }),
    ];

    it("ascending (string comparison)", () => {
      const result = sortPinnedRuns(
        true, makeSelected(runs),
        [{ id: "custom-config-lr", desc: false }], cols,
      );
      expect(names(result)).toEqual(["low-lr", "mid-lr", "high-lr"]);
    });

    it("descending", () => {
      const result = sortPinnedRuns(
        true, makeSelected(runs),
        [{ id: "custom-config-lr", desc: true }], cols,
      );
      expect(names(result)).toEqual(["high-lr", "mid-lr", "low-lr"]);
    });
  });

  describe("sort by config field (batch_size as number-like string)", () => {
    const cols: ColumnConfig[] = [
      { id: "batch_size", source: "config", label: "Batch Size" },
    ];
    const runs = [
      makeRun("2", { name: "bs-64", _flatConfig: { batch_size: "64" } }),
      makeRun("1", { name: "bs-16", _flatConfig: { batch_size: "16" } }),
      makeRun("3", { name: "bs-128", _flatConfig: { batch_size: "128" } }),
    ];

    it("ascending (string comparison — 128 < 16 < 64)", () => {
      const result = sortPinnedRuns(
        true, makeSelected(runs),
        [{ id: "custom-config-batch_size", desc: false }], cols,
      );
      // String comparison: "128" < "16" < "64"
      expect(names(result)).toEqual(["bs-128", "bs-16", "bs-64"]);
    });
  });

  // ── Metric aggregation columns ───────────────────────────────────────

  describe("sort by metric (train/loss LAST)", () => {
    const cols: ColumnConfig[] = [
      { id: "train/loss", source: "metric", label: "Loss", aggregation: "LAST" },
    ];
    const runs = [
      makeRun("2", { name: "mid-loss", metricSummaries: { "train/loss|LAST": 0.5 } }),
      makeRun("1", { name: "low-loss", metricSummaries: { "train/loss|LAST": 0.1 } }),
      makeRun("3", { name: "high-loss", metricSummaries: { "train/loss|LAST": 2.3 } }),
    ];

    it("ascending (numeric)", () => {
      const result = sortPinnedRuns(
        true, makeSelected(runs),
        [{ id: "custom-metric-train/loss-LAST", desc: false }], cols,
      );
      expect(names(result)).toEqual(["low-loss", "mid-loss", "high-loss"]);
    });

    it("descending (numeric)", () => {
      const result = sortPinnedRuns(
        true, makeSelected(runs),
        [{ id: "custom-metric-train/loss-LAST", desc: true }], cols,
      );
      expect(names(result)).toEqual(["high-loss", "mid-loss", "low-loss"]);
    });
  });

  describe("sort by metric (accuracy MAX)", () => {
    const cols: ColumnConfig[] = [
      { id: "eval/accuracy", source: "metric", label: "Accuracy", aggregation: "MAX" },
    ];
    const runs = [
      makeRun("1", { name: "best", metricSummaries: { "eval/accuracy|MAX": 0.97 } }),
      makeRun("2", { name: "worst", metricSummaries: { "eval/accuracy|MAX": 0.82 } }),
      makeRun("3", { name: "mid", metricSummaries: { "eval/accuracy|MAX": 0.91 } }),
    ];

    it("descending puts highest accuracy first", () => {
      const result = sortPinnedRuns(
        true, makeSelected(runs),
        [{ id: "custom-metric-eval/accuracy-MAX", desc: true }], cols,
      );
      expect(names(result)).toEqual(["best", "mid", "worst"]);
    });
  });

  // ── System metadata columns ──────────────────────────────────────────

  describe("sort by systemMetadata field", () => {
    const cols: ColumnConfig[] = [
      { id: "hostname", source: "systemMetadata", label: "Host" },
    ];
    const runs = [
      makeRun("2", { name: "gpu-b", _flatSystemMetadata: { hostname: "gpu-node-02" } }),
      makeRun("1", { name: "gpu-a", _flatSystemMetadata: { hostname: "gpu-node-01" } }),
      makeRun("3", { name: "gpu-c", _flatSystemMetadata: { hostname: "gpu-node-03" } }),
    ];

    it("ascending", () => {
      const result = sortPinnedRuns(
        true, makeSelected(runs),
        [{ id: "custom-systemMetadata-hostname", desc: false }], cols,
      );
      expect(names(result)).toEqual(["gpu-a", "gpu-b", "gpu-c"]);
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────

  describe("null/undefined handling", () => {
    const cols: ColumnConfig[] = [
      { id: "train/loss", source: "metric", label: "Loss", aggregation: "LAST" },
    ];

    it("runs with missing values sort to the end (ascending)", () => {
      const runs = [
        makeRun("2", { name: "has-loss", metricSummaries: { "train/loss|LAST": 0.5 } }),
        makeRun("1", { name: "no-loss" }), // no metricSummaries
        makeRun("3", { name: "also-has-loss", metricSummaries: { "train/loss|LAST": 0.1 } }),
      ];
      const result = sortPinnedRuns(
        true, makeSelected(runs),
        [{ id: "custom-metric-train/loss-LAST", desc: false }], cols,
      );
      expect(names(result)).toEqual(["also-has-loss", "has-loss", "no-loss"]);
    });

    it("runs with missing values sort consistently (descending)", () => {
      const runs = [
        makeRun("a-no", { name: "no-loss" }),
        makeRun("b-has", { name: "has-loss", metricSummaries: { "train/loss|LAST": 0.5 } }),
      ];
      const result = sortPinnedRuns(
        true, makeSelected(runs),
        [{ id: "custom-metric-train/loss-LAST", desc: true }], cols,
      );
      // Nulls sort before non-null in descending (dir=-1)
      expect(names(result)).toEqual(["no-loss", "has-loss"]);
    });

    it("all null values preserves original order", () => {
      const runs = [
        makeRun("1", { name: "a" }),
        makeRun("2", { name: "b" }),
        makeRun("3", { name: "c" }),
      ];
      const result = sortPinnedRuns(
        true, makeSelected(runs),
        [{ id: "custom-metric-train/loss-LAST", desc: false }], cols,
      );
      expect(names(result)).toEqual(["a", "b", "c"]);
    });
  });

  describe("unrecognized column ID", () => {
    it("preserves original order when column is not found", () => {
      const runs = [
        makeRun("z-charlie", { name: "charlie" }),
        makeRun("a-alice", { name: "alice" }),
      ];
      const result = sortPinnedRuns(
        true, makeSelected(runs),
        [{ id: "custom-unknown-field", desc: false }], [],
      );
      expect(names(result)).toEqual(["charlie", "alice"]);
    });
  });

  describe("single run", () => {
    it("returns the single run regardless of sort", () => {
      const runs = [makeRun("1", { name: "only" })];
      const result = sortPinnedRuns(
        true, makeSelected(runs),
        [{ id: "name", desc: false }], [],
      );
      expect(names(result)).toEqual(["only"]);
    });
  });
});
