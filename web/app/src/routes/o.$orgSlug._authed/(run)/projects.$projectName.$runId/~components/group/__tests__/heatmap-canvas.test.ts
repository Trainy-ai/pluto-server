import { describe, it, expect } from "vitest";
import {
  densityColor,
  hitTestCell,
  HEATMAP_LAYOUT,
  type HeatmapLayout,
} from "../heatmap-canvas";
import type { HistogramStep } from "../histogram-canvas-utils";

function makeStep(
  step: number,
  freq: number[],
  binMin: number,
  binMax: number,
): HistogramStep {
  return {
    step,
    histogramData: {
      freq,
      bins: { min: binMin, max: binMax, num: freq.length },
      maxFreq: Math.max(...freq, 0),
    },
  };
}

function parseHslLightness(color: string): number {
  const m = color.match(/hsla?\([^,]+,[^,]+,\s*([\d.]+)%/i);
  if (!m) throw new Error(`Could not parse lightness from ${color}`);
  return parseFloat(m[1]);
}

describe("densityColor", () => {
  const base = "hsl(216, 66%, 60%)";

  it("returns null for freq === 0", () => {
    expect(densityColor(0, 10, base, "linear", "light")).toBeNull();
  });

  it("returns null for negative freq", () => {
    expect(densityColor(-1, 10, base, "linear", "light")).toBeNull();
  });

  it("linear: freq === maxFreq returns the saturated baseColor (light theme)", () => {
    // Ramp goes white → baseColor in light theme, so n=1 ends exactly at
    // baseColor's natural lightness (60). Previously the ramp ended at
    // l-15=45, which made the high-density cells less saturated than the
    // run's identity color.
    const c = densityColor(10, 10, base, "linear", "light")!;
    expect(c).not.toBeNull();
    const l = parseHslLightness(c);
    expect(l).toBeCloseTo(60, 6);
  });

  it("linear: freq close to zero is near white (light theme)", () => {
    // Low end of the light-theme ramp is white (l=100), so empty-ish
    // cells blend into a white background. Previously the formula
    // clamped to l+35=95 even at freq=0+ which kept low cells subtly
    // tinted.
    const c = densityColor(0.0001, 10, base, "linear", "light")!;
    const l = parseHslLightness(c);
    expect(l).toBeGreaterThan(99);
    expect(l).toBeLessThanOrEqual(100);
  });

  it("dark theme: freq === maxFreq returns baseColor, freq → 0 returns near-black", () => {
    // Dark-theme ramp inverts the low end to black so cells blend into
    // a dark background.
    const cMax = densityColor(10, 10, base, "linear", "dark")!;
    const cMin = densityColor(0.0001, 10, base, "linear", "dark")!;
    expect(parseHslLightness(cMax)).toBeCloseTo(60, 6);
    expect(parseHslLightness(cMin)).toBeLessThan(1);
  });

  it("linear: freq === maxFreq/2 is between the two endpoints", () => {
    const cHalf = densityColor(5, 10, base, "linear", "light")!;
    const cMax = densityColor(10, 10, base, "linear", "light")!;
    const cMin = densityColor(0.0001, 10, base, "linear", "light")!;
    const lHalf = parseHslLightness(cHalf);
    const lMax = parseHslLightness(cMax);
    const lMin = parseHslLightness(cMin);
    expect(lHalf).toBeLessThan(lMin);
    expect(lHalf).toBeGreaterThan(lMax);
  });

  it("log: freq === 1 is darker than freq === 0.001 (log emphasizes low density)", () => {
    const c1 = densityColor(1, 100, base, "log", "light")!;
    const cEps = densityColor(0.001, 100, base, "log", "light")!;
    const l1 = parseHslLightness(c1);
    const lEps = parseHslLightness(cEps);
    expect(l1).toBeLessThan(lEps);
  });

  it("log: produces a higher (darker) normalized value than linear at low freq", () => {
    const cLin = densityColor(1, 100, base, "linear", "light")!;
    const cLog = densityColor(1, 100, base, "log", "light")!;
    const lLin = parseHslLightness(cLin);
    const lLog = parseHslLightness(cLog);
    expect(lLog).toBeLessThan(lLin);
  });

  it("stays within HSL's [0, 100] lightness range for any baseColor", () => {
    // No explicit clamp anymore — the ramp lerps between an exact
    // endpoint (0 or 100) and baseColor.l, so by construction it can
    // never exit [0, 100]. Sanity-check with a near-white baseColor
    // where the previous [15, 85] clamp would have kicked in.
    const c = densityColor(1, 1, "hsl(216, 66%, 95%)", "linear", "light")!;
    const l = parseHslLightness(c);
    expect(l).toBeGreaterThanOrEqual(0);
    expect(l).toBeLessThanOrEqual(100);
  });
});

describe("hitTestCell", () => {
  const width = 200;
  const height = 200;
  const { leftMargin, rightMargin, topMargin, bottomMargin } = HEATMAP_LAYOUT;
  const usableWidth = width - leftMargin - rightMargin;
  const usableHeight = height - topMargin - bottomMargin;
  const steps: HistogramStep[] = [
    makeStep(0, [1, 2, 3, 4], 0, 4),
    makeStep(1, [4, 3, 2, 1], 0, 4),
    makeStep(2, [2, 2, 2, 2], 0, 4),
    makeStep(3, [0, 5, 5, 0], 0, 4),
  ];
  const layout: HeatmapLayout = {
    width,
    height,
    leftMargin,
    rightMargin,
    topMargin,
    bottomMargin,
    globalXDomain: [0, 4],
  };

  it("maps a cursor near the top-left to (stepIdx=0, binIdx=0)", () => {
    const cursorX = leftMargin + 1;
    const cursorY = topMargin + 1;
    expect(hitTestCell(cursorX, cursorY, steps, layout)).toEqual({
      stepIdx: 0,
      binIdx: 0,
    });
  });

  it("maps a cursor near the bottom-right to (stepIdx=N-1, binIdx=bins-1)", () => {
    const cursorX = width - rightMargin - 1;
    const cursorY = height - bottomMargin - 1;
    expect(hitTestCell(cursorX, cursorY, steps, layout)).toEqual({
      stepIdx: 3,
      binIdx: 3,
    });
  });

  it("maps a midpoint cursor to the middle (step, bin)", () => {
    const cellWidth = usableWidth / 4;
    const cellHeight = usableHeight / steps.length;
    const cursorX = leftMargin + cellWidth * 2 + 1;
    const cursorY = topMargin + cellHeight * 1 + 1;
    expect(hitTestCell(cursorX, cursorY, steps, layout)).toEqual({
      stepIdx: 1,
      binIdx: 2,
    });
  });

  it("returns null for cursors above the plot area", () => {
    expect(
      hitTestCell(leftMargin + 5, topMargin - 1, steps, layout),
    ).toBeNull();
  });

  it("returns null for cursors below the plot area", () => {
    expect(
      hitTestCell(leftMargin + 5, height - bottomMargin, steps, layout),
    ).toBeNull();
    expect(
      hitTestCell(leftMargin + 5, height + 50, steps, layout),
    ).toBeNull();
  });

  it("returns null for cursors left of the plot area", () => {
    expect(
      hitTestCell(leftMargin - 1, topMargin + 5, steps, layout),
    ).toBeNull();
  });

  it("returns null for cursors right of the plot area", () => {
    expect(
      hitTestCell(width - rightMargin, topMargin + 5, steps, layout),
    ).toBeNull();
  });

  it("returns null for empty step list", () => {
    expect(
      hitTestCell(leftMargin + 5, topMargin + 5, [], layout),
    ).toBeNull();
  });

  it("respects each step's own bin width when bins.num differs across steps", () => {
    const mixedSteps: HistogramStep[] = [
      makeStep(0, [1, 1], 0, 4),
      makeStep(1, [1, 1, 1, 1, 1, 1, 1, 1], 0, 4),
    ];
    const mixedLayout: HeatmapLayout = {
      ...layout,
      globalXDomain: [0, 4],
    };
    const cellHeight = usableHeight / 2;
    // Cursor world-x = 0.5 (halfway through bin 0 in step 0; 8-bin step has binWidth=0.5 so bin 1).
    const worldX = 0.5;
    const cursorX = leftMargin + (worldX / 4) * usableWidth;
    const inStep0Y = topMargin + cellHeight * 0.5;
    const inStep1Y = topMargin + cellHeight * 1.5;
    expect(hitTestCell(cursorX, inStep0Y, mixedSteps, mixedLayout)).toEqual({
      stepIdx: 0,
      binIdx: 0,
    });
    expect(hitTestCell(cursorX, inStep1Y, mixedSteps, mixedLayout)).toEqual({
      stepIdx: 1,
      binIdx: 1,
    });
  });

  it("returns binIdx=-1 when cursor world-x falls outside the active step's bin range (empty-space hover)", () => {
    // The previous contract was `null` — meaning hover died entirely
    // outside the step's bin range. That left big black swaths of the
    // canvas without hover when one outlier step stretched the X axis
    // wider than every other step. The new contract returns
    // `{stepIdx, binIdx: -1}` so the tooltip can still show "step N,
    // no samples in this range" instead of going silent.
    const offsetSteps: HistogramStep[] = [
      makeStep(0, [1, 1, 1, 1], 2, 4),
    ];
    const offsetLayout: HeatmapLayout = {
      ...layout,
      globalXDomain: [0, 4],
    };
    const worldX = 0.5;
    const cursorX = leftMargin + (worldX / 4) * usableWidth;
    const inPlot = topMargin + 5;
    expect(hitTestCell(cursorX, inPlot, offsetSteps, offsetLayout)).toEqual({
      stepIdx: 0,
      binIdx: -1,
    });
  });

  it("returns null when the X domain has zero width", () => {
    const zero: HeatmapLayout = { ...layout, globalXDomain: [1, 1] };
    expect(
      hitTestCell(leftMargin + 5, topMargin + 5, steps, zero),
    ).toBeNull();
  });
});

describe("hitTestCell (transposed / stepsOnX)", () => {
  // Transposed heatmap: steps map to X by STEP VALUE (cell `s` spans
  // [xPos[s], xPos[s+1])), bin VALUES map to Y in math convention
  // (low at bottom, high at top via the flipped toCanvasY). The
  // hit-test mirrors the drawer's geometry exactly.
  const width = 800;
  const height = 400;
  // In transposed mode the histogram-view passes a wider leftMargin
  // (120) and rightMargin=16 to match the bars-chart parent layout.
  const tLeftMargin = 120;
  const tRightMargin = 16;
  const tTopMargin = 8;
  const tBottomMargin = 24;
  const usableWidth = width - tLeftMargin - tRightMargin; // 664
  const usableHeight = height - tTopMargin - tBottomMargin; // 368
  // 3 steps with the same 4-bin layout across the value range [-2, 2].
  const steps: HistogramStep[] = [
    makeStep(0, [1, 0, 0, 0], -2, 2),
    makeStep(50, [0, 1, 0, 0], -2, 2),
    makeStep(100, [0, 0, 1, 0], -2, 2),
  ];
  const layout: HeatmapLayout = {
    width,
    height,
    leftMargin: tLeftMargin,
    rightMargin: tRightMargin,
    topMargin: tTopMargin,
    bottomMargin: tBottomMargin,
    globalXDomain: [-2, 2],
  };

  it("maps cursor inside step 0's cell at xLeft to {stepIdx:0, binIdx:?}", () => {
    // Step 0 anchors at xLeft (tLeftMargin=120) — cursor just inside
    // the chart-area lands in its cell.
    const cursorX = tLeftMargin + 1;
    const cursorY = tTopMargin + usableHeight / 2; // middle Y
    const hit = hitTestCell(cursorX, cursorY, steps, layout, { stepsOnX: true });
    expect(hit).not.toBeNull();
    expect(hit?.stepIdx).toBe(0);
  });

  it("uses STEP VALUE for X, not uniform index", () => {
    // step values [0, 50, 100] → xPos = xLeft + value/100 * usable
    // xPos[0] = 120, xPos[1] = 120 + 332 = 452, xPos[2] = 120 + 664 = 784
    // Cell 0 spans [120, 452). Cursor at x=400 falls in cell 0
    // because 400 < 452 — under uniform spacing (each step = 1/3 of
    // usableWidth), x=400 would map to cell 1.
    const cursorX = 400;
    const cursorY = tTopMargin + usableHeight / 2;
    const hit = hitTestCell(cursorX, cursorY, steps, layout, { stepsOnX: true });
    expect(hit?.stepIdx).toBe(0);
  });

  it("Y axis is math convention — low value at bottom, high at top", () => {
    // World Y inverse: high values at top of canvas. Cursor near the
    // TOP of the chart-area should map to a HIGH value (bin 3 here).
    const cursorX = tLeftMargin + 1; // step 0
    const cursorY = tTopMargin + 1; // near top → high value
    const hit = hitTestCell(cursorX, cursorY, steps, layout, { stepsOnX: true });
    expect(hit?.binIdx).toBe(3);
    // Cursor near bottom → low value (bin 0).
    const cursorYBottom = height - tBottomMargin - 1;
    const hitBottom = hitTestCell(cursorX, cursorYBottom, steps, layout, {
      stepsOnX: true,
    });
    expect(hitBottom?.binIdx).toBe(0);
  });

  it("returns binIdx=-1 when cursor's value falls outside the step's bin range", () => {
    // Step 0's bins cover [-2, 2]. globalXDomain is also [-2, 2] so a
    // cursor inside the chart area always lands in-range. Use a step
    // whose bins are narrower than the domain to exercise the
    // out-of-range branch.
    const narrowSteps: HistogramStep[] = [
      makeStep(0, [1, 1], -0.5, 0.5),
      makeStep(50, [1, 1, 1], -2, 2),
    ];
    // Cursor at step 0's anchor, at world Y = 1.5 (outside step 0's
    // [-0.5, 0.5] but inside the domain [-2, 2]).
    // World Y 1.5 → toCanvasY: yBottom - ((1.5 + 2)/4) * usableH
    //   = 376 - 0.875*368 = 54
    const hit = hitTestCell(tLeftMargin + 1, 54, narrowSteps, layout, {
      stepsOnX: true,
    });
    expect(hit?.stepIdx).toBe(0);
    expect(hit?.binIdx).toBe(-1);
  });

  it("returns null when cursor is outside the chart area", () => {
    // Above chart-area top.
    expect(
      hitTestCell(tLeftMargin + 5, tTopMargin - 1, steps, layout, {
        stepsOnX: true,
      }),
    ).toBeNull();
    // Left of xLeft.
    expect(
      hitTestCell(tLeftMargin - 1, tTopMargin + 5, steps, layout, {
        stepsOnX: true,
      }),
    ).toBeNull();
  });
});
