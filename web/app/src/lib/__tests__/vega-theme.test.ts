import { describe, it, expect } from "vitest";
import { vegaConfig, LEGEND_SYMBOL_LIMIT } from "../vega-theme";

describe("vegaConfig", () => {
  it("caps legend rows so a many-run legend can't take over the panel", () => {
    expect(vegaConfig("dark").legend.symbolLimit).toBe(LEGEND_SYMBOL_LIMIT);
    expect(LEGEND_SYMBOL_LIMIT).toBeLessThan(25);
  });

  /**
   * Run labels ("custom-charts-all-r07 (BL7-764)") differ only at the end, and
   * Vega's labelLimit truncates at the end — capping it makes every legend row
   * read the same and the legend stops identifying runs. Guarded because
   * capping the width is the obvious-looking next tweak.
   */
  it("does not cap legend label width", () => {
    expect(vegaConfig("dark").legend).not.toHaveProperty("labelLimit");
  });

  it("themes chrome per theme without touching mark colours", () => {
    const dark = vegaConfig("dark");
    const light = vegaConfig("light");
    expect(dark.axis.labelColor).not.toBe(light.axis.labelColor);
    expect(dark.background).toBe("transparent");
    expect(dark).not.toHaveProperty("range");
  });
});
