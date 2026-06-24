import { describe, it, expect } from "vitest";
import {
  computeGlobalXDomain,
  computeGlobalMaxFreq,
  computeRidgePolygon,
  ridgeColor,
  hitTestStep,
  hitTestRidgelinePolygons,
  parseBaseColor,
  RIDGELINE_LAYOUT,
} from "../ridgeline-canvas";
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
      maxFreq: Math.max(...freq),
    },
  };
}

describe("computeGlobalXDomain", () => {
  it("returns padded [min, max] across multiple steps with varying bin ranges", () => {
    const steps: HistogramStep[] = [
      makeStep(0, [1, 2, 3], -1, 1),
      makeStep(1, [5, 5, 5], -2, 0),
      makeStep(2, [4, 4, 4], 0, 3),
    ];
    const [xMin, xMax] = computeGlobalXDomain(steps);
    const span = 3 - -2; // 5
    const pad = span * RIDGELINE_LAYOUT.paddingFraction;
    expect(xMin).toBeCloseTo(-2 - pad, 8);
    expect(xMax).toBeCloseTo(3 + pad, 8);
  });

  it("falls back gracefully for empty input", () => {
    expect(computeGlobalXDomain([])).toEqual([0, 1]);
  });

  it("expands a zero-width span so canvas math stays finite", () => {
    const steps: HistogramStep[] = [makeStep(0, [1, 2, 1], 5, 5)];
    const [xMin, xMax] = computeGlobalXDomain(steps);
    expect(xMax).toBeGreaterThan(xMin);
  });
});

describe("computeGlobalMaxFreq", () => {
  it("returns max of per-step maxFreq", () => {
    const steps: HistogramStep[] = [
      makeStep(0, [1, 2, 3], 0, 1),
      makeStep(1, [10, 1, 1], 0, 1),
      makeStep(2, [4, 4, 4], 0, 1),
    ];
    expect(computeGlobalMaxFreq(steps)).toBe(10);
  });

  it("returns 0 for empty input", () => {
    expect(computeGlobalMaxFreq([])).toBe(0);
  });
});

describe("computeRidgePolygon", () => {
  const step = makeStep(0, [1, 2, 1], 0, 3);
  const opts = {
    globalXDomain: [0, 3] as [number, number],
    globalMaxFreq: 2,
    slotBaselineY: 200,
    ridgeHeight: 100,
    xLeft: 0,
    xRight: 300,
  };

  it("returns 2 + bins.num points (bin-center polyline + baseline endpoints)", () => {
    const polygon = computeRidgePolygon(step, opts);
    expect(polygon.length).toBe(2 + 3);
  });

  it("first and last point sit on the slot baseline", () => {
    const polygon = computeRidgePolygon(step, opts);
    expect(polygon[0].y).toBe(opts.slotBaselineY);
    expect(polygon[polygon.length - 1].y).toBe(opts.slotBaselineY);
  });

  it("peak bin (freq === maxFreq) rises by exactly ridgeHeight", () => {
    const polygon = computeRidgePolygon(step, opts);
    const peakY = Math.min(...polygon.map((p) => p.y));
    expect(peakY).toBe(opts.slotBaselineY - opts.ridgeHeight);
  });

  it("maps bin edges across the full xLeft..xRight when bins span the global domain", () => {
    const polygon = computeRidgePolygon(step, opts);
    expect(polygon[0].x).toBeCloseTo(0, 6);
    expect(polygon[polygon.length - 1].x).toBeCloseTo(300, 6);
  });

  it("handles a step whose bins are narrower than the global domain", () => {
    const narrow = makeStep(1, [4, 4], 1, 2);
    const polygon = computeRidgePolygon(narrow, {
      ...opts,
      globalXDomain: [0, 3],
      globalMaxFreq: 4,
    });
    // Polygon is bookended with baseline anchors at xLeft / xRight so
    // the ridge reads as a continuous flat line across the full chart
    // when the user's X clamp is wider than the data's natural range.
    expect(polygon[0].x).toBeCloseTo(0, 6);
    expect(polygon[1].x).toBeCloseTo(100, 6);
    expect(polygon[polygon.length - 2].x).toBeCloseTo(200, 6);
    expect(polygon[polygon.length - 1].x).toBeCloseTo(300, 6);
    expect(polygon[0].y).toBe(opts.slotBaselineY);
    expect(polygon[polygon.length - 1].y).toBe(opts.slotBaselineY);
  });
});

