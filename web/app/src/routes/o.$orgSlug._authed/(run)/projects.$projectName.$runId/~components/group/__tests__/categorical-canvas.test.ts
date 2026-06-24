import { describe, it, expect } from "vitest";
import {
  CATEGORICAL_LAYOUT,
  categoricalBinCenterX,
  categoricalLabelStride,
  colorToRgb,
  computeCategoricalGlobalMaxFreq,
  computeCategoricalRidgePolygon,
  hitTestCategoricalBar,
  hitTestCategoricalGrid,
  hitTestCategoricalRidgelinePolygons,
  mixColors,
  truncateLabel,
  type CategoricalLayoutGeometry,
  type CategoricalStep,
} from "../categorical-canvas";

function makeStep(step: number, freq: number[], labels: string[]): CategoricalStep {
  return {
    step,
    bars: {
      freq,
      labels,
      maxFreq: Math.max(0, ...freq),
      shape: "categorical",
      type: "Histogram",
    },
  };
}

describe("categoricalBinCenterX", () => {
  it("places the first bin center at 0.5/N of the usable width", () => {
    const x = categoricalBinCenterX(0, 10, 0, 100);
    expect(x).toBeCloseTo(5, 8);
  });

  it("places the last bin center at (N-0.5)/N of the usable width", () => {
    const x = categoricalBinCenterX(9, 10, 0, 100);
    expect(x).toBeCloseTo(95, 8);
  });

  it("returns xLeft when numBins is zero (degenerate)", () => {
    expect(categoricalBinCenterX(0, 0, 50, 100)).toBe(50);
  });
});

describe("categoricalLabelStride", () => {
  it("returns 1 when there's plenty of space per slot", () => {
    expect(categoricalLabelStride(5, 1000, 36)).toBe(1);
  });

  it("returns >1 when slot width is below the min spacing", () => {
    // 100 labels in 400px = 4px/slot; min spacing 36px → stride 9
    const s = categoricalLabelStride(100, 400, 36);
    expect(s).toBe(9);
  });

  it("returns 1 for a single bin (no overlap to avoid)", () => {
    expect(categoricalLabelStride(1, 100)).toBe(1);
  });
});

describe("truncateLabel", () => {
  it("returns unchanged labels at or below maxChars", () => {
    expect(truncateLabel("short")).toBe("short");
    expect(truncateLabel("x".repeat(CATEGORICAL_LAYOUT.maxLabelChars))).toBe(
      "x".repeat(CATEGORICAL_LAYOUT.maxLabelChars),
    );
  });

  it("ellipsizes labels beyond maxChars", () => {
    const result = truncateLabel("a".repeat(CATEGORICAL_LAYOUT.maxLabelChars + 5));
    expect(result.endsWith("…")).toBe(true);
    expect(result.length).toBe(CATEGORICAL_LAYOUT.maxLabelChars);
  });
});

describe("computeCategoricalGlobalMaxFreq", () => {
  it("returns 0 for empty steps", () => {
    expect(computeCategoricalGlobalMaxFreq([])).toBe(0);
  });

  it("returns the max across multiple steps", () => {
    const steps = [
      makeStep(0, [10, 20, 5], ["a", "b", "c"]),
      makeStep(1, [50, 5, 5], ["a", "b", "c"]),
      makeStep(2, [5, 5, 30], ["a", "b", "c"]),
    ];
    expect(computeCategoricalGlobalMaxFreq(steps)).toBe(50);
  });
});

