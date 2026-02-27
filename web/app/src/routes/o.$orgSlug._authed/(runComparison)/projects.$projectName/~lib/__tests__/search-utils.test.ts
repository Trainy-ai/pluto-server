import { describe, it, expect } from "vitest";
import { searchUtils } from "../search-utils";
import type { GroupedMetrics } from "@/lib/grouping/types";
import type { Widget } from "../../~types/dashboard-types";

const MOCK_GROUPED: GroupedMetrics = {
  train: {
    groupName: "train",
    metrics: [
      {
        name: "train/loss",
        type: "METRIC",
        data: [{ runId: "1", runName: "run-1", color: "#f00", status: "COMPLETED" }],
      },
      {
        name: "train/accuracy",
        type: "METRIC",
        data: [{ runId: "1", runName: "run-1", color: "#f00", status: "COMPLETED" }],
      },
    ],
  },
  val: {
    groupName: "val",
    metrics: [
      {
        name: "val/loss",
        type: "METRIC",
        data: [{ runId: "1", runName: "run-1", color: "#f00", status: "COMPLETED" }],
      },
    ],
  },
};

describe("searchUtils.filterMetrics with fuzzy search", () => {
  const searchIndex = searchUtils.createSearchIndex(MOCK_GROUPED);

  it("returns all metrics when query is empty", () => {
    const state = searchUtils.createSearchState("", false);
    const result = searchUtils.filterMetrics("train", MOCK_GROUPED["train"].metrics, searchIndex, state);
    expect(result).toHaveLength(2);
  });

  it("fuzzy matches — 'lloss' finds loss metric", () => {
    const state = searchUtils.createSearchState("lloss", false);
    const result = searchUtils.filterMetrics("train", MOCK_GROUPED["train"].metrics, searchIndex, state);
    expect(result.some((m) => m.name.includes("loss"))).toBe(true);
  });

  it("regex mode still works unchanged", () => {
    const state = searchUtils.createSearchState("train.*loss", true);
    const result = searchUtils.filterMetrics("train", MOCK_GROUPED["train"].metrics, searchIndex, state);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("train/loss");
  });
});

describe("searchUtils.doesGroupMatch with fuzzy search", () => {
  const searchIndex = searchUtils.createSearchIndex(MOCK_GROUPED);

  it("fuzzy matches — 'trian' matches group 'train'", () => {
    const state = searchUtils.createSearchState("trian", false);
    const result = searchUtils.doesGroupMatch("train", searchIndex, state);
    expect(result).toBe(true);
  });

  it("returns false for unrelated query", () => {
    const state = searchUtils.createSearchState("zzzzzzzzz", false);
    const result = searchUtils.doesGroupMatch("train", searchIndex, state);
    expect(result).toBe(false);
  });

  it("regex mode still works", () => {
    const state = searchUtils.createSearchState("^val", true);
    const result = searchUtils.doesGroupMatch("val", searchIndex, state);
    expect(result).toBe(true);
  });
});

// --- Widget search matching tests ---

function makeChartWidget(metrics: string[], title?: string): Widget {
  return {
    id: "w1",
    type: "chart",
    config: { metrics, xAxis: "step", yAxisScale: "linear", xAxisScale: "linear", aggregation: "LAST", showOriginal: false, title },
    layout: { x: 0, y: 0, w: 6, h: 4 },
  };
}

function makeScatterWidget(xMetric: string, yMetric: string): Widget {
  return {
    id: "w2",
    type: "scatter",
    config: { xMetric, yMetric, xScale: "linear", yScale: "linear", xAggregation: "LAST", yAggregation: "LAST" },
    layout: { x: 0, y: 0, w: 6, h: 4 },
  };
}

function makeSingleValueWidget(metric: string): Widget {
  return {
    id: "w3",
    type: "single-value",
    config: { metric, aggregation: "LAST" },
    layout: { x: 0, y: 0, w: 3, h: 2 },
  };
}

function makeFileSeriesWidget(logName: string): Widget {
  return {
    id: "w4",
    type: "file-series",
    config: { logName, mediaType: "IMAGE" as const },
    layout: { x: 0, y: 0, w: 6, h: 4 },
  };
}

