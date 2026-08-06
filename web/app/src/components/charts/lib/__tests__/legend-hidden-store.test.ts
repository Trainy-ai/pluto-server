import { describe, it, expect } from "vitest";
import {
  applyChartVisibility,
  isSeriesVisible,
  ownerSeriesId,
  type LegendLine,
} from "../legend-hidden-store";

function makeChart(seriesIds: (string | undefined)[], shown: boolean[] = []) {
  const series: { show?: boolean; _seriesId?: string; label?: string }[] = [
    { label: "x" },
    ...seriesIds.map((id, i) => ({
      show: shown[i] ?? true,
      _seriesId: id,
    })),
  ];
  const calls: { i: number; show: boolean; fire?: boolean }[] = [];
  return {
    chart: {
      series,
      setSeries(i: number, opts: { show: boolean }, fire?: boolean) {
        series[i].show = opts.show;
        calls.push({ i, show: opts.show, fire });
      },
    },
    calls,
  };
}

describe("ownerSeriesId", () => {
  it("resolves envelope companions to the parent series id", () => {
    const lines: LegendLine[] = [
      { label: "loss", seriesId: "runA:loss" },
      {
        label: "loss_env_min",
        seriesId: "runA:loss_env_min",
        envelopeOf: "loss",
      },
      {
        label: "loss_env_max",
        seriesId: "runA:loss_env_max",
        envelopeOf: "loss",
      },
    ];
    expect(ownerSeriesId(lines[1], lines)).toBe("runA:loss");
    expect(ownerSeriesId(lines[2], lines)).toBe("runA:loss");
  });
});

describe("isSeriesVisible with chart-local overrides", () => {
  it("lets a parent shown override beat the runs-table hide", () => {
    const overrides = new Map([["runA:loss", true]]);
    const hidden = new Set(["runA"]);
    expect(isSeriesVisible("runA:loss", overrides, hidden)).toBe(true);
  });
});

describe("applyChartVisibility", () => {
  it("keeps envelope bands drawn when the parent has a local un-hide", () => {
    // Runs table still hides runA, but this chart overrode the parent to shown.
    // Companions must follow the owner — looking up their own seriesId would
    // miss the override and hide the bands while the main line stays drawn.
    const lines: LegendLine[] = [
      { label: "loss", seriesId: "runA:loss" },
      {
        label: "loss_env_min",
        seriesId: "runA:loss_env_min",
        envelopeOf: "loss",
      },
      {
        label: "loss_env_max",
        seriesId: "runA:loss_env_max",
        envelopeOf: "loss",
      },
    ];
    const { chart, calls } = makeChart(
      ["runA:loss", "runA:loss_env_min", "runA:loss_env_max"],
      [false, false, false],
    );
    const overrides = new Map([["runA:loss", true]]);
    const hidden = new Set(["runA"]);
    const rowRemovals: { i: number; removed: boolean }[] = [];

    const changed = applyChartVisibility(
      chart,
      lines,
      overrides,
      hidden,
      (i, removed) => rowRemovals.push({ i, removed }),
    );

    expect(changed).toBe(true);
    expect(chart.series[1].show).toBe(true);
    expect(chart.series[2].show).toBe(true);
    expect(chart.series[3].show).toBe(true);
    // Local un-hide keeps the legend row (not removed).
    expect(rowRemovals).toEqual([
      { i: 1, removed: false },
      { i: 2, removed: false },
      { i: 3, removed: false },
    ]);
    // Hooks suppressed so applying remote state cannot re-notify.
    expect(calls.every((c) => c.fire === false)).toBe(true);
  });

  it("removes the legend row when the runs table alone hid the run", () => {
    const lines: LegendLine[] = [{ label: "loss", seriesId: "runA:loss" }];
    const { chart } = makeChart(["runA:loss"], [true]);
    const rowRemovals: { i: number; removed: boolean }[] = [];

    applyChartVisibility(
      chart,
      lines,
      new Map(),
      new Set(["runA"]),
      (i, removed) => rowRemovals.push({ i, removed }),
    );

    expect(chart.series[1].show).toBe(false);
    expect(rowRemovals).toEqual([{ i: 1, removed: true }]);
  });
});
