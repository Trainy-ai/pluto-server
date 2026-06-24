import { describe, it, expect } from "vitest";
import { getWidgetTitle, hasWidgetPatterns } from "../widget-utils";
import type {
  DistributionsEntry,
  Widget,
} from "../../../~types/dashboard-types";

// ─── Helpers ─────────────────────────────────────────────────────────────

function chartWidget(overrides: { metrics?: string[] } = {}): Widget {
  return {
    id: "w-1",
    type: "chart",
    config: {
      metrics: overrides.metrics ?? [],
      xAxis: "step",
      yAxisScale: "linear",
      xAxisScale: "linear",
      aggregation: "LAST",
      showOriginal: false,
    } as unknown as Widget["config"],
    layout: { x: 0, y: 0, w: 6, h: 4 },
  };
}

function distributionsWidget(entries: DistributionsEntry[]): Widget {
  return {
    id: "w-d",
    type: "distributions",
    config: { entries } as unknown as Widget["config"],
    layout: { x: 0, y: 0, w: 6, h: 4 },
  };
}

function barsEntry(prefix: string): DistributionsEntry {
  return {
    kind: "bars",
    prefix,
    viewMode: "ridgeline",
    depthAxis: "step",
    ignoreOutliers: true,
    stepsOnX: false,
  };
}

function histogramEntry(metric: string): DistributionsEntry {
  return {
    kind: "histogram",
    metric,
    viewMode: "ridgeline",
    ignoreOutliers: true,
    stepsOnX: false,
  };
}

// ─── Chart widget titles ─────────────────────────────────────────────────
// Chart widgets are now line-only (bars[] was stripped in the distributions
// refactor). These tests pin the title behavior for the line-only case.

describe("getWidgetTitle — chart widget (line-only)", () => {
  it("returns 'Chart' for an empty metrics list", () => {
    expect(getWidgetTitle(chartWidget({}))).toBe("Chart");
  });

  it("returns the single metric label for one metric", () => {
    expect(getWidgetTitle(chartWidget({ metrics: ["train/loss"] }))).toBe(
      "train/loss",
    );
  });

  it("comma-joins 2-3 metrics", () => {
    expect(
      getWidgetTitle(
        chartWidget({ metrics: ["train/loss", "val/loss", "lr"] }),
      ),
    ).toBe("train/loss, val/loss, lr");
  });

  it("collapses 4+ metrics to 'N metrics'", () => {
    expect(
      getWidgetTitle(
        chartWidget({
          metrics: ["a", "b", "c", "d", "e"],
        }),
      ),
    ).toBe("5 metrics");
  });
});

// ─── Distributions widget titles ────────────────────────────────────────
// The distributions widget mixes bars (kind='bars') and numeric histograms
// (kind='histogram'). 1-3 entries → joined labels; 4+ → kind breakdown.

describe("getWidgetTitle — distributions widget", () => {
  it("returns 'Distributions' for an empty entries list", () => {
    expect(getWidgetTitle(distributionsWidget([]))).toBe("Distributions");
  });

  it("single bars entry renders as 'prefix/*' (trailing slash collapsed)", () => {
    expect(
      getWidgetTitle(distributionsWidget([barsEntry("training/dataset/")])),
    ).toBe("training/dataset/*");
  });

  it("single histogram entry renders as the metric name verbatim", () => {
    expect(
      getWidgetTitle(
        distributionsWidget([histogramEntry("distributions/weights")]),
      ),
    ).toBe("distributions/weights");
  });

  it("2-3 mixed entries comma-join their labels", () => {
    expect(
      getWidgetTitle(
        distributionsWidget([
          barsEntry("training/dataset/"),
          histogramEntry("distributions/weights"),
        ]),
      ),
    ).toBe("training/dataset/*, distributions/weights");
  });

  it("4+ entries: 'N bar charts' when only bars", () => {
    expect(
      getWidgetTitle(
        distributionsWidget([
          barsEntry("a/"),
          barsEntry("b/"),
          barsEntry("c/"),
          barsEntry("d/"),
        ]),
      ),
    ).toBe("4 bar charts");
  });

  it("4+ entries: 'N histograms' when only histograms", () => {
    expect(
      getWidgetTitle(
        distributionsWidget([
          histogramEntry("a"),
          histogramEntry("b"),
          histogramEntry("c"),
          histogramEntry("d"),
        ]),
      ),
    ).toBe("4 histograms");
  });

  it("4+ entries: mixed kinds → 'N bar charts · M histograms'", () => {
    expect(
      getWidgetTitle(
        distributionsWidget([
          barsEntry("a/"),
          barsEntry("b/"),
          histogramEntry("c"),
          histogramEntry("d"),
        ]),
      ),
    ).toBe("2 bar charts · 2 histograms");
  });

  it("singular bar chart in mixed breakdown", () => {
    expect(
      getWidgetTitle(
        distributionsWidget([
          barsEntry("a/"),
          histogramEntry("b"),
          histogramEntry("c"),
          histogramEntry("d"),
        ]),
      ),
    ).toBe("1 bar chart · 3 histograms");
  });

  it("singular histogram in mixed breakdown", () => {
    expect(
      getWidgetTitle(
        distributionsWidget([
          barsEntry("a/"),
          barsEntry("b/"),
          barsEntry("c/"),
          histogramEntry("d"),
        ]),
      ),
    ).toBe("3 bar charts · 1 histogram");
  });
});

// ─── hasWidgetPatterns ───────────────────────────────────────────────────
// Distributions widgets are concrete picks (no glob/regex), so they should
// never be classified as "pattern" widgets the way chart/file-group can be.

describe("hasWidgetPatterns", () => {
  it("returns false for a line-only chart with no glob/regex metrics", () => {
    expect(hasWidgetPatterns(chartWidget({ metrics: ["train/loss"] }))).toBe(
      false,
    );
  });

  it("returns false for a distributions widget regardless of contents", () => {
    expect(
      hasWidgetPatterns(
        distributionsWidget([
          barsEntry("training/dataset/"),
          histogramEntry("distributions/weights"),
        ]),
      ),
    ).toBe(false);
  });
});
