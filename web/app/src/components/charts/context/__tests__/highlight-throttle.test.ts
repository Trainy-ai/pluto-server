import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { applySeriesHighlight } from "../chart-sync-context";
import type uPlot from "uplot";

// ============================
// applySeriesHighlight unit tests
// ============================

function mockChart(seriesLabels: string[]): uPlot {
  const series = [
    { label: "X" }, // series[0] is always the X axis in uPlot
    ...seriesLabels.map((label) => ({
      label,
      width: 1.5,
      _seriesId: label,
    })),
  ] as unknown as uPlot.Series[];

  return {
    series,
    redraw: vi.fn(),
  } as unknown as uPlot;
}

describe("applySeriesHighlight", () => {
  it("highlights matched series and dims others", () => {
    const chart = mockChart(["loss", "accuracy", "lr"]);

    applySeriesHighlight(chart, "accuracy", "label", 1.5);

    // series[0] is X axis, untouched
    expect(chart.series[1].width).toBe(Math.max(0.3, 1.5 * 0.15)); // dimmed
    expect(chart.series[2].width).toBe(Math.max(2.5, 1.5 * 2)); // highlighted
    expect(chart.series[3].width).toBe(Math.max(0.3, 1.5 * 0.15)); // dimmed
  });

  it("resets all series when value is null", () => {
    const chart = mockChart(["loss", "accuracy"]);
    // First highlight to set non-default widths
    applySeriesHighlight(chart, "loss", "label", 1.5);
    // Then reset
    applySeriesHighlight(chart, null, "label", 1.5);

    expect(chart.series[1].width).toBe(1.5);
    expect(chart.series[2].width).toBe(1.5);
  });

  it("resets all series when value does not match any series", () => {
    const chart = mockChart(["loss", "accuracy"]);

    applySeriesHighlight(chart, "nonexistent", "label", 1.5);

    expect(chart.series[1].width).toBe(1.5);
    expect(chart.series[2].width).toBe(1.5);
  });

  it("matches by _seriesId key", () => {
    const chart = mockChart(["loss", "accuracy"]);

    applySeriesHighlight(chart, "loss", "_seriesId", 1.5);

    expect(chart.series[1].width).toBe(Math.max(2.5, 1.5 * 2)); // highlighted
    expect(chart.series[2].width).toBe(Math.max(0.3, 1.5 * 0.15)); // dimmed
  });

  it("respects custom defaultWidth", () => {
    const chart = mockChart(["loss"]);

    applySeriesHighlight(chart, null, "label", 3.0);

    expect(chart.series[1].width).toBe(3.0);
  });

  it("highlights width is at least 2.5", () => {
    const chart = mockChart(["loss"]);

    applySeriesHighlight(chart, "loss", "label", 0.5);

    // max(2.5, 0.5 * 2) = max(2.5, 1.0) = 2.5
    expect(chart.series[1].width).toBe(2.5);
  });

  it("dimmed width is at least 0.3", () => {
    const chart = mockChart(["loss", "accuracy"]);

    applySeriesHighlight(chart, "loss", "label", 0.5);

    // max(0.3, 0.5 * 0.15) = max(0.3, 0.075) = 0.3
    expect(chart.series[2].width).toBe(0.3);
  });
});

// ============================
// rAF coalescing behavior tests
// ============================

