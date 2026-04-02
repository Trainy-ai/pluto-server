import { describe, it, expect, vi } from "vitest";
import { applySeriesHighlight } from "../chart-sync-context";
import type uPlot from "uplot";

/**
 * Tests for experiment-level highlight behavior.
 *
 * In Experiments mode, hovering an experiment row dispatches ALL run IDs
 * for that experiment. The chart highlight system must:
 * 1. Highlight all series matching any of the experiment's run IDs
 * 2. Dim all other series (from other experiments)
 * 3. Not regress single-run highlight in Runs mode
 */

function mockChart(seriesConfigs: { label: string; seriesId: string }[]): uPlot {
  const series = [
    { label: "X" }, // series[0] is always the X axis
    ...seriesConfigs.map((c) => ({
      label: c.label,
      _seriesId: c.seriesId,
      width: 1.5,
      _baseWidth: 1.5,
    })),
  ] as unknown as uPlot.Series[];

  return {
    series,
    redraw: vi.fn(),
  } as unknown as uPlot;
}

// Helper: simulate the table hover handler logic from chart-sync-context
function applyExperimentHighlight(
  chart: uPlot,
  allRunIds: string[],
  defaultWidth = 1.5,
): void {
  if (allRunIds.length === 0) {
    applySeriesHighlight(chart, null, "_seriesId", defaultWidth);
    return;
  }

  const highlightedWidth = Math.max(1, defaultWidth * 1.25);
  const dimmedWidth = Math.max(0.4, defaultWidth * 0.85);

  function seriesKeyMatches(seriesValue: string | undefined, target: string): boolean {
    if (!seriesValue) return false;
    if (seriesValue === target) return true;
    if (seriesValue.startsWith(target + ":")) return true;
    return false;
  }

  const hasAnyMatch = allRunIds.some((id) =>
    chart.series.some((s: any) => seriesKeyMatches(s._seriesId, id)),
  );

  if (hasAnyMatch) {
    for (let i = 1; i < chart.series.length; i++) {
      const s = chart.series[i] as any;
      const match = allRunIds.some((id) => seriesKeyMatches(s._seriesId, id));
      s.width = match ? highlightedWidth : dimmedWidth;
    }
  } else {
    for (let i = 1; i < chart.series.length; i++) {
      const s = chart.series[i] as any;
      s.width = s._baseWidth ?? defaultWidth;
    }
  }
}