describe("computeCategoricalRidgePolygon", () => {
  it("produces N+2 points (left anchor + per-bin centers + right anchor)", () => {
    const step = makeStep(0, [1, 2, 3, 4, 5], ["a", "b", "c", "d", "e"]);
    const poly = computeCategoricalRidgePolygon(step, {
      globalMaxFreq: 5,
      slotBaselineY: 100,
      ridgeHeight: 50,
      xLeft: 0,
      xRight: 100,
    });
    expect(poly.length).toBe(5 + 2);
  });

  it("anchors first and last points at the baseline", () => {
    const step = makeStep(0, [5, 5, 5], ["a", "b", "c"]);
    const poly = computeCategoricalRidgePolygon(step, {
      globalMaxFreq: 5,
      slotBaselineY: 100,
      ridgeHeight: 50,
      xLeft: 0,
      xRight: 100,
    });
    expect(poly[0]).toEqual({ x: 0, y: 100 });
    expect(poly[poly.length - 1]).toEqual({ x: 100, y: 100 });
  });

  it("scales bar height by f / globalMaxFreq * ridgeHeight", () => {
    const step = makeStep(0, [10, 5, 1], ["a", "b", "c"]);
    const poly = computeCategoricalRidgePolygon(step, {
      globalMaxFreq: 10,
      slotBaselineY: 200,
      ridgeHeight: 100,
      xLeft: 0,
      xRight: 300,
    });
    // Skip the leading baseline anchor. Bins are indexed 0..N-1.
    expect(poly[1].y).toBeCloseTo(200 - (10 / 10) * 100, 8);
    expect(poly[2].y).toBeCloseTo(200 - (5 / 10) * 100, 8);
    expect(poly[3].y).toBeCloseTo(200 - (1 / 10) * 100, 8);
  });

  it("returns empty array for zero-bin steps", () => {
    const step = makeStep(0, [], []);
    const poly = computeCategoricalRidgePolygon(step, {
      globalMaxFreq: 1,
      slotBaselineY: 100,
      ridgeHeight: 50,
      xLeft: 0,
      xRight: 100,
    });
    expect(poly).toEqual([]);
  });

  it("falls back to a safe globalMaxFreq when given zero", () => {
    const step = makeStep(0, [0, 0, 0], ["a", "b", "c"]);
    const poly = computeCategoricalRidgePolygon(step, {
      globalMaxFreq: 0,
      slotBaselineY: 100,
      ridgeHeight: 50,
      xLeft: 0,
      xRight: 100,
    });
    // All bars should collapse to baseline (no NaN, no Infinity).
    for (let i = 1; i < poly.length - 1; i++) {
      expect(poly[i].y).toBe(100);
    }
  });

  it("clamps NEGATIVE freq values to 0 (ridges never dip below baseline)", () => {
    // Negative values would otherwise produce y > baseline (below in
    // screen coords) and intrude into the next ridge's territory.
    // Step mode handles signed values with a proper zero-baseline scale;
    // ridgeline / heatmap stays unipolar.
    const step = makeStep(0, [-5, 5, -3], ["a", "b", "c"]);
    const poly = computeCategoricalRidgePolygon(step, {
      globalMaxFreq: 5,
      slotBaselineY: 100,
      ridgeHeight: 50,
      xLeft: 0,
      xRight: 100,
    });
    // Bin 0 freq=-5 → clamped to 0 → peak at baseline (y=100).
    // Bin 1 freq=5 → full peak (y=50).
    // Bin 2 freq=-3 → clamped to 0 → peak at baseline.
    expect(poly[1].y).toBe(100);
    expect(poly[2].y).toBe(50);
    expect(poly[3].y).toBe(100);
  });
});

describe("hitTestCategoricalBar", () => {
  it("returns the label index under the cursor", () => {
    // 10 bins across [0, 100] → slot width 10
    expect(hitTestCategoricalBar(5, 50, 10, 0, 100, 0, 0, 100)).toBe(0);
    expect(hitTestCategoricalBar(55, 50, 10, 0, 100, 0, 0, 100)).toBe(5);
    expect(hitTestCategoricalBar(99, 50, 10, 0, 100, 0, 0, 100)).toBe(9);
  });

  it("returns null when cursor is left of the plot area", () => {
    expect(hitTestCategoricalBar(-1, 50, 10, 0, 100, 0, 0, 100)).toBeNull();
  });

  it("returns null when cursor is right of the plot area", () => {
    expect(hitTestCategoricalBar(100, 50, 10, 0, 100, 0, 0, 100)).toBeNull();
  });

  it("returns null when cursor is above topMargin", () => {
    expect(hitTestCategoricalBar(50, -1, 10, 0, 100, 5, 0, 100)).toBeNull();
  });

  it("returns null when cursor is below the chart (in bottomMargin)", () => {
    // topMargin=0, bottomMargin=20, height=100 → plot ends at y=80
    expect(hitTestCategoricalBar(50, 80, 10, 0, 100, 0, 20, 100)).toBeNull();
  });

  it("returns null when numBins is zero", () => {
    expect(hitTestCategoricalBar(50, 50, 0, 0, 100, 0, 0, 100)).toBeNull();
  });
});

