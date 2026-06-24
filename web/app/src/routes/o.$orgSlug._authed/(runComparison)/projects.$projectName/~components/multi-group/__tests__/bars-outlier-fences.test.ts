import { describe, it, expect } from "vitest";
import { computeBarsFencedMaxFreq } from "../bars-outlier-fences";

describe("computeBarsFencedMaxFreq", () => {
  it("returns the raw max when ignoreOutliers is false", () => {
    const r = computeBarsFencedMaxFreq([5, 10, 20, 9999], {
      ignoreOutliers: false,
    });
    expect(r.maxFreq).toBe(9999);
    expect(r.clamped).toBe(false);
    expect(r.rawMaxFreq).toBe(9999);
  });

  it("returns 1 as a safe floor for an empty input", () => {
    const r = computeBarsFencedMaxFreq([], { ignoreOutliers: true });
    expect(r.maxFreq).toBe(1);
    expect(r.clamped).toBe(false);
    expect(r.rawMaxFreq).toBe(1);
  });

  it("doesn't fire below the 20-sample threshold", () => {
    // 19 values — not enough samples to trust the Tukey upper fence.
    const vals = [
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 99999,
    ];
    const r = computeBarsFencedMaxFreq(vals, { ignoreOutliers: true });
    expect(r.clamped).toBe(false);
    expect(r.maxFreq).toBe(99999);
  });

  it("clamps a single extreme outlier when there are enough samples", () => {
    // 39 well-behaved values around 5–15, one extreme spike at 9999. The
    // outlier ratio is 1/40 = 2.5% < 5% and the full range dominates 3×
    // the fenced range — both activation conditions hold.
    const bulk = Array.from({ length: 39 }, (_, i) => 5 + (i % 10));
    const r = computeBarsFencedMaxFreq([...bulk, 9999], {
      ignoreOutliers: true,
    });
    expect(r.clamped).toBe(true);
    expect(r.maxFreq).toBeLessThan(100);
    expect(r.rawMaxFreq).toBe(9999);
  });

  it("does NOT clamp genuinely bimodal data (outlier ratio too high)", () => {
    // 30 values around 5, 30 values around 500. Each "bump" is ~50% of
    // samples — the upper Tukey fence would clip the high bump, but the
    // outlier ratio (~50%) is far above 5%, so we leave the raw max
    // intact rather than hiding half the data.
    const lows = Array.from({ length: 30 }, () => 5);
    const highs = Array.from({ length: 30 }, () => 500);
    const r = computeBarsFencedMaxFreq([...lows, ...highs], {
      ignoreOutliers: true,
    });
    expect(r.clamped).toBe(false);
    expect(r.maxFreq).toBe(500);
  });

  it("does NOT clamp when the outlier doesn't dominate (full ≤ 3× fenced)", () => {
    // 39 values in [10, 30], one at 40. Full range 40, fenced upper is
    // ~Q3+3*IQR ≈ in the high 20s — the 40 is technically above the
    // fence but full (40) < 3× fenced (~80), so range-dominance fails.
    const bulk = Array.from({ length: 39 }, (_, i) => 10 + (i % 21));
    const r = computeBarsFencedMaxFreq([...bulk, 40], {
      ignoreOutliers: true,
    });
    expect(r.clamped).toBe(false);
    expect(r.maxFreq).toBe(40);
  });

  it("clamps when IQR is zero but a single outlier exists", () => {
    // 39 identical values + one outlier. IQR collapses to zero, so the
    // helper treats Q3 itself as the fence — anything above Q3 is an
    // outlier. The bulk dominates the fenced result (zero), so the
    // dominance check uses the "full > 0" fallback and the clamp fires.
    const r = computeBarsFencedMaxFreq(
      [...Array.from({ length: 39 }, () => 50), 9999],
      { ignoreOutliers: true },
    );
    expect(r.clamped).toBe(true);
    expect(r.maxFreq).toBe(50);
    expect(r.rawMaxFreq).toBe(9999);
  });

  it("never returns a maxFreq below 1, even after clamping", () => {
    // If the fenced upper somehow lands at 0 (all-zero bulk), keep the
    // safe floor so canvas normalizers never divide by zero.
    const r = computeBarsFencedMaxFreq(
      [...Array.from({ length: 39 }, () => 0), 9999],
      { ignoreOutliers: true },
    );
    expect(r.maxFreq).toBeGreaterThanOrEqual(1);
  });
});