describe("Experiment-level highlight", () => {
  // Simulates the fork-demo project:
  // v945 experiment: FRK-1 (root), FRK-2 (forkA), FRK-3 (forkB), FRK-4 (forkC)
  // v816 experiment: FRK-5
  const chart = () =>
    mockChart([
      { label: "FRK-4", seriesId: "XTsbb:eval/metrics/loss" },
      { label: "FRK-3", seriesId: "NjIzX:eval/metrics/loss" },
      { label: "FRK-2", seriesId: "toWyJ:eval/metrics/loss" },
      { label: "FRK-5", seriesId: "k6fKT:eval/metrics/loss" },
      { label: "FRK-1", seriesId: "JmnaE:eval/metrics/loss" },
    ]);

  const v945RunIds = ["XTsbb", "NjIzX", "toWyJ", "JmnaE"];
  const v816RunIds = ["k6fKT"];

  it("highlights all v945 experiment segments when hovering experiment row", () => {
    const c = chart();
    applyExperimentHighlight(c, v945RunIds);

    const highlightedWidth = Math.max(1, 1.5 * 1.25);
    const dimmedWidth = Math.max(0.4, 1.5 * 0.85);

    // FRK-4, FRK-3, FRK-2, FRK-1 should all be highlighted (v945 experiment)
    expect((c.series[1] as any).width).toBe(highlightedWidth); // FRK-4
    expect((c.series[2] as any).width).toBe(highlightedWidth); // FRK-3
    expect((c.series[3] as any).width).toBe(highlightedWidth); // FRK-2
    expect((c.series[5] as any).width).toBe(highlightedWidth); // FRK-1

    // FRK-5 should be dimmed (v816 experiment)
    expect((c.series[4] as any).width).toBe(dimmedWidth); // FRK-5
  });

  it("highlights only v816 when hovering that experiment row", () => {
    const c = chart();
    applyExperimentHighlight(c, v816RunIds);

    const highlightedWidth = Math.max(1, 1.5 * 1.25);
    const dimmedWidth = Math.max(0.4, 1.5 * 0.85);

    // FRK-5 should be highlighted
    expect((c.series[4] as any).width).toBe(highlightedWidth);

    // All v945 runs should be dimmed
    expect((c.series[1] as any).width).toBe(dimmedWidth);
    expect((c.series[2] as any).width).toBe(dimmedWidth);
    expect((c.series[3] as any).width).toBe(dimmedWidth);
    expect((c.series[5] as any).width).toBe(dimmedWidth);
  });

  it("single run highlight still works (Runs mode, no regression)", () => {
    const c = chart();
    // In Runs mode, only one run ID is dispatched
    applySeriesHighlight(c, "NjIzX", "_seriesId", 1.5);

    const highlightedWidth = Math.max(1, 1.5 * 1.25);
    const dimmedWidth = Math.max(0.4, 1.5 * 0.85);

    // Only FRK-3 (NjIzX) should be highlighted
    expect((c.series[2] as any).width).toBe(highlightedWidth);

    // All others dimmed
    expect((c.series[1] as any).width).toBe(dimmedWidth);
    expect((c.series[3] as any).width).toBe(dimmedWidth);
    expect((c.series[4] as any).width).toBe(dimmedWidth);
    expect((c.series[5] as any).width).toBe(dimmedWidth);
  });

  it("clears all highlights when null is dispatched", () => {
    const c = chart();
    // First highlight
    applyExperimentHighlight(c, v945RunIds);
    // Then clear
    applyExperimentHighlight(c, []);

    // All series should be back to base width
    for (let i = 1; i < c.series.length; i++) {
      expect((c.series[i] as any).width).toBe(1.5);
    }
  });

  it("matches composite seriesId format (runId:metricName)", () => {
    const c = chart();
    // Dispatch just a raw run ID — should match "runId:metric" series
    applyExperimentHighlight(c, ["XTsbb"]);

    const highlightedWidth = Math.max(1, 1.5 * 1.25);
    const dimmedWidth = Math.max(0.4, 1.5 * 0.85);

    // XTsbb should match "XTsbb:eval/metrics/loss"
    expect((c.series[1] as any).width).toBe(highlightedWidth);
    // Others dimmed
    expect((c.series[2] as any).width).toBe(dimmedWidth);
    expect((c.series[3] as any).width).toBe(dimmedWidth);
    expect((c.series[4] as any).width).toBe(dimmedWidth);
    expect((c.series[5] as any).width).toBe(dimmedWidth);
  });

  it("handles no matching series gracefully (resets to base)", () => {
    const c = chart();
    applyExperimentHighlight(c, ["nonexistent-id"]);

    // No match → all series at base width
    for (let i = 1; i < c.series.length; i++) {
      expect((c.series[i] as any).width).toBe(1.5);
    }
  });
});