describe("colorToRgb (HSL)", () => {
  it("parses standard hsl()", () => {
    expect(colorToRgb("hsl(0, 100%, 50%)")).toEqual([255, 0, 0]);
    expect(colorToRgb("hsl(120, 100%, 50%)")).toEqual([0, 255, 0]);
  });

  it("parses NEGATIVE hue (regression: ridgeColor emits hsl(-16, …) for red palette runs at t=1)", () => {
    // hsl(-16, 100%, 50%) ≡ hsl(344, 100%, 50%) — wraps to red-pink, not magenta.
    const negative = colorToRgb("hsl(-16, 100%, 50%)");
    const equivalent = colorToRgb("hsl(344, 100%, 50%)");
    expect(negative).not.toBeNull();
    expect(negative).toEqual(equivalent);
  });

  it("normalizes large negative hue via modular wrap", () => {
    // -360 should wrap to 0 (red).
    expect(colorToRgb("hsl(-360, 100%, 50%)")).toEqual([255, 0, 0]);
    // -720 should also wrap to 0.
    expect(colorToRgb("hsl(-720, 100%, 50%)")).toEqual([255, 0, 0]);
  });
});

describe("hitTestCategoricalRidgelinePolygons (polygon containment)", () => {
  // Setup: caller-supplied globalMaxFreq lets us control how tall each
  // ridge actually grows (peakHeight = freq/globalMaxFreq * ridgeHeight).
  // Custom layout K=2.4, 4 bins, xLeft=0, xRight=100, usable=740.
  function setup(perRowFreq: number[][], globalMaxFreq: number, usable = 740) {
    const numRows = perRowFreq.length;
    const numBins = perRowFreq[0]?.length ?? 0;
    const K = 2.4;
    const slotHeight = usable / (numRows - 1 + K);
    const topBaseline = 0 + K * slotHeight;
    const ridgeHeight = K * slotHeight;
    const xLeft = 0;
    const xRight = 100;
    const labels = perRowFreq[0].map((_, i) => `bin${i}`);
    const steps: CategoricalStep[] = perRowFreq.map((freq, i) => ({
      step: i,
      bars: {
        freq,
        labels,
        maxFreq: Math.max(0, ...freq),
        shape: "categorical",
        type: "Histogram",
      },
    }));
    const geom: CategoricalLayoutGeometry = {
      xLeft,
      xRight,
      yTop: 0,
      yBottom: usable,
      slotWidth: (xRight - xLeft) / numBins,
      slotHeight,
      topBaseline,
      ridgeHeight,
    };
    return { steps, geom, globalMaxFreq, slotHeight, topBaseline, ridgeHeight };
  }

  it("falls back to row 0 when cursor is above all polygon peaks (headroom)", () => {
    // 3 ridges with freq=0.5 but globalMaxFreq=1.0 → each polygon
    // reaches only halfway up its ridgeHeight. Cursor at yTop is
    // above ALL polygons → fallback to smallest i where baseline_i
    // ≥ cursorY = row 0 (yellow).
    const { steps, geom, globalMaxFreq } = setup(
      [
        [0.5, 0.5, 0.5, 0.5],
        [0.5, 0.5, 0.5, 0.5],
        [0.5, 0.5, 0.5, 0.5],
      ],
      1.0,
    );
    const hit = hitTestCategoricalRidgelinePolygons(50, 0, steps, geom, globalMaxFreq);
    expect(hit?.row).toBe(0);
  });

  it("returns the visually-topmost ridge whose polygon contains the cursor", () => {
    // 3 ridges full-height (peak at yTop). topBaseline≈403.6, slot≈168.
    // Ridge polygons cover Y ranges:
    //   ridge 0: [0, 403.6]
    //   ridge 1: [168, 572]
    //   ridge 2: [336, 740]
    // Cursor Y=420 lies in ridges 1 AND 2 but not 0 (below baseline 0).
    // Topmost (highest i) = 2.
    const { steps, geom, globalMaxFreq, slotHeight, topBaseline } = setup(
      [
        [1, 1, 1, 1],
        [1, 1, 1, 1],
        [1, 1, 1, 1],
      ],
      1.0,
    );
    const cursorY = topBaseline + 0.1 * slotHeight; // ≈ 420
    const hit = hitTestCategoricalRidgelinePolygons(50, cursorY, steps, geom, globalMaxFreq);
    expect(hit?.row).toBe(2);
  });

  it("falls back to next-baseline-below when upper ridge dips and cursor lands in dead space", () => {
    // ridge 2 is nearly flat at bin 0 (freq=0.05). Cursor sits in
    // the dead-space band between ridge 1's baseline and ridge 2's
    // (near-baseline) polygon top — no polygon contains the cursor.
    // Fallback territorial rule: smallest i with baseline_i ≥ cursorY.
    // Cursor is below baseline_1 and above baseline_2 → row 2.
    const { steps, geom, globalMaxFreq, slotHeight, topBaseline, ridgeHeight } = setup(
      [
        [1, 1, 1, 1],
        [1, 1, 1, 1],
        [0.05, 1, 1, 1],
      ],
      1.0,
    );
    const baseline1 = topBaseline + 1 * slotHeight;
    const baseline2 = topBaseline + 2 * slotHeight;
    const ridge2PolyAt0 = baseline2 - 0.05 * ridgeHeight;
    const cursorY = (baseline1 + ridge2PolyAt0) / 2;
    expect(cursorY).toBeLessThan(ridge2PolyAt0);
    expect(cursorY).toBeGreaterThan(baseline1);
    const cursorX = (geom.xRight - geom.xLeft) / 4 / 2; // bin 0 center
    const hit = hitTestCategoricalRidgelinePolygons(
      cursorX,
      cursorY,
      steps,
      geom,
      globalMaxFreq,
    );
    expect(hit?.row).toBe(2);
  });

  it("polygon-containment still wins over fallback when a lower ridge has a tall peak at this X", () => {
    // ridge 0 (top) is flat at bin 0; ridge 1 has a tall peak there.
    // Cursor placed above ridge 0's baseline (so the fallback would
    // pick row 0) but INSIDE ridge 1's polygon at this X. Polygon
    // test should win → row 1.
    const { steps, geom, globalMaxFreq, slotHeight, topBaseline, ridgeHeight } = setup(
      [
        [0.05, 1, 1, 1], // ridge 0 (top) — flat at bin 0
        [1, 1, 1, 1], // ridge 1 — tall everywhere
      ],
      1.0,
    );
    const baseline0 = topBaseline;
    const baseline1 = topBaseline + slotHeight;
    // Pick cursor between baselines (would fallback to row 1) but
    // inside ridge 1's polygon (which reaches up to baseline_1 - rh).
    const ridge1PolyAt0 = baseline1 - 1.0 * ridgeHeight;
    expect(ridge1PolyAt0).toBeLessThan(baseline0); // peak above ridge 0's baseline
    const cursorY = baseline0 - 5; // slightly above ridge 0's baseline
    expect(cursorY).toBeGreaterThan(ridge1PolyAt0); // inside ridge 1's polygon
    const cursorX = (geom.xRight - geom.xLeft) / 4 / 2;
    const hit = hitTestCategoricalRidgelinePolygons(
      cursorX,
      cursorY,
      steps,
      geom,
      globalMaxFreq,
    );
    expect(hit?.row).toBe(1);
  });

  it("respects polygon Y interpolation between bin centers (peak inside, flat outside)", () => {
    // Single ridge, freq=[1, 0, 0, 0]. Cursor at bin 0 near the peak
    // → polygon contains. Cursor at bin 3 slightly above the baseline
    // → polygon is at baseline there, but with only ONE ridge the
    // territorial fallback still attributes the cursor to row 0.
    const { steps, geom, globalMaxFreq, topBaseline, ridgeHeight } = setup(
      [[1, 0, 0, 0]],
      1.0,
    );
    const numBins = 4;
    const usable = geom.xRight - geom.xLeft;
    const slotW = usable / numBins;
    const baseline = topBaseline;
    const center0 = geom.xLeft + slotW * 0.5;
    const insideHit = hitTestCategoricalRidgelinePolygons(
      center0, baseline - 0.5 * ridgeHeight, steps, geom, globalMaxFreq,
    );
    expect(insideHit?.row).toBe(0);
    // With a single ridge the fallback still claims any cursor that
    // is in/above its baseline — there's no run to defer to.
    const center3 = geom.xLeft + slotW * 3.5;
    const fallbackHit = hitTestCategoricalRidgelinePolygons(
      center3, baseline - 10, steps, geom, globalMaxFreq,
    );
    expect(fallbackHit?.row).toBe(0);
  });
});