describe("searchUtils.getWidgetSearchTerms", () => {
  it("extracts metric names from chart widget", () => {
    const widget = makeChartWidget(["train/loss", "train/accuracy"]);
    const terms = searchUtils.getWidgetSearchTerms(widget);
    expect(terms).toEqual(["train/loss", "train/accuracy"]);
  });

  it("strips glob: and regex: prefixes from chart metrics", () => {
    const widget = makeChartWidget(["glob:train/*", "regex:.+/loss", "val/acc"]);
    const terms = searchUtils.getWidgetSearchTerms(widget);
    expect(terms).toEqual(["train/*", ".+/loss", "val/acc"]);
  });

  it("includes title when present", () => {
    const widget = makeChartWidget(["train/loss"], "Training Loss");
    const terms = searchUtils.getWidgetSearchTerms(widget);
    expect(terms).toContain("training loss");
    expect(terms).toContain("train/loss");
  });

  it("extracts metrics from scatter widget", () => {
    const widget = makeScatterWidget("lr", "loss");
    const terms = searchUtils.getWidgetSearchTerms(widget);
    expect(terms).toContain("lr");
    expect(terms).toContain("loss");
  });

  it("extracts metric from single-value widget", () => {
    const widget = makeSingleValueWidget("val/accuracy");
    const terms = searchUtils.getWidgetSearchTerms(widget);
    expect(terms).toContain("val/accuracy");
  });

  it("extracts logName from file-series widget", () => {
    const widget = makeFileSeriesWidget("images/train");
    const terms = searchUtils.getWidgetSearchTerms(widget);
    expect(terms).toContain("images/train");
  });
});

describe("searchUtils.doesWidgetMatchSearch", () => {
  it("returns true when query is empty", () => {
    const widget = makeChartWidget(["train/loss"]);
    const state = searchUtils.createSearchState("", false);
    expect(searchUtils.doesWidgetMatchSearch(widget, state)).toBe(true);
  });

  it("matches chart widget by metric name", () => {
    const widget = makeChartWidget(["train/loss", "train/accuracy"]);
    const state = searchUtils.createSearchState("loss", false);
    expect(searchUtils.doesWidgetMatchSearch(widget, state)).toBe(true);
  });

  it("does not match unrelated query", () => {
    const widget = makeChartWidget(["train/loss"]);
    const state = searchUtils.createSearchState("zzzzzzzzz", false);
    expect(searchUtils.doesWidgetMatchSearch(widget, state)).toBe(false);
  });

  it("matches by widget title", () => {
    const widget = makeChartWidget(["m1"], "My Training Chart");
    const state = searchUtils.createSearchState("training", false);
    expect(searchUtils.doesWidgetMatchSearch(widget, state)).toBe(true);
  });

  it("matches with regex mode", () => {
    const widget = makeChartWidget(["train/loss", "val/loss"]);
    const state = searchUtils.createSearchState("^train", true);
    expect(searchUtils.doesWidgetMatchSearch(widget, state)).toBe(true);
  });

  it("does not match with non-matching regex", () => {
    const widget = makeChartWidget(["train/loss"]);
    const state = searchUtils.createSearchState("^val", true);
    expect(searchUtils.doesWidgetMatchSearch(widget, state)).toBe(false);
  });

  it("does not match widgets with similar prefix but different metric", () => {
    const widget = makeChartWidget(["train/lr"]);
    const state = searchUtils.createSearchState("train/loss", false);
    expect(searchUtils.doesWidgetMatchSearch(widget, state)).toBe(false);
  });

  it("matches scatter widget by metric name", () => {
    const widget = makeScatterWidget("learning_rate", "loss");
    const state = searchUtils.createSearchState("learning_rate", false);
    expect(searchUtils.doesWidgetMatchSearch(widget, state)).toBe(true);
  });

  it("matches file-series widget by logName", () => {
    const widget = makeFileSeriesWidget("images/predictions");
    const state = searchUtils.createSearchState("predictions", false);
    expect(searchUtils.doesWidgetMatchSearch(widget, state)).toBe(true);
  });
});