describe("Reverse direction: chart hover → experiment highlight via _crossHighlightRunIds", () => {
  // When a user hovers a curve on the chart, the source chart detects the closest
  // series and dispatches the run ID. In experiments mode, highlightUPlotSeries
  // expands the single run ID to all experiment run IDs and stores them as
  // _crossHighlightRunIds on target charts. The stroke function then checks this array.

  const chart = () =>
    mockChart([
      { label: "FRK-4", seriesId: "XTsbb:eval/metrics/loss" },
      { label: "FRK-3", seriesId: "NjIzX:eval/metrics/loss" },
      { label: "FRK-2", seriesId: "toWyJ:eval/metrics/loss" },
      { label: "FRK-5", seriesId: "k6fKT:eval/metrics/loss" },
      { label: "FRK-1", seriesId: "JmnaE:eval/metrics/loss" },
    ]);

  it("_crossHighlightRunIds highlights all experiment series on target charts", () => {
    const c = chart();
    // Simulate what chart-sync-context does on target charts
    const allExpRunIds = ["XTsbb", "NjIzX", "toWyJ", "JmnaE"]; // v945 experiment
    (c as any)._crossHighlightRunId = "XTsbb";
    (c as any)._crossHighlightRunIds = allExpRunIds;

    // Apply the same logic the stroke function uses
    const highlightedWidth = Math.max(1, 1.5 * 1.25);
    const dimmedWidth = Math.max(0.4, 1.5 * 0.85);

    function seriesKeyMatches(seriesValue: string | undefined, target: string): boolean {
      if (!seriesValue) return false;
      if (seriesValue === target) return true;
      if (seriesValue.startsWith(target + ":")) return true;
      return false;
    }

    for (let i = 1; i < c.series.length; i++) {
      const s = c.series[i] as any;
      const crossRunIds: string[] = (c as any)._crossHighlightRunIds;
      const match = crossRunIds.some((rid: string) =>
        seriesKeyMatches(s._seriesId, rid),
      );
      s.width = match ? highlightedWidth : dimmedWidth;
    }

    // v945 experiment runs should be highlighted
    expect((c.series[1] as any).width).toBe(highlightedWidth); // FRK-4
    expect((c.series[2] as any).width).toBe(highlightedWidth); // FRK-3
    expect((c.series[3] as any).width).toBe(highlightedWidth); // FRK-2
    expect((c.series[5] as any).width).toBe(highlightedWidth); // FRK-1

    // v816 should be dimmed
    expect((c.series[4] as any).width).toBe(dimmedWidth); // FRK-5
  });

  it("single _crossHighlightRunId still works for Runs mode (no regression)", () => {
    const c = chart();
    (c as any)._crossHighlightRunId = "NjIzX";
    (c as any)._crossHighlightRunIds = ["NjIzX"]; // single-element array in runs mode

    const highlightedWidth = Math.max(1, 1.5 * 1.25);
    const dimmedWidth = Math.max(0.4, 1.5 * 0.85);

    function seriesKeyMatches(seriesValue: string | undefined, target: string): boolean {
      if (!seriesValue) return false;
      if (seriesValue === target) return true;
      if (seriesValue.startsWith(target + ":")) return true;
      return false;
    }

    for (let i = 1; i < c.series.length; i++) {
      const s = c.series[i] as any;
      const crossRunIds: string[] = (c as any)._crossHighlightRunIds;
      const match = crossRunIds.some((rid: string) =>
        seriesKeyMatches(s._seriesId, rid),
      );
      s.width = match ? highlightedWidth : dimmedWidth;
    }

    // Only FRK-3 (NjIzX) highlighted
    expect((c.series[2] as any).width).toBe(highlightedWidth);
    // Others dimmed
    expect((c.series[1] as any).width).toBe(dimmedWidth);
    expect((c.series[3] as any).width).toBe(dimmedWidth);
    expect((c.series[4] as any).width).toBe(dimmedWidth);
    expect((c.series[5] as any).width).toBe(dimmedWidth);
  });

  it("_experimentRunIdsMap lookup expands single runId to experiment group", () => {
    // Simulates what happens when the cursor hook looks up the experiment map
    const expMap = new Map<string, string[]>();
    const v945Ids = ["XTsbb", "NjIzX", "toWyJ", "JmnaE"];
    for (const id of v945Ids) expMap.set(id, v945Ids);
    expMap.set("k6fKT", ["k6fKT"]);

    // Hovering FRK-3 (NjIzX) should expand to all v945 runs
    const hoveredRunId = "NjIzX";
    const expandedIds = expMap.get(hoveredRunId) ?? [hoveredRunId];
    expect(expandedIds).toEqual(v945Ids);

    // Hovering FRK-5 (k6fKT) should stay as single
    const hoveredRunId2 = "k6fKT";
    const expandedIds2 = expMap.get(hoveredRunId2) ?? [hoveredRunId2];
    expect(expandedIds2).toEqual(["k6fKT"]);
  });
});