describe("ridgeColor", () => {
  it("returns distinct fill colors for the oldest and newest step", () => {
    const a = ridgeColor("hsl(216, 66%, 60%)", 0, 5, "light");
    const b = ridgeColor("hsl(216, 66%, 60%)", 4, 5, "light");
    expect(a.fill).not.toBe(b.fill);
  });

  it("uses opaque HSL fill (single hue, no alpha) and a solid stroke color", () => {
    const c = ridgeColor("hsl(216, 66%, 60%)", 0, 5, "light");
    expect(c.fill).toMatch(/^hsl\(/);
    expect(c.fill).not.toMatch(/hsla/);
    // Dark-mode stroke is white; light-mode is black.
    expect(c.stroke).toBe("rgb(0, 0, 0)");
    const d = ridgeColor("hsl(216, 66%, 60%)", 0, 5, "dark");
    expect(d.stroke).toBe("rgb(255, 255, 255)");
  });

  it("accepts hex base colors", () => {
    const c = ridgeColor("#3b82f6", 1, 3, "dark");
    expect(c.fill).toMatch(/^hsl\(/);
    expect(c.fill).not.toMatch(/^hsla/);
    expect(c.stroke).toBe("rgb(255, 255, 255)");
  });

  it("falls back to a default color when input is malformed", () => {
    const c = ridgeColor("not-a-color", 0, 2, "light");
    // Default base hue is 216; the dark-end of the ramp shifts to 216+8 = 224.
    expect(c.fill).toMatch(/^hsl\(224\.00,/);
    expect(c.fill).not.toMatch(/^hsla/);
  });
});

describe("parseBaseColor", () => {
  it("parses canonical HSL strings", () => {
    expect(parseBaseColor("hsl(216, 66%, 60%)")).toEqual({ h: 216, s: 66, l: 60 });
  });

  it("parses canonical hex strings", () => {
    const parsed = parseBaseColor("#3b82f6");
    expect(parsed.h).toBeGreaterThan(200);
    expect(parsed.h).toBeLessThan(230);
    expect(parsed.s).toBeGreaterThan(0);
    expect(parsed.l).toBeGreaterThan(0);
  });
});

describe("hitTestStep", () => {
  const height = 400;
  const topMargin = 8;
  const bottomMargin = 24;
  const numSteps = 10;

  it("returns 0 for cursor at the top of the usable area", () => {
    expect(hitTestStep(topMargin, numSteps, height, topMargin, bottomMargin)).toBe(0);
  });

  it("returns N-1 for cursor near the bottom of the usable area", () => {
    expect(
      hitTestStep(height - bottomMargin - 1, numSteps, height, topMargin, bottomMargin),
    ).toBe(numSteps - 1);
  });

  it("returns null for cursors above the top margin", () => {
    expect(hitTestStep(topMargin - 1, numSteps, height, topMargin, bottomMargin)).toBeNull();
  });

  it("returns null for cursors below the bottom margin", () => {
    expect(
      hitTestStep(height - bottomMargin, numSteps, height, topMargin, bottomMargin),
    ).toBeNull();
    expect(
      hitTestStep(height - bottomMargin + 50, numSteps, height, topMargin, bottomMargin),
    ).toBeNull();
  });

  it("returns null for zero steps", () => {
    expect(hitTestStep(50, 0, height, topMargin, bottomMargin)).toBeNull();
  });
});

describe("hitTestRidgelinePolygons (transposed / stepsOnX)", () => {
  // Transposed numeric ridgeline: one vertical leftward-pointing polygon
  // per step, anchored RIGHT-edge at xPos[s] which is mapped by STEP
  // VALUE (matches the bars chart above the widget). The hit-test must
  // return the topmost polygon (newest-on-top z-order in transposed
  // mode) that the cursor sits inside.
  const xLeft = 120;
  const xRight = 720; // 600px usable
  const layout = {
    width: 800,
    height: 400,
    topMargin: 8,
    bottomMargin: 24,
    xLeft,
    xRight,
  };
  const globalXDomain: [number, number] = [-2, 2];
  // 3 steps, evenly spaced bins covering the value range.
  const steps: HistogramStep[] = [
    makeStep(0, [0, 5, 0], -2, 2), // step 0, peak at value 0
    makeStep(50, [5, 0, 0], -2, 2), // step 50, peak at value -1.33
    makeStep(100, [0, 0, 5], -2, 2), // step 100, peak at value 1.33
  ];
  const globalMaxFreq = 5;

  it("hits the topmost (newest) step's leftward polygon when polygons overlap", () => {
    // xPos by step value: 0 → 120, 50 → 420, 100 → 720.
    // Topmost polygon = newest = step 100 at xRight=720. Its
    // leftward-pointing polygon, at full freq, walks ~2.4*gap = 720
    // pixels left of its anchor — well past step 50 / step 0.
    // Cursor sits LEFT of step 100's anchor (cursorX=700, anchor=720)
    // at the bin-2 value band (value ~1.33). Bin 2 in step 100 has
    // freq=5 (max), so its polygon extends maxOffset left of anchor.
    // Bin 2 value range is [0.67, 2.0); cursor world Y = 1.33 → in
    // bin 2.
    // Value 1.33 → toCanvasY: yBottom - ((1.33 - (-2))/4) * usableH
    //   yBottom = 376, usableH = 368
    //   = 376 - (3.33/4)*368 = 376 - 306.4 ≈ 69.6
    const cursorX = 700; // just left of step-100 anchor (xRight=720)
    const cursorY = 70; // ~value 1.33 (bin 2 band)
    const hit = hitTestRidgelinePolygons(
      cursorX, cursorY, steps, layout, globalXDomain, globalMaxFreq,
      { stepsOnX: true },
    );
    expect(hit).toBe(2);
  });

  it("returns null when cursor is outside every polygon", () => {
    // Far above the data range — no polygon reaches up here.
    const cursorX = 400;
    const cursorY = layout.topMargin - 1;
    const hit = hitTestRidgelinePolygons(
      cursorX, cursorY, steps, layout, globalXDomain, globalMaxFreq,
      { stepsOnX: true },
    );
    expect(hit).toBeNull();
  });

  it("returns null when cursor lies in a band where the hovered step has freq=0", () => {
    // Step 0 has freq[1] = 5 at bin 1 (value ~0), freq[0] = freq[2] = 0.
    // Hover cursor at step 0's anchor X (xLeft=120) in bin 2 (value ~1.33).
    // Step 0's bin 2 polygon offset = 0 → polyLeftX = baseX → cursor
    // must be exactly at baseX. cursorX=119 is left of baseX, no hit.
    const cursorX = 119;
    const cursorY = 70;
    const hit = hitTestRidgelinePolygons(
      cursorX, cursorY, steps, layout, globalXDomain, globalMaxFreq,
      { stepsOnX: true },
    );
    expect(hit).toBeNull();
  });

});
