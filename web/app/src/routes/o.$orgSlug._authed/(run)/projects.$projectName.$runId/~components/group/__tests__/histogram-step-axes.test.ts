import { describe, it, expect } from "vitest";
import {
  perStepXRange,
  computeStepXRange,
  computeStepMaxFreq,
} from "../histogram-step-axes";

describe("perStepXRange", () => {
  it("pads the step's own bin range by 10% on each side", () => {
    // span = 10 → pad = 1 on each side.
    expect(perStepXRange({ min: 0, max: 10 })).toEqual({ min: -1, max: 11 });
  });

  it("handles a negative-valued but positive-width range", () => {
    // span = 2 → pad = 0.2.
    const r = perStepXRange({ min: -1, max: 1 })!;
    expect(r.min).toBeCloseTo(-1.2);
    expect(r.max).toBeCloseTo(1.2);
  });

  it("returns null when bins are missing", () => {
    expect(perStepXRange(undefined)).toBeNull();
  });

  it("returns null for zero-width bins (min === max)", () => {
    expect(perStepXRange({ min: 5, max: 5 })).toBeNull();
  });

  it("returns null for inverted bins (max < min)", () => {
    expect(perStepXRange({ min: 5, max: 1 })).toBeNull();
  });
});

describe("computeStepXRange", () => {
  const locked = { min: -1000, max: 1000 };

  it("unlocked: scales to the current step's own padded range", () => {
    const r = computeStepXRange({
      lockAxes: false,
      currentBins: { min: 0, max: 10 },
      lockedRange: locked,
    });
    expect(r).toEqual({ min: -1, max: 11 });
  });

  it("locked: uses the shared range and ignores the step's bins", () => {
    const r = computeStepXRange({
      lockAxes: true,
      currentBins: { min: 0, max: 10 },
      lockedRange: locked,
    });
    expect(r).toEqual(locked);
  });

  it("unlocked but no step bins: falls back to the locked range", () => {
    const r = computeStepXRange({
      lockAxes: false,
      currentBins: undefined,
      lockedRange: locked,
    });
    expect(r).toEqual(locked);
  });

  it("unlocked but degenerate step bins: falls back to the locked range", () => {
    const r = computeStepXRange({
      lockAxes: false,
      currentBins: { min: 5, max: 5 },
      lockedRange: locked,
    });
    expect(r).toEqual(locked);
  });

  it("manual xMin/xMax overrides win over per-step scaling", () => {
    const r = computeStepXRange({
      lockAxes: false,
      currentBins: { min: 0, max: 10 },
      lockedRange: locked,
      xMinOverride: -5,
      xMaxOverride: 5,
    });
    expect(r).toEqual({ min: -5, max: 5 });
  });

  it("manual overrides win over the locked range too", () => {
    const r = computeStepXRange({
      lockAxes: true,
      currentBins: { min: 0, max: 10 },
      lockedRange: locked,
      xMinOverride: -5,
      xMaxOverride: 5,
    });
    expect(r).toEqual({ min: -5, max: 5 });
  });

  it("a partial override only replaces that edge", () => {
    const r = computeStepXRange({
      lockAxes: false,
      currentBins: { min: 0, max: 10 },
      lockedRange: locked,
      xMinOverride: -5,
    });
    // min overridden, max still from the per-step base (11).
    expect(r).toEqual({ min: -5, max: 11 });
  });

  it("an explicit 0 override wins (nullish, not falsy)", () => {
    const r = computeStepXRange({
      lockAxes: false,
      currentBins: { min: 0, max: 10 },
      lockedRange: locked,
      xMinOverride: 0,
    });
    expect(r.min).toBe(0);
  });
});

describe("computeStepMaxFreq", () => {
  it("unlocked: uses the current step's own peak", () => {
    expect(
      computeStepMaxFreq({
        lockAxes: false,
        currentMaxFreq: 45,
        lockedMaxFreq: 2400,
      }),
    ).toBe(45);
  });

  it("locked: uses the shared cross-step peak, ignoring the step", () => {
    expect(
      computeStepMaxFreq({
        lockAxes: true,
        currentMaxFreq: 45,
        lockedMaxFreq: 2400,
      }),
    ).toBe(2400);
  });

  it("unlocked but the step has no data: falls back to the shared peak", () => {
    expect(
      computeStepMaxFreq({
        lockAxes: false,
        currentMaxFreq: undefined,
        lockedMaxFreq: 2400,
      }),
    ).toBe(2400);
  });

  it("manual yMax override wins in every mode", () => {
    expect(
      computeStepMaxFreq({
        lockAxes: false,
        currentMaxFreq: 45,
        lockedMaxFreq: 2400,
        yMaxOverride: 100,
      }),
    ).toBe(100);
    expect(
      computeStepMaxFreq({
        lockAxes: true,
        currentMaxFreq: 45,
        lockedMaxFreq: 2400,
        yMaxOverride: 100,
      }),
    ).toBe(100);
  });

  it("an explicit yMax of 0 wins (nullish, not falsy)", () => {
    expect(
      computeStepMaxFreq({
        lockAxes: false,
        currentMaxFreq: 45,
        lockedMaxFreq: 2400,
        yMaxOverride: 0,
      }),
    ).toBe(0);
  });
});