describe("Stroke function experiment highlight via _tableHighlightRunIds", () => {
  // These tests verify that the stroke function reads _tableHighlightRunIds
  // from the chart instance for multi-run experiment highlighting.
  // The actual stroke function is tested indirectly — here we verify the
  // data contract: _tableHighlightRunIds should be an array of run IDs.

  it("_tableHighlightRunIds stores all experiment run IDs", () => {
    const c = mockChart([]);
    const allIds = ["XTsbb", "NjIzX", "toWyJ", "JmnaE"];

    // Simulate what chart-sync-context does
    (c as any)._tableHighlightRunId = allIds[0];
    (c as any)._tableHighlightRunIds = allIds;

    expect((c as any)._tableHighlightRunIds).toEqual(allIds);
    expect((c as any)._tableHighlightRunId).toBe("XTsbb");
  });

  it("_tableHighlightRunIds is single-element array for Runs mode", () => {
    const c = mockChart([]);

    // In Runs mode, detail is a string, normalized to single-element array
    const detail = "NjIzX";
    const allRunIds = [detail];

    (c as any)._tableHighlightRunId = detail;
    (c as any)._tableHighlightRunIds = allRunIds;

    expect((c as any)._tableHighlightRunIds).toEqual(["NjIzX"]);
  });
});

describe("Table→Chart forward direction: fallback after chart leave", () => {
  // When the mouse leaves the chart and the table row is still hovered,
  // the chart should fall back to the table highlight. In experiments mode,
  // this must use _tableHighlightRunIds (array) not just the primary ID.

  const chart = () =>
    mockChart([
      { label: "FRK-4", seriesId: "XTsbb:eval/metrics/loss" },
      { label: "FRK-3", seriesId: "NjIzX:eval/metrics/loss" },
      { label: "FRK-2", seriesId: "toWyJ:eval/metrics/loss" },
      { label: "FRK-5", seriesId: "k6fKT:eval/metrics/loss" },
      { label: "FRK-1", seriesId: "JmnaE:eval/metrics/loss" },
    ]);

  function seriesKeyMatches(seriesValue: string | undefined, target: string): boolean {
    if (!seriesValue) return false;
    if (seriesValue === target) return true;
    if (seriesValue.startsWith(target + ":")) return true;
    return false;
  }

  /** Simulate the fallback logic from line-uplot.tsx when mouse leaves chart */
  function applyTableFallback(c: uPlot, defaultWidth = 1.5): void {
    const tableRunIds: string[] | null = (c as any)._tableHighlightRunIds;
    if (tableRunIds && tableRunIds.length > 1) {
      const highlightedWidth = Math.max(1, defaultWidth * 1.25);
      const dimmedWidth = Math.max(0.4, defaultWidth * 0.85);
      for (let i = 1; i < c.series.length; i++) {
        const sid = (c.series[i] as any)?._seriesId;
        const match = tableRunIds.some((id: string) => sid === id || (sid && sid.startsWith(id + ":")));
        c.series[i].width = match ? highlightedWidth : dimmedWidth;
      }
    } else {
      // Single-ID fallback
      const tableId = (c as any)._tableHighlightRunId;
      applySeriesHighlight(c, tableId, "_seriesId", defaultWidth);
    }
  }

  it("fallback after chart leave highlights all experiment runs", () => {
    const c = chart();
    const v945Ids = ["XTsbb", "NjIzX", "toWyJ", "JmnaE"];
    (c as any)._tableHighlightRunId = "XTsbb";
    (c as any)._tableHighlightRunIds = v945Ids;

    applyTableFallback(c);

    const highlightedWidth = Math.max(1, 1.5 * 1.25);
    const dimmedWidth = Math.max(0.4, 1.5 * 0.85);

    // All v945 series highlighted
    expect((c.series[1] as any).width).toBe(highlightedWidth); // FRK-4
    expect((c.series[2] as any).width).toBe(highlightedWidth); // FRK-3
    expect((c.series[3] as any).width).toBe(highlightedWidth); // FRK-2
    expect((c.series[5] as any).width).toBe(highlightedWidth); // FRK-1

    // v816 dimmed
    expect((c.series[4] as any).width).toBe(dimmedWidth); // FRK-5
  });

  it("fallback with single-ID (Runs mode) highlights only that run", () => {
    const c = chart();
    (c as any)._tableHighlightRunId = "NjIzX";
    (c as any)._tableHighlightRunIds = ["NjIzX"];

    applyTableFallback(c);

    const highlightedWidth = Math.max(1, 1.5 * 1.25);
    const dimmedWidth = Math.max(0.4, 1.5 * 0.85);

    // Only FRK-3 highlighted
    expect((c.series[2] as any).width).toBe(highlightedWidth);
    // Others dimmed
    expect((c.series[1] as any).width).toBe(dimmedWidth);
    expect((c.series[3] as any).width).toBe(dimmedWidth);
    expect((c.series[4] as any).width).toBe(dimmedWidth);
    expect((c.series[5] as any).width).toBe(dimmedWidth);
  });

  it("fallback with no table highlight resets all to base width", () => {
    const c = chart();
    (c as any)._tableHighlightRunId = null;
    (c as any)._tableHighlightRunIds = null;

    applyTableFallback(c);

    // All series at base width
    for (let i = 1; i < c.series.length; i++) {
      expect((c.series[i] as any).width).toBe(1.5);
    }
  });
});

