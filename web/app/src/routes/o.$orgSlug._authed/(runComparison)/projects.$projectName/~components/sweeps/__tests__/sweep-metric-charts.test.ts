import { describe, it, expect } from "vitest";
import { selectSweepChartMetrics } from "../sweep-chart-metrics";

describe("selectSweepChartMetrics", () => {
  it("puts the objective first so the cap can never drop it", () => {
    // `loss` sits 5th here — past the cap — yet it is the sweep's objective and
    // must still be charted.
    const metrics = ["acc", "f1", "precision", "recall", "loss"];
    const picked = selectSweepChartMetrics(metrics, "loss");
    expect(picked[0]).toBe("loss");
    expect(picked).toContain("loss");
  });

  it("caps the list so a run logging 40 metrics doesn't become a wall", () => {
    const many = Array.from({ length: 40 }, (_, i) => `m${i}`);
    expect(selectSweepChartMetrics(many, "m0")).toHaveLength(4);
  });

  it("never repeats the objective", () => {
    const picked = selectSweepChartMetrics(["loss", "acc"], "loss");
    expect(picked.filter((m) => m === "loss")).toHaveLength(1);
  });

  it("keeps the remaining order stable", () => {
    expect(selectSweepChartMetrics(["acc", "loss", "f1"], "loss")).toEqual([
      "loss",
      "acc",
      "f1",
    ]);
  });

  it("handles a sweep that declares no objective", () => {
    expect(selectSweepChartMetrics(["acc", "loss"], null)).toEqual(["acc", "loss"]);
  });

  it("ignores an objective the runs never logged", () => {
    // A sweep config can name a metric no run reported; charting an empty panel
    // for it would be worse than leaving it out.
    expect(selectSweepChartMetrics(["acc"], "val_loss")).toEqual(["acc"]);
  });

  it("returns nothing when no metrics were logged", () => {
    expect(selectSweepChartMetrics([], "loss")).toEqual([]);
  });
});