describe("hitTestCategoricalRidgelinePolygons (transposed / stepsOnX)", () => {
  // Transposed ridgeline: numBins ridges stacked vertically (Y axis),
  // each polygon walks every step across X. Same polygon-containment
  // walk as the non-transposed branch, just with bin/step roles
  // swapped. Custom layout K=2.4 mirrors the production path for
  // numBins ≤ 10.
  function setupTransposed(perStepFreq: number[][], globalMaxFreq: number, usable = 740) {
    const numSteps = perStepFreq.length;
    const numBins = perStepFreq[0]?.length ?? 0;
    const K = 2.4;
    // In transposed mode the geometry stacks BINS along Y.
    const slotHeight = usable / (numBins - 1 + K);
    const topBaseline = 0 + K * slotHeight;
    const ridgeHeight = K * slotHeight;
    const xLeft = 0;
    const xRight = 100;
    const labels = perStepFreq[0].map((_, i) => `bin${i}`);
    const steps: CategoricalStep[] = perStepFreq.map((freq, i) => ({
      step: i,
      bars: {
        freq,
        labels,
        maxFreq: Math.max(0, ...freq),
        shape: "categorical",
        type: "Histogram",
      },
    }));
    const geom: CategoricalLayoutGeometry = {
      xLeft,
      xRight,
      yTop: 0,
      yBottom: usable,
      // In transposed mode the X axis is per-step, so slotWidth is per step.
      slotWidth: (xRight - xLeft) / numSteps,
      slotHeight,
      topBaseline,
      ridgeHeight,
    };
    return { steps, geom, globalMaxFreq, slotHeight, topBaseline, ridgeHeight };
  }

  it("uses polygon containment, not uniform grid — a low ridge with a tall peak at this X wins over the bin row that y-coordinates alone would pick", () => {
    // 3 steps, 3 bins. Bin 0 is FLAT, bin 1 has a tall peak at step 1,
    // bin 2 is flat. With the old uniform-grid hit-test, a cursor near
    // bin 0's Y band would always return col=0 regardless of whether
    // bin 1's polygon actually reached up there. Polygon containment
    // should return bin 1 since its polygon's peak at step 1 reaches
    // well into bin 0's vertical band.
    const { steps, geom, globalMaxFreq, slotHeight, topBaseline, ridgeHeight } =
      setupTransposed(
        // per-step freq across [bin0, bin1, bin2]
        [
          [0.05, 0.05, 0.05], // step 0
          [0.05, 1.0, 0.05], // step 1 — tall peak at bin 1
          [0.05, 0.05, 0.05], // step 2
        ],
        1.0,
      );
    const baselineBin0 = topBaseline;
    const baselineBin1 = topBaseline + slotHeight;
    const bin1PolyAtStep1 = baselineBin1 - 1.0 * ridgeHeight;
    // Cursor sits above bin 0's baseline (in bin 0's vertical band)
    // but INSIDE bin 1's polygon at the step-1 X. Polygon containment
    // walks bin rows topmost-first; bin 2 is bottom-paint = topmost,
    // bin 1 second, bin 0 first. Bin 2's polygon is flat at this X
    // (0.05 * rh) — doesn't reach the cursor. Bin 1's tall peak does.
    const cursorY = baselineBin0 - 5;
    expect(cursorY).toBeGreaterThan(bin1PolyAtStep1);
    const numSteps = 3;
    const cursorX = (geom.xRight - geom.xLeft) / numSteps * 1.5; // step 1 center
    const hit = hitTestCategoricalRidgelinePolygons(
      cursorX,
      cursorY,
      steps,
      geom,
      globalMaxFreq,
      { stepsOnX: true },
    );
    // Return shape preserves caller semantics — row=stepIndex, col=binIndex.
    expect(hit?.row).toBe(1);
    expect(hit?.col).toBe(1);
  });

  it("returns the topmost (last-painted) bin row when multiple polygons contain the cursor", () => {
    // All 3 bins full-height. Cursor in the overlap region. The drawer
    // paints binRow=0 first, binRow=2 last, so binRow=2 is on top.
    const { steps, geom, globalMaxFreq, slotHeight, topBaseline } =
      setupTransposed(
        [
          [1, 1, 1],
          [1, 1, 1],
          [1, 1, 1],
        ],
        1.0,
      );
    const cursorY = topBaseline + 0.1 * slotHeight;
    const cursorX = (geom.xRight - geom.xLeft) / 3 * 1.5; // step 1 center
    const hit = hitTestCategoricalRidgelinePolygons(
      cursorX,
      cursorY,
      steps,
      geom,
      globalMaxFreq,
      { stepsOnX: true },
    );
    expect(hit?.col).toBe(2);
  });

  it("snaps to the nearest polygon edge when cursor is in dead space", () => {
    // 3 non-overlapping bin rows (ridgeHeight=slotHeight). Each ridge
    // has a flat polygon peak at freq=0.5, so polyY = baseline - 0.5*rh.
    // Cursor placed in the dead space ABOVE all polygons → snap to the
    // bin whose top edge is closest by Y distance. As the cursor moves
    // down, the nearest bin shifts in lock-step (mouse location 100%
    // determines the answer).
    const numSteps = 3;
    const numBins = 3;
    const slotHeight = 50;
    const ridgeHeight = 50; // no overlap
    const topBaseline = 100;
    const xLeft = 0;
    const xRight = 100;
    const yTop = 0;
    const yBottom = 300;
    const labels = ["bin0", "bin1", "bin2"];
    const baseline0 = topBaseline + 0 * slotHeight; // 100
    const baseline1 = topBaseline + 1 * slotHeight; // 150
    const baseline2 = topBaseline + 2 * slotHeight; // 200
    const polyY0 = baseline0 - 0.5 * ridgeHeight; // 75
    const polyY1 = baseline1 - 0.5 * ridgeHeight; // 125
    const polyY2 = baseline2 - 0.5 * ridgeHeight; // 175
    const steps: CategoricalStep[] = Array.from({ length: numSteps }, (_, i) => ({
      step: i,
      bars: {
        freq: [0.5, 0.5, 0.5],
        labels,
        maxFreq: 0.5,
        shape: "categorical",
        type: "Histogram",
      },
    }));
    const geom: CategoricalLayoutGeometry = {
      xLeft, xRight, yTop, yBottom,
      slotWidth: (xRight - xLeft) / numSteps,
      slotHeight, topBaseline, ridgeHeight,
    };
    const cursorX = (xRight - xLeft) / numSteps * 1.5; // step 1 center
    const safeCall = (cursorY: number) =>
      hitTestCategoricalRidgelinePolygons(
        cursorX, cursorY, steps, geom, 1.0, { stepsOnX: true },
      );
    // Cursor just above bin 0's top edge — nearest by Y is bin 0.
    expect(safeCall(polyY0 - 5)?.col).toBe(0);
    // Move cursor into the gap between bin 0's baseline and bin 1's
    // top edge, closer to bin 1's edge → nearest switches to bin 1.
    const gap01 = baseline0 + (polyY1 - baseline0) * 0.6; // 60% across gap
    expect(safeCall(gap01)?.col).toBe(1);
    // Same idea between bins 1 and 2.
    const gap12 = baseline1 + (polyY2 - baseline1) * 0.6;
    expect(safeCall(gap12)?.col).toBe(2);
    // Cursor INSIDE bin 0's polygon (between polyY0 and baseline0)
    // takes precedence over nearest-edge fallback — same as the spec:
    // "if mouse is inside a shape, highlight that shape".
    const insideBin0 = (polyY0 + baseline0) / 2;
    expect(safeCall(insideBin0)?.col).toBe(0);
  });

  it("step column is the X-slot index, clamped to valid range", () => {
    const { steps, geom, globalMaxFreq, topBaseline } = setupTransposed(
      [
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1],
      ],
      1.0,
    );
    const cursorY = topBaseline + 1;
    // step 0 slot occupies [0, slotW), step 1 [slotW, 2*slotW), etc.
    const slotW = geom.slotWidth;
    expect(
      hitTestCategoricalRidgelinePolygons(
        slotW * 0.5,
        cursorY,
        steps,
        geom,
        globalMaxFreq,
        { stepsOnX: true },
      )?.row,
    ).toBe(0);
    expect(
      hitTestCategoricalRidgelinePolygons(
        slotW * 1.5,
        cursorY,
        steps,
        geom,
        globalMaxFreq,
        { stepsOnX: true },
      )?.row,
    ).toBe(1);
    expect(
      hitTestCategoricalRidgelinePolygons(
        slotW * 2.5,
        cursorY,
        steps,
        geom,
        globalMaxFreq,
        { stepsOnX: true },
      )?.row,
    ).toBe(2);
  });
});

