import { describe, it, expect } from "vitest";
import type uPlot from "uplot";
import {
  cacheLegendElement,
  markLegendCompanionRow,
  setRunLegendRowHidden,
} from "../legend-visibility";

/**
 * Minimal stand-in for a uPlot instance: only `root` is read by these helpers.
 * `seriesLabels` become legend rows, preceded by the x-axis row uPlot always
 * emits — so legend row N lines up with series N.
 */
function makeChart(seriesLabels: string[]): {
  chart: uPlot;
  root: HTMLDivElement;
  rows: () => HTMLElement[];
} {
  const root = document.createElement("div");
  root.innerHTML = `
    <table class="u-legend">
      <tr class="u-series"><th>step</th></tr>
      ${seriesLabels
        .map((l) => `<tr class="u-series"><th class="u-label">${l}</th></tr>`)
        .join("")}
    </table>`;
  const chart = { root } as unknown as uPlot;
  const rows = () =>
    Array.from(root.querySelectorAll<HTMLElement>("tr.u-series"));
  return { chart, root, rows };
}

describe("setRunLegendRowHidden", () => {
  it("hides the legend row for the matching series index", () => {
    const { chart, rows } = makeChart(["PDE-5", "PDE-6"]);
    setRunLegendRowHidden(chart, 1, true);
    // Row 0 is the x-axis; series 1 is the first data row.
    expect(rows()[1].style.display).toBe("none");
    expect(rows()[2].style.display).toBe("");
  });

  it("restores the row when the run is un-hidden", () => {
    const { chart, rows } = makeChart(["PDE-5"]);
    setRunLegendRowHidden(chart, 1, true);
    setRunLegendRowHidden(chart, 1, false);
    expect(rows()[1].style.display).toBe("");
  });

  it("never restores a smoothing-companion row", () => {
    // Regression: un-hiding a run must not resurrect the "(original)"
    // companion series, which is hidden for an unrelated reason.
    const { chart, rows } = makeChart(["PDE-5", "PDE-5 (original)"]);
    const companion = rows()[2];
    companion.style.display = "none";
    markLegendCompanionRow(companion);

    setRunLegendRowHidden(chart, 2, false);
    expect(companion.style.display).toBe("none");
  });

  it("is a no-op for an out-of-range series index", () => {
    const { chart, rows } = makeChart(["PDE-5"]);
    expect(() => setRunLegendRowHidden(chart, 99, true)).not.toThrow();
    expect(rows().every((r) => r.style.display === "")).toBe(true);
  });

  it("uses the cached legend element after it is re-parented", () => {
    // The fullscreen dialog moves .u-legend out of chart.root into its
    // sidebar. Without the cached reference the helper would find nothing.
    const { chart, root } = makeChart(["PDE-5"]);
    cacheLegendElement(chart);

    const sidebar = document.createElement("div");
    const legend = root.querySelector(".u-legend")!;
    sidebar.appendChild(legend);
    expect(root.querySelector(".u-legend")).toBeNull();

    setRunLegendRowHidden(chart, 1, true);
    const moved = sidebar.querySelectorAll<HTMLElement>("tr.u-series");
    expect(moved[1].style.display).toBe("none");
  });

  it("sets display in the exact form the fullscreen CSS rule matches", () => {
    // index.css preserves hidden rows in the sidebar via
    // [style*="display: none"] — the inline style must serialise that way,
    // otherwise the sidebar's `display: flex` row layout wins.
    const { chart, rows } = makeChart(["PDE-5"]);
    setRunLegendRowHidden(chart, 1, true);
    expect(rows()[1].getAttribute("style")).toContain("display: none");
  });
});