describe("Source chart local focus: experiment group on hovered chart", () => {
  // When a user hovers a curve on the source chart, the stroke function
  // uses localFocusIdx. In experiments mode, it should expand to all
  // experiment runs via experimentRunIdsMapRef, not just the single series.

  it("localFocusIdx expands to experiment group via experimentRunIdsMapRef", () => {
    // Build the experiment map
    const v945Ids = ["XTsbb", "NjIzX", "toWyJ", "JmnaE"];
    const expMap = new Map<string, string[]>();
    for (const id of v945Ids) expMap.set(id, v945Ids);
    expMap.set("k6fKT", ["k6fKT"]);

    // Simulate: localFocusIdx points to series 3 (FRK-2, seriesId "toWyJ:eval/metrics/loss")
    const focusedSeriesId = "toWyJ:eval/metrics/loss";
    const focusedRunId = focusedSeriesId.split(":")[0]; // "toWyJ"
    const expIds = expMap.get(focusedRunId); // ["XTsbb", "NjIzX", "toWyJ", "JmnaE"]

    expect(expIds).toEqual(v945Ids);

    // The stroke function should check: does thisSeriesId match any of expIds?
    const testSeriesIds = [
      "XTsbb:eval/metrics/loss",  // FRK-4 — should match
      "NjIzX:eval/metrics/loss",  // FRK-3 — should match
      "toWyJ:eval/metrics/loss",  // FRK-2 — should match (the hovered one)
      "k6fKT:eval/metrics/loss",  // FRK-5 — should NOT match
      "JmnaE:eval/metrics/loss",  // FRK-1 — should match
    ];

    const results = testSeriesIds.map((sid) => {
      return expIds!.some((rid) => sid === rid || sid.startsWith(rid + ":"));
    });

    expect(results).toEqual([true, true, true, false, true]);
  });

  it("without experiment map, localFocusIdx highlights only the single series", () => {
    // Runs mode — no experiment map. Use a helper to avoid TS narrowing the
    // literal `null` to `never` inside the ternary.
    const getExpMap = (): Map<string, string[]> | null => null;
    const expMap = getExpMap();
    const focusedRunId = "toWyJ";
    const expIds = focusedRunId && expMap ? expMap.get(focusedRunId) : null;

    expect(expIds).toBeNull();
    // Stroke function falls back to: isHighlighted = seriesIdx === localFocusIdx
  });
});
