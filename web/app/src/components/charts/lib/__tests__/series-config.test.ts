import { describe, it, expect } from "vitest";
import { buildSeriesConfig, type SeriesConfigRefs } from "../series-config";
import type { LineData } from "../../line-uplot";
import type uPlot from "uplot";

/**
 * Helpers to invoke the dynamic stroke function returned by buildSeriesConfig.
 * The stroke function reads from refs at call time, so we can manipulate the
 * refs between calls to simulate different emphasis states.
 */

function makeLine(label: string, color: string): LineData {
  return { x: [0, 1], y: [0, 1], label, color };
}

function makeRefs(overrides?: Partial<SeriesConfigRefs>): SeriesConfigRefs {
  return {
    lastFocusedSeriesRef: { current: null },
    crossChartRunIdRef: { current: null },
    tableHighlightRef: { current: null },
    ...overrides,
  };
}

/** Build a minimal uPlot-like object so we can call stroke(u, seriesIdx). */
function fakeUPlot(seriesEntries: uPlot.Series[]): uPlot {
  return { series: seriesEntries } as unknown as uPlot;
}

function getStroke(series: uPlot.Series, u: uPlot, idx: number): string {
  const strokeFn = series.stroke;
  if (typeof strokeFn === "function") {
    return strokeFn(u, idx) as string;
  }
  return strokeFn as string;
}

describe("buildSeriesConfig emphasis (stroke function)", () => {
  const lines: LineData[] = [
    makeLine("loss", "#ff0000"),
    makeLine("accuracy", "#00ff00"),
    makeLine("lr", "#0000ff"),
  ];

  it("returns full color when no emphasis is active", () => {
    const refs = makeRefs();
    const series = buildSeriesConfig(lines, "step", 1.5, refs);
    const u = fakeUPlot(series);

    // series[0] is X-axis, data series start at index 1
    expect(getStroke(series[1], u, 1)).toBe("#ff0000");
    expect(getStroke(series[2], u, 2)).toBe("#00ff00");
    expect(getStroke(series[3], u, 3)).toBe("#0000ff");
  });

  it("highlights the locally focused series and dims others", () => {
    const refs = makeRefs({ lastFocusedSeriesRef: { current: 2 } }); // "accuracy"
    const series = buildSeriesConfig(lines, "step", 1.5, refs);
    const u = fakeUPlot(series);

    const lossStroke = getStroke(series[1], u, 1);
    const accuracyStroke = getStroke(series[2], u, 2);
    const lrStroke = getStroke(series[3], u, 3);

    // Focused series gets full color
    expect(accuracyStroke).toBe("#00ff00");

    // Other series are dimmed (contain rgba with low alpha)
    expect(lossStroke).toMatch(/rgba\(.+,\s*0\.05\)/);
    expect(lrStroke).toMatch(/rgba\(.+,\s*0\.05\)/);
  });

  it("highlights matching cross-chart series and dims non-matching", () => {
    const refs = makeRefs({ crossChartRunIdRef: { current: "accuracy" } });
    const series = buildSeriesConfig(lines, "step", 1.5, refs);
    const u = fakeUPlot(series);

    // "accuracy" is highlighted by cross-chart
    expect(getStroke(series[2], u, 2)).toBe("#00ff00");

    // Others are dimmed
    expect(getStroke(series[1], u, 1)).toMatch(/rgba\(.+,\s*0\.05\)/);
    expect(getStroke(series[3], u, 3)).toMatch(/rgba\(.+,\s*0\.05\)/);
  });

  /**
   * Regression test for the single-run "All Metrics" view bug:
   *
   * When Chart A (metric="loss") is hovered, it broadcasts crossChartLabel="loss"
   * to all charts. Chart B (metric="accuracy") has no series named "loss", so
   * crossChartLabel doesn't match any of its series. Previously, this caused ALL
   * series in Chart B to be dimmed (isFocusActive=true, isHighlighted=false).
   *
   * The fix ensures crossChartRunIdRef is only set on charts that have a
   * matching series. This test verifies that when crossChartRunIdRef is null
   * (because the chart has no matching series), all series render at full color.
   */
  it("does NOT dim series when crossChartRunIdRef is null (no matching series in this chart)", () => {
    // This simulates a chart that correctly has crossChartRunIdRef=null
    // because it doesn't contain the highlighted series
    const refs = makeRefs({ crossChartRunIdRef: { current: null } });
    const singleMetricLines = [makeLine("accuracy", "#00ff00")];
    const series = buildSeriesConfig(singleMetricLines, "step", 1.5, refs);
    const u = fakeUPlot(series);

    // Should render at full color - no dimming
    expect(getStroke(series[1], u, 1)).toBe("#00ff00");
  });

  /**
   * Documents what happens when crossChartRunIdRef is set to a label that
   * does NOT match any series in this chart. With the fix in line-uplot.tsx,
   * this scenario should never occur (the ref is only set when there's a match).
   * But if it did, all series would be dimmed - this test documents that behavior.
   */
  it("dims all series when crossChartRunIdRef is set but matches no series (edge case)", () => {
    const refs = makeRefs({ crossChartRunIdRef: { current: "nonexistent" } });
    const singleMetricLines = [makeLine("accuracy", "#00ff00")];
    const series = buildSeriesConfig(singleMetricLines, "step", 1.5, refs);
    const u = fakeUPlot(series);

    // When crossChartLabel is set but doesn't match, isFocusActive=true and
    // isHighlighted=false → series is dimmed. The fix prevents this scenario
    // by not setting crossChartRunIdRef when there's no matching series.
    expect(getStroke(series[1], u, 1)).toMatch(/rgba\(.+,\s*0\.05\)/);
  });

  it("local focus takes priority over cross-chart highlight", () => {
    const refs = makeRefs({
      lastFocusedSeriesRef: { current: 1 }, // "loss"
      crossChartRunIdRef: { current: "accuracy" },
    });
    const series = buildSeriesConfig(lines, "step", 1.5, refs);
    const u = fakeUPlot(series);

    // Local focus on "loss" should win
    expect(getStroke(series[1], u, 1)).toBe("#ff0000");
    // Others dimmed
    expect(getStroke(series[2], u, 2)).toMatch(/rgba\(.+,\s*0\.05\)/);
  });

  it("table highlight works when no other emphasis is active", () => {
    const refs = makeRefs({ tableHighlightRef: { current: "run-1" } });
    const linesWithId: LineData[] = [
      { ...makeLine("loss", "#ff0000"), seriesId: "run-1:loss" },
      { ...makeLine("accuracy", "#00ff00"), seriesId: "run-2:accuracy" },
    ];
    const series = buildSeriesConfig(linesWithId, "step", 1.5, refs);
    const u = fakeUPlot(series);

    // "run-1:loss" starts with "run-1:" so it matches tableId="run-1"
    expect(getStroke(series[1], u, 1)).toBe("#ff0000");
    // "run-2:accuracy" does not match
    expect(getStroke(series[2], u, 2)).toMatch(/rgba\(.+,\s*0\.05\)/);
  });
});
