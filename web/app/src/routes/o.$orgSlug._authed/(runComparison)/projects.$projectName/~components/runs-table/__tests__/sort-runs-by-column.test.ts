import { describe, it, expect } from "vitest";
import { sortRunsByColumn } from "../hooks/use-data-table-state";
import type { Run } from "../../../~queries/list-runs";
import type { ColumnConfig } from "../../../~hooks/use-column-config";
import { makeRun } from "./_fixtures";

const ids = (runs: Run[]) => runs.map((r) => r.id);

// ── sortRunsByColumn ─────────────────────────────────────────────────────

describe("sortRunsByColumn", () => {
  it("returns input unchanged when sorting is empty", () => {
    const runs = [makeRun("c"), makeRun("a"), makeRun("b")];
    const result = sortRunsByColumn(runs, [], []);
    expect(result).toBe(runs); // same ref
  });

  it("returns input unchanged when runs is empty", () => {
    const result = sortRunsByColumn([], [{ id: "name", desc: true }], []);
    expect(result).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const runs = [
      makeRun("c", { name: "charlie" }),
      makeRun("a", { name: "alice" }),
    ];
    const before = [...runs];
    sortRunsByColumn(runs, [{ id: "name", desc: false }], []);
    expect(runs).toEqual(before);
  });

  it("sorts by name ascending", () => {
    const runs = [
      makeRun("c", { name: "charlie" }),
      makeRun("a", { name: "alice" }),
      makeRun("b", { name: "bob" }),
    ];
    const result = sortRunsByColumn(
      runs,
      [{ id: "name", desc: false }],
      [],
    );
    expect(ids(result)).toEqual(["a", "b", "c"]);
  });

  it("sorts by name descending", () => {
    const runs = [
      makeRun("c", { name: "charlie" }),
      makeRun("a", { name: "alice" }),
      makeRun("b", { name: "bob" }),
    ];
    const result = sortRunsByColumn(
      runs,
      [{ id: "name", desc: true }],
      [],
    );
    expect(ids(result)).toEqual(["c", "b", "a"]);
  });

  // ── Metric column (the t_0 / training/loss scenario from the bug) ─────

  it("sorts by metric summary descending", () => {
    const cols: ColumnConfig[] = [
      { id: "training/loss", source: "metric", label: "training/loss", aggregation: "MIN" },
    ];
    const runs = [
      makeRun("mid", { metricSummaries: { "training/loss|MIN": 0.32344 } } as any),
      makeRun("high", { metricSummaries: { "training/loss|MIN": 0.636587 } } as any),
      makeRun("low", { metricSummaries: { "training/loss|MIN": 0.068587 } } as any),
    ];
    const result = sortRunsByColumn(
      runs,
      [{ id: "custom-metric-training/loss-MIN", desc: true }],
      cols,
    );
    expect(ids(result)).toEqual(["high", "mid", "low"]);
  });

  it("sorts by metric summary ascending", () => {
    const cols: ColumnConfig[] = [
      { id: "training/loss", source: "metric", label: "training/loss", aggregation: "MIN" },
    ];
    const runs = [
      makeRun("mid", { metricSummaries: { "training/loss|MIN": 0.32 } } as any),
      makeRun("high", { metricSummaries: { "training/loss|MIN": 0.64 } } as any),
      makeRun("low", { metricSummaries: { "training/loss|MIN": 0.07 } } as any),
    ];
    const result = sortRunsByColumn(
      runs,
      [{ id: "custom-metric-training/loss-MIN", desc: false }],
      cols,
    );
    expect(ids(result)).toEqual(["low", "mid", "high"]);
  });

  // ── Mixed values, including missing metric summaries ─────────────────

  // NULLS LAST regardless of direction — matches the backend's sort and
  // users' expectation ("-" always at the bottom). This is also what lets
  // us apply the helper on a server-sorted array safely: the client's null
  // placement has to agree with the server's or applying the sort turns
  // into a reorder that breaks offset pagination when pages come back in
  // client order rather than server order.
  it("orders null metric values last regardless of direction (NULLS LAST)", () => {
    const cols: ColumnConfig[] = [
      { id: "training/loss", source: "metric", label: "training/loss", aggregation: "MIN" },
    ];
    const runs = [
      makeRun("hasVal1", { metricSummaries: { "training/loss|MIN": 0.5 } } as any),
      makeRun("missing"), // no metricSummaries
      makeRun("hasVal2", { metricSummaries: { "training/loss|MIN": 0.1 } } as any),
    ];
    const asc = sortRunsByColumn(
      runs,
      [{ id: "custom-metric-training/loss-MIN", desc: false }],
      cols,
    );
    expect(ids(asc)).toEqual(["hasVal2", "hasVal1", "missing"]);

    const desc = sortRunsByColumn(
      runs,
      [{ id: "custom-metric-training/loss-MIN", desc: true }],
      cols,
    );
    expect(ids(desc)).toEqual(["hasVal1", "hasVal2", "missing"]);
  });

  // ── Unknown sort column id — must preserve order ─────────────────────

  it("preserves input order when sort column id is unknown", () => {
    const runs = [makeRun("b"), makeRun("a"), makeRun("c")];
    const result = sortRunsByColumn(
      runs,
      [{ id: "custom-metric-no-such-metric-MIN", desc: true }],
      [],
    );
    // Without this escape hatch sortRunsByColumn would compare all values
    // as "equal" (both undefined) and preserve input order anyway — but
    // we also skip the shallow copy so the reference stays stable.
    expect(ids(result)).toEqual(["b", "a", "c"]);
    expect(result).toBe(runs);
  });

  // ── Regression: the user's scrambled-tail scenario ───────────────────
  //
  // Before the fix, mergeSelectedRuns produced "in-page (server-sorted) +
  // out-of-page (insertion-order tail)" when the backend's current page
  // didn't contain all selected runs. Under "Display only selected",
  // useDataTableState now feeds that array into sortRunsByColumn so the
  // tail is re-sorted. This test reproduces the scrambled order from the
  // bug report and asserts the sorted output.
  it("reorders a scrambled mergeSelectedRuns tail under desc sort", () => {
    const cols: ColumnConfig[] = [
      { id: "training/loss", source: "metric", label: "training/loss", aggregation: "MIN" },
    ];
    // Matches the observed broken order from the bug screenshot: first 2
    // are on the server page (desc), the remaining 5 are out-of-page and
    // arrive in insertion order from selectedRunsWithColors.
    const scrambled = [
      makeRun("r0", { metricSummaries: { "training/loss|MIN": 0.636587 } } as any),
      makeRun("r1", { metricSummaries: { "training/loss|MIN": 0.32344 } } as any),
      makeRun("r2", { metricSummaries: { "training/loss|MIN": 0.068587 } } as any),
      makeRun("r3", { metricSummaries: { "training/loss|MIN": 0.294873 } } as any),
      makeRun("r4", { metricSummaries: { "training/loss|MIN": 0.312154 } } as any),
      makeRun("r5", { metricSummaries: { "training/loss|MIN": 0.140986 } } as any),
      makeRun("r6", { metricSummaries: { "training/loss|MIN": 0.191214 } } as any),
    ];
    const result = sortRunsByColumn(
      scrambled,
      [{ id: "custom-metric-training/loss-MIN", desc: true }],
      cols,
    );
    // Expected: strictly desc.
    expect(result.map((r) => (r as any).metricSummaries["training/loss|MIN"]))
      .toEqual([0.636587, 0.32344, 0.312154, 0.294873, 0.191214, 0.140986, 0.068587]);
  });
});
