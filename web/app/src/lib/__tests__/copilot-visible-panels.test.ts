import { describe, expect, it } from "vitest";
import {
  dashboardPanelNames,
  groupedMetricNames,
  resolvedDashboardView,
  type PanelSectionLike,
} from "@/lib/copilot-visible-panels";

function chart(
  metrics: string[],
  title?: string,
): PanelSectionLike["widgets"][number] {
  return { type: "chart", config: { metrics, ...(title ? { title } : {}) } };
}

describe("dashboardPanelNames", () => {
  it("prefers the widget title over its metrics", () => {
    const sections: PanelSectionLike[] = [
      {
        name: "Training",
        widgets: [chart(["train/loss"], "Loss (smoothed)")],
      },
    ];
    expect(dashboardPanelNames(sections)).toEqual(["Loss (smoothed)"]);
  });

  it("names an untitled widget by its metrics", () => {
    const sections: PanelSectionLike[] = [
      { name: "Training", widgets: [chart(["train/loss", "val/loss"])] },
    ];
    expect(dashboardPanelNames(sections)).toEqual(["train/loss + val/loss"]);
  });

  it("truncates a widget with many metrics but keeps the count", () => {
    const sections: PanelSectionLike[] = [
      { name: "s", widgets: [chart(["a", "b", "c", "d", "e"])] },
    ];
    expect(dashboardPanelNames(sections)).toEqual(["a + b + c +2"]);
  });

  it("falls back to file names, then to the widget type", () => {
    const sections: PanelSectionLike[] = [
      {
        name: "Media",
        widgets: [
          { type: "file-group", config: { files: ["eval-images"] } },
          { type: "panel", config: {} },
        ],
      },
    ];
    expect(dashboardPanelNames(sections)).toEqual(["eval-images", "panel"]);
  });

  it("reports a dynamic section by its pattern rather than guessing matches", () => {
    const sections: PanelSectionLike[] = [
      {
        name: "Per-layer",
        widgets: [],
        dynamicPattern: "train/layer-*/grad_norm",
      },
    ];
    expect(dashboardPanelNames(sections)).toEqual([
      "train/layer-*/grad_norm (dynamic section “Per-layer”)",
    ]);
  });

  it("walks child sections after the parent's own widgets", () => {
    const sections: PanelSectionLike[] = [
      {
        name: "Folder",
        widgets: [chart(["own/metric"])],
        children: [
          { name: "Child A", widgets: [chart(["a/1"])] },
          { name: "Child B", widgets: [chart(["b/1"])] },
        ],
      },
    ];
    expect(dashboardPanelNames(sections)).toEqual([
      "own/metric",
      "a/1",
      "b/1",
    ]);
  });

  it("is empty for a missing or empty config", () => {
    expect(dashboardPanelNames(undefined)).toEqual([]);
    expect(dashboardPanelNames([])).toEqual([]);
    expect(dashboardPanelNames([{ name: "s", widgets: [] }])).toEqual([]);
  });
});

describe("groupedMetricNames", () => {
  it("lists every metric group by group", () => {
    expect(
      groupedMetricNames({
        train: { metrics: [{ name: "train/loss" }, { name: "train/lr" }] },
        eval: { metrics: [{ name: "eval/acc" }] },
      }),
    ).toEqual(["train/loss", "train/lr", "eval/acc"]);
  });

  it("is empty without metrics", () => {
    expect(groupedMetricNames(undefined)).toEqual([]);
    expect(groupedMetricNames({})).toEqual([]);
  });
});

/**
 * Regression: the dashboard query serves the previously fetched view as
 * placeholder data, so publishing straight from it paired the newly selected
 * id with the old dashboard's name and panels.
 */
describe("resolvedDashboardView", () => {
  const viewA = { id: "dv_a", name: "A" };
  const viewB = { id: "dv_b", name: "B" };

  it("returns the view once it matches the selected id", () => {
    expect(resolvedDashboardView("dv_b", viewB)).toBe(viewB);
  });

  it("withholds a stale placeholder from a different dashboard", () => {
    expect(resolvedDashboardView("dv_b", viewA)).toBeUndefined();
  });

  it("withholds while the query has no data at all", () => {
    expect(resolvedDashboardView("dv_b", undefined)).toBeUndefined();
    expect(resolvedDashboardView("dv_b", null)).toBeUndefined();
  });

  it("has nothing to resolve when no dashboard is selected", () => {
    expect(resolvedDashboardView(null, viewA)).toBeUndefined();
    expect(resolvedDashboardView(undefined, viewA)).toBeUndefined();
  });
});