describe("highlightUPlotSeries rAF coalescing", () => {
  let rafCallbacks: Array<FrameRequestCallback>;
  let rafIdCounter: number;

  beforeEach(() => {
    rafCallbacks = [];
    rafIdCounter = 0;

    // Mock localStorage for getStoredLineWidth()
    vi.stubGlobal(
      "localStorage",
      (() => {
        const store: Record<string, string> = {};
        return {
          getItem: (key: string) => store[key] ?? null,
          setItem: (key: string, val: string) => {
            store[key] = val;
          },
          removeItem: (key: string) => {
            delete store[key];
          },
          clear: () => Object.keys(store).forEach((k) => delete store[k]),
          get length() {
            return Object.keys(store).length;
          },
          key: (_i: number) => null,
        };
      })()
    );

    // Mock rAF/cAF to capture callbacks
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = ++rafIdCounter;
      rafCallbacks.push(cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function flushRaf() {
    const cbs = [...rafCallbacks];
    rafCallbacks = [];
    cbs.forEach((cb) => cb(performance.now()));
  }

  it("coalesces multiple rapid calls into a single rAF", async () => {
    // Dynamically import to get a fresh module with our mocked globals
    const { ChartSyncProvider, useChartSyncContext } = await import(
      "../chart-sync-context"
    );
    const React = await import("react");

    // We'll test the coalescing logic by tracking rAF calls
    // The provider stores pending highlight in a ref and schedules one rAF
    let contextValue: ReturnType<typeof useChartSyncContext> = null;

    function TestConsumer() {
      contextValue = useChartSyncContext();
      return null;
    }

    // Use React to render provider + consumer
    const { createRoot } = await import("react-dom/client");
    const container = document.createElement("div");
    document.body.appendChild(container);

    const root = createRoot(container);

    // Render synchronously using flushSync
    const { flushSync } = await import("react-dom");
    flushSync(() => {
      root.render(
        React.createElement(ChartSyncProvider, {
          syncKey: "test",
          children: React.createElement(TestConsumer),
        })
      );
    });

    expect(contextValue).not.toBeNull();
    const ctx = contextValue!;

    // Register mock charts
    const chartA = mockChart(["loss", "accuracy"]);
    const chartB = mockChart(["loss", "accuracy"]);
    const chartC = mockChart(["loss", "accuracy"]);

    ctx.registerUPlot("chartA", chartA);
    ctx.registerUPlot("chartB", chartB);
    ctx.registerUPlot("chartC", chartC);

    // Reset rAF tracking
    rafCallbacks = [];
    rafIdCounter = 0;

    // Call highlightUPlotSeries 5 times rapidly with different args
    ctx.highlightUPlotSeries("chartA", "loss");
    ctx.highlightUPlotSeries("chartA", "accuracy");
    ctx.highlightUPlotSeries("chartA", "loss");
    ctx.highlightUPlotSeries("chartA", "accuracy");
    ctx.highlightUPlotSeries("chartA", "lr"); // last-writer-wins

    // Only 1 rAF should have been scheduled (first call schedules, rest see pending)
    expect(rafCallbacks).toHaveLength(1);

    // Before flush: no redraws yet
    expect(chartB.redraw).not.toHaveBeenCalled();
    expect(chartC.redraw).not.toHaveBeenCalled();

    // Flush the rAF
    flushRaf();

    // "lr" doesn't match any series, so applySeriesHighlight resets to default width.
    // chartA is source, so it should NOT be touched. chartB and chartC should get redraw.
    // Since "lr" doesn't match, it does label-based highlight and finds no match → reset
    // Only charts that have the series or need reset get redraw.
    // With label=null it falls back to table highlight. With label="lr" it checks hasMatch.
    // chart.series.some(s => s.label === "lr") → false, so no redraw for non-matching.
    // Actually looking at the code: if label !== null, it checks hasMatch and only redraws
    // if hasMatch is true. "lr" won't match, so NO redraws happen.

    // Let's verify by checking redraw was NOT called (no match for "lr")
    expect(chartB.redraw).not.toHaveBeenCalled();
    expect(chartC.redraw).not.toHaveBeenCalled();

    // Now test with a matching label
    ctx.highlightUPlotSeries("chartA", "loss");
    expect(rafCallbacks).toHaveLength(1); // new rAF scheduled

    flushRaf();

    // chartB and chartC both have "loss" series, so they should be redrawn
    expect(chartB.redraw).toHaveBeenCalledTimes(1);
    expect(chartC.redraw).toHaveBeenCalledTimes(1);

    // Verify the highlight was applied correctly (last-writer-wins = "loss")
    // chartB series[1] = "loss" → highlighted, series[2] = "accuracy" → dimmed
    expect(chartB.series[1].width).toBe(Math.max(2.5, 1.5 * 2));
    expect(chartB.series[2].width).toBe(Math.max(0.3, 1.5 * 0.15));

    // Cleanup
    root.unmount();
    document.body.removeChild(container);
  });

  it("skips redundant highlights (same args as last applied)", async () => {
    const { ChartSyncProvider, useChartSyncContext } = await import(
      "../chart-sync-context"
    );
    const React = await import("react");

    let contextValue: ReturnType<typeof useChartSyncContext> = null;

    function TestConsumer() {
      contextValue = useChartSyncContext();
      return null;
    }

    const { createRoot } = await import("react-dom/client");
    const { flushSync } = await import("react-dom");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        React.createElement(ChartSyncProvider, {
          syncKey: "test-dedup",
          children: React.createElement(TestConsumer),
        })
      );
    });

    const ctx = contextValue!;
    const chartA = mockChart(["loss"]);
    const chartB = mockChart(["loss"]);
    ctx.registerUPlot("chartA", chartA);
    ctx.registerUPlot("chartB", chartB);

    rafCallbacks = [];

    // First call: highlight "loss" from chartA
    ctx.highlightUPlotSeries("chartA", "loss");
    flushRaf();
    expect(chartB.redraw).toHaveBeenCalledTimes(1);

    // Second call: same args → should be skipped (lastHighlightedRef match)
    ctx.highlightUPlotSeries("chartA", "loss");
    flushRaf();
    // Still 1 because the second call was deduplicated
    expect(chartB.redraw).toHaveBeenCalledTimes(1);

    // Third call: different args → should apply
    ctx.highlightUPlotSeries("chartA", null);
    flushRaf();
    expect(chartB.redraw).toHaveBeenCalledTimes(2);

    root.unmount();
    document.body.removeChild(container);
  });

  it("does not touch source chart during highlighting", async () => {
    const { ChartSyncProvider, useChartSyncContext } = await import(
      "../chart-sync-context"
    );
    const React = await import("react");

    let contextValue: ReturnType<typeof useChartSyncContext> = null;

    function TestConsumer() {
      contextValue = useChartSyncContext();
      return null;
    }

    const { createRoot } = await import("react-dom/client");
    const { flushSync } = await import("react-dom");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        React.createElement(ChartSyncProvider, {
          syncKey: "test-source",
          children: React.createElement(TestConsumer),
        })
      );
    });

    const ctx = contextValue!;
    const sourceChart = mockChart(["loss", "accuracy"]);
    const targetChart = mockChart(["loss", "accuracy"]);
    ctx.registerUPlot("source", sourceChart);
    ctx.registerUPlot("target", targetChart);

    rafCallbacks = [];

    ctx.highlightUPlotSeries("source", "loss");
    flushRaf();

    // Source chart should NOT have been redrawn
    expect(sourceChart.redraw).not.toHaveBeenCalled();
    // Source chart series widths should be unchanged (still 1.5 from mockChart)
    expect(sourceChart.series[1].width).toBe(1.5);
    expect(sourceChart.series[2].width).toBe(1.5);

    // Target chart SHOULD have been redrawn with highlight
    expect(targetChart.redraw).toHaveBeenCalledTimes(1);
    expect(targetChart.series[1].width).toBe(Math.max(2.5, 1.5 * 2)); // "loss" highlighted

    root.unmount();
    document.body.removeChild(container);
  });
});
