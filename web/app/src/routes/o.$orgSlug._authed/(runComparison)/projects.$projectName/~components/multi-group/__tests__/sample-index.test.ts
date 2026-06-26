import { describe, it, expect } from "vitest";
import { resolveSampleIndex, selectChosenIndex } from "../sample-index";

describe("selectChosenIndex", () => {
  it("linked → uses the shared index regardless of the per-run value", () => {
    expect(selectChosenIndex(true, 2, 0)).toBe(2);
  });

  it("unlinked → uses the per-run index regardless of the shared value", () => {
    expect(selectChosenIndex(false, 2, 0)).toBe(0);
  });

  it("passes null through (untouched → pinned/default fallback downstream)", () => {
    expect(selectChosenIndex(true, null, 3)).toBeNull();
    expect(selectChosenIndex(false, 3, null)).toBeNull();
  });
});

describe("resolveSampleIndex", () => {
  it("defaults to 0 before any interaction or pin", () => {
    expect(resolveSampleIndex(null, null, 4)).toBe(0);
  });

  it("uses the pinned index as the pre-interaction default", () => {
    expect(resolveSampleIndex(null, 2, 4)).toBe(2);
  });

  it("shared (user-chosen) index wins over the pinned default", () => {
    expect(resolveSampleIndex(3, 1, 4)).toBe(3);
  });

  it("is sticky: the same shared index resolves the same across step changes", () => {
    // step A has 4 samples, step B has 4 samples -> index 3 holds
    expect(resolveSampleIndex(3, null, 4)).toBe(3);
    expect(resolveSampleIndex(3, null, 4)).toBe(3);
  });

  it("clamps to the last sample when a step has fewer samples", () => {
    // shared index 3, but this run/step only has 2 samples -> clamp to 1
    expect(resolveSampleIndex(3, null, 2)).toBe(1);
  });

  it("clamps the pinned default too", () => {
    expect(resolveSampleIndex(null, 5, 3)).toBe(2);
  });

  it("returns 0 when the cell has no samples (placeholder step)", () => {
    expect(resolveSampleIndex(3, 2, 0)).toBe(0);
  });

  it("guards against negative indices", () => {
    expect(resolveSampleIndex(-1, null, 4)).toBe(0);
  });

  it("honors an explicit chosen index of 0 (not coerced to the pinned default)", () => {
    // Regression guard: 0 is a valid index, so the precedence must use `??`,
    // not `||` (which would fall through to the pinned default).
    expect(resolveSampleIndex(0, 3, 5)).toBe(0);
    expect(selectChosenIndex(true, 0, 9)).toBe(0);
  });
});
