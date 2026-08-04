import { describe, it, expect } from "vitest";
import {
  extractCaptionFromDOM,
  extractLegendEntries,
  parseDashAttr,
} from "../chart-export-utils";

function makeDiv(html = ""): HTMLDivElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

describe("extractCaptionFromDOM", () => {
  it("returns null when no data-export-* attrs are present anywhere", () => {
    const div = makeDiv("<div><span>nothing here</span></div>");
    expect(extractCaptionFromDOM(div)).toBeNull();
  });

  it("reads data-export-step + data-export-runs off the container itself", () => {
    // Regression: an earlier version used querySelector only, which
    // searches descendants. Histogram fullscreen's chartContainerRef
    // points AT the stamped element, so the attrs would be invisible.
    const div = makeDiv();
    div.setAttribute("data-export-step", "step 9666");
    div.setAttribute(
      "data-export-runs",
      JSON.stringify([{ name: "run-01", color: "#abc" }]),
    );
    expect(extractCaptionFromDOM(div)).toEqual({
      step: "step 9666",
      runs: [{ name: "run-01", color: "#abc" }],
    });
  });

  it("reads attrs from a descendant (dashboard widget-card path)", () => {
    const div = makeDiv(
      `<div data-export-step="step 25" data-export-runs='[{"name":"r","color":"#fff"}]'></div>`,
    );
    expect(extractCaptionFromDOM(div)).toEqual({
      step: "step 25",
      runs: [{ name: "r", color: "#fff" }],
    });
  });

  it("returns step only when data-export-runs is missing", () => {
    const div = makeDiv();
    div.setAttribute("data-export-step", "step 7");
    expect(extractCaptionFromDOM(div)).toEqual({
      step: "step 7",
      runs: undefined,
    });
  });

  it("returns runs only when data-export-step is missing", () => {
    // Ridgeline/Heatmap depth=step layout: many steps shown for one run,
    // no single "current step" to surface — runs alone is the caption.
    const div = makeDiv();
    div.setAttribute(
      "data-export-runs",
      JSON.stringify([{ name: "ridge-run", color: "#123" }]),
    );
    expect(extractCaptionFromDOM(div)).toEqual({
      step: undefined,
      runs: [{ name: "ridge-run", color: "#123" }],
    });
  });

  it("returns null when both attrs are present but blank/empty", () => {
    const div = makeDiv();
    div.setAttribute("data-export-step", "   ");
    div.setAttribute("data-export-runs", "[]");
    expect(extractCaptionFromDOM(div)).toBeNull();
  });

  it("ignores malformed JSON in data-export-runs but keeps the step", () => {
    const div = makeDiv();
    div.setAttribute("data-export-step", "step 1");
    div.setAttribute("data-export-runs", "not-json-{");
    expect(extractCaptionFromDOM(div)).toEqual({
      step: "step 1",
      runs: undefined,
    });
  });

  it("filters out run entries missing name or color", () => {
    const div = makeDiv();
    div.setAttribute(
      "data-export-runs",
      JSON.stringify([
        { name: "ok", color: "#000" },
        { name: "" }, // missing color, empty name
        { color: "#fff" }, // missing name
        "string entry", // not an object
        null,
      ]),
    );
    expect(extractCaptionFromDOM(div)).toEqual({
      step: undefined,
      runs: [{ name: "ok", color: "#000" }],
    });
  });

  it("returns null when the filtered runs list is empty (no real chips left)", () => {
    const div = makeDiv();
    div.setAttribute(
      "data-export-runs",
      JSON.stringify([{ name: "" }, { color: "#abc" }]),
    );
    expect(extractCaptionFromDOM(div)).toBeNull();
  });
});

describe("parseDashAttr", () => {
  it("returns undefined for null", () => {
    expect(parseDashAttr(null)).toBeUndefined();
  });

  it("parses a comma-separated dash array", () => {
    expect(parseDashAttr("5,5")).toEqual([5, 5]);
    expect(parseDashAttr("16, 6, 4, 6")).toEqual([16, 6, 4, 6]);
  });

  it("filters out zero / negative / non-finite values", () => {
    // Comes up if a series stamps `data-dash="0,5"` to mean "solid"
    // by accident — keep the legitimate 5, drop the 0.
    expect(parseDashAttr("0,5,-2,NaN")).toEqual([5]);
  });

  it("returns undefined when no positive values remain", () => {
    expect(parseDashAttr("")).toBeUndefined();
    expect(parseDashAttr("0,-1")).toBeUndefined();
  });
});

describe("extractLegendEntries", () => {
  /** One legend row per series, preceded by uPlot's x-axis row. */
  function makeLegend(
    rows: { label: string; style?: string; className?: string }[],
  ): HTMLDivElement {
    return makeDiv(`
      <table class="u-legend">
        <tr class="u-series"><th>step</th></tr>
        ${rows
          .map(
            (r) =>
              `<tr class="u-series ${r.className ?? ""}" style="${r.style ?? ""}">
                 <th class="u-marker" style="border-color: rgb(1,2,3)"></th>
                 <th class="u-label">${r.label}</th>
               </tr>`,
          )
          .join("")}
      </table>`);
  }

  it("skips rows hidden with display:none", () => {
    // This is what makes hiding a run drop it from the exported PNG.
    const el = makeLegend([
      { label: "PDE-5", style: "display: none" },
      { label: "PDE-6" },
    ]);
    expect(extractLegendEntries(el).map((e) => e.label)).toEqual(["PDE-6"]);
  });

  it("skips rows switched off via the tooltip or legend row (.u-off)", () => {
    // Such a row stays in the ON-SCREEN legend so it can be clicked back on,
    // but the export must show only what is actually drawn — a PNG can't be
    // clicked, so a greyed entry there just misrepresents the chart.
    const el = makeLegend([
      { label: "PDE-5", className: "u-off" },
      { label: "PDE-6" },
    ]);
    expect(extractLegendEntries(el).map((e) => e.label)).toEqual(["PDE-6"]);
  });

  it("skips a row hidden by both mechanisms at once", () => {
    const el = makeLegend([
      { label: "PDE-5", className: "u-off", style: "display: none" },
      { label: "PDE-6" },
    ]);
    expect(extractLegendEntries(el).map((e) => e.label)).toEqual(["PDE-6"]);
  });

  it("returns nothing when every run is hidden", () => {
    const el = makeLegend([
      { label: "PDE-5", style: "display: none" },
      { label: "PDE-6", style: "display: none" },
    ]);
    expect(extractLegendEntries(el)).toEqual([]);
  });
});