describe("hitTestCategoricalGrid (heatmap)", () => {
  it("uses Math.floor on cellH with exclusive yBottom", () => {
    const geom: CategoricalLayoutGeometry = {
      xLeft: 0,
      xRight: 100,
      yTop: 0,
      yBottom: 100,
      slotWidth: 100 / 4,
      cellH: 100 / 5, // 5 rows, each 20 tall
    };
    expect(hitTestCategoricalGrid(50, 0, 4, 5, geom, "heatmap")).toEqual({ row: 0, col: 2 });
    expect(hitTestCategoricalGrid(50, 19, 4, 5, geom, "heatmap")).toEqual({ row: 0, col: 2 });
    expect(hitTestCategoricalGrid(50, 20, 4, 5, geom, "heatmap")).toEqual({ row: 1, col: 2 });
    expect(hitTestCategoricalGrid(50, 99, 4, 5, geom, "heatmap")).toEqual({ row: 4, col: 2 });
    expect(hitTestCategoricalGrid(50, 100, 4, 5, geom, "heatmap")).toBeNull();
  });
});

describe("mixColors", () => {
  it("interpolates linearly between two parseable colors", () => {
    // Halfway between black and white → mid grey.
    expect(mixColors("rgba(0,0,0,1)", "rgba(255,255,255,1)", 0.5)).toBe(
      "rgba(128,128,128,1)",
    );
    // t=0 → low; t=1 → high.
    expect(mixColors("rgba(0,0,0,1)", "rgba(255,255,255,1)", 0)).toBe(
      "rgba(0,0,0,1)",
    );
    expect(mixColors("rgba(0,0,0,1)", "rgba(255,255,255,1)", 1)).toBe(
      "rgba(255,255,255,1)",
    );
  });

  it("interpolates correctly when `high` is a negative-hue HSL string (the heatmap bug case)", () => {
    // Negative-hue HSL used to return null from colorToRgb → mixColors
    // silently fell back to `high` → every cell rendered saturated.
    // After the fix, the lerp produces actual intermediate colors.
    const low = "rgba(0,0,0,1)";
    const high = "hsl(-16, 100%, 50%)"; // equivalent to a red-pink
    const atZero = mixColors(low, high, 0);
    const atHalf = mixColors(low, high, 0.5);
    const atOne = mixColors(low, high, 1);
    // t=0 → black
    expect(atZero).toBe("rgba(0,0,0,1)");
    // t=0.5 → a darker variant of the high color (not the high color itself)
    expect(atHalf).not.toBe(atOne);
    expect(atHalf).not.toBe(atZero);
    // t=1 → the parsed high color (NOT the raw string anymore — it's
    // re-emitted as rgba() now since parsing succeeds).
    expect(atOne).toMatch(/^rgba\(/);
  });
});

