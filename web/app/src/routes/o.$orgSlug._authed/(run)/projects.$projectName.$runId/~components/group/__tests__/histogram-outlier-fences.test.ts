import { describe, it, expect } from "vitest";
import { computeHistogramFences } from "../histogram-outlier-fences";

// Helper for synthesizing a fake step with given bin range + maxFreq.
function step(min: number, max: number, maxFreq: number) {
  return {
    histogramData: {
      bins: { min, max, num: 64 },
      maxFreq,
      freq: [],
      shape: "uniform" as const,
      type: "Histogram" as const,
    },
  };
}

// 99 narrow steps + 1 very wide step — the "one runaway step blows
// out the X domain" case the Tukey fence is meant to catch.
function outlierStepRun() {
  const out = [];
  for (let i = 0; i < 99; i++) out.push(step(-0.2, 0.2, 1500));
  out.push(step(-90, 90, 65)); // the bad step
  return out;
}

// 100 steps with a gradient — no single dominating outlier. Like
// `run-gradual-blow`. The fences MUST NOT activate here (genuine
// spread, not a spike).
function gradualBlowRun() {
  const out = [];
  for (let i = 0; i < 100; i++) {
    const sigma = 0.05 + (20 - 0.05) * (i / 99);
    out.push(step(-3 * sigma, 3 * sigma, 100));
  }
  return out;
}

describe("computeHistogramFences — outlier-step run", () => {
  it("clamps the X domain to the tight-step range when one wide outlier exists", () => {
    const result = computeHistogramFences(outlierStepRun(), {
      ignoreOutliers: true,
    });
    // Raw range is ±90 because of the bad step.
    expect(result.rawXDomain[0]).toBe(-90);
    expect(result.rawXDomain[1]).toBe(90);
    // Clamped range should be roughly ±0.2 (the tight-step bin range).
    expect(result.xDomain[0]).toBeGreaterThan(-1);
    expect(result.xDomain[1]).toBeLessThan(1);
    expect(result.xClamped).toBe(true);
  });

  it("clamps the maxFreq when one outlier step's max is far above the rest", () => {
    const steps = [];
    for (let i = 0; i < 99; i++) steps.push(step(-1, 1, 100));
    steps.push(step(-1, 1, 50000)); // outlier-tall peak
    const result = computeHistogramFences(steps, { ignoreOutliers: true });
    expect(result.rawMaxFreq).toBe(50000);
    // Clamped maxFreq should be near the bulk of the data, not the spike.
    expect(result.maxFreq).toBeLessThan(500);
    expect(result.freqClamped).toBe(true);
  });

  it("does NOT clamp when ignoreOutliers is OFF (toggle respects user)", () => {
    const result = computeHistogramFences(outlierStepRun(), {
      ignoreOutliers: false,
    });
    expect(result.xDomain).toEqual(result.rawXDomain);
    expect(result.maxFreq).toBe(result.rawMaxFreq);
    expect(result.xClamped).toBe(false);
    expect(result.freqClamped).toBe(false);
  });
});

describe("computeHistogramFences — non-outlier runs", () => {
  it("does NOT clamp gradient runs (genuine spread, no single dominating outlier)", () => {
    const steps = gradualBlowRun();
    const result = computeHistogramFences(steps, { ignoreOutliers: true });
    // Trigger check: the gradient distribution has a "smooth" range,
    // so the full range is NOT > 3× the fenced range. Fence stays off.
    expect(result.xClamped).toBe(false);
    expect(result.xDomain).toEqual(result.rawXDomain);
  });

  it("does NOT clamp tight-stable runs (every step identical)", () => {
    const steps = [];
    for (let i = 0; i < 100; i++) steps.push(step(-0.2, 0.2, 1500));
    const result = computeHistogramFences(steps, { ignoreOutliers: true });
    // IQR is zero on degenerate data — clamp must not activate.
    expect(result.xClamped).toBe(false);
    expect(result.freqClamped).toBe(false);
  });
});

describe("computeHistogramFences — realistic varying data", () => {
  it("clamps the X domain when bin ranges VARY across steps + one wide outlier (the seed-data case)", () => {
    // The original test case used identical bins for all 99 narrow steps
    // (IQR collapsed to 0 — easy degenerate case). Real data from
    // `np.random.normal(0, 0.05, 4096)` produces histogram ranges
    // that vary slightly per step due to tail sampling. Make sure
    // Tukey fences still trigger for that more realistic shape.
    const rng = (() => {
      // Deterministic pseudo-random so the test isn't flaky.
      let seed = 1;
      return () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return (seed & 0xffff) / 0xffff;
      };
    })();
    const steps = [];
    for (let i = 0; i < 99; i++) {
      // Narrow step: range varies by ±0.05 around ±0.20.
      const min = -0.20 - rng() * 0.05;
      const max = 0.20 + rng() * 0.05;
      steps.push(step(min, max, 1500 + rng() * 200));
    }
    // The bad step — N(0, 30) tail.
    steps.push(step(-120, 120, 64));
    const result = computeHistogramFences(steps, { ignoreOutliers: true });
    expect(result.rawXDomain[0]).toBe(-120);
    expect(result.rawXDomain[1]).toBe(120);
    expect(result.xClamped).toBe(true);
    // Clamped range should be roughly ±0.25-ish (a hair past the
    // narrow steps' actual bulk + 1.5×IQR).
    expect(result.xDomain[0]).toBeGreaterThan(-1);
    expect(result.xDomain[1]).toBeLessThan(1);
  });
});

describe("computeHistogramFences — guards", () => {
  it("requires at least 20 samples (silently passes through with fewer)", () => {
    // 19 narrow + 1 wide outlier: too few samples for fences to fire.
    const steps = [];
    for (let i = 0; i < 19; i++) steps.push(step(-0.2, 0.2, 1500));
    steps.push(step(-90, 90, 50));
    const result = computeHistogramFences(steps, { ignoreOutliers: true });
    expect(result.xClamped).toBe(false);
    expect(result.xDomain).toEqual(result.rawXDomain);
  });

  it("handles empty input gracefully", () => {
    const result = computeHistogramFences([], { ignoreOutliers: true });
    expect(result.xDomain).toEqual([0, 1]);
    expect(result.maxFreq).toBe(1);
    expect(result.xClamped).toBe(false);
  });

  it("handles bimodal data — does NOT clamp when outlier ratio exceeds 5%", () => {
    // 50 narrow + 50 wide: this is bimodal, not "rare outlier". Don't
    // hide half the data behind a fence.
    const steps = [];
    for (let i = 0; i < 50; i++) steps.push(step(-1, 1, 100));
    for (let i = 0; i < 50; i++) steps.push(step(-50, 50, 100));
    const result = computeHistogramFences(steps, { ignoreOutliers: true });
    expect(result.xClamped).toBe(false);
  });

  it("does NOT clamp when full range is only modestly wider than fenced range (< 3×)", () => {
    // 95 steps at ±1, 5 steps at ±2 — the wider runs are within 2×.
    // Fence trigger requires >3× domination.
    const steps = [];
    for (let i = 0; i < 95; i++) steps.push(step(-1, 1, 100));
    for (let i = 0; i < 5; i++) steps.push(step(-2, 2, 100));
    const result = computeHistogramFences(steps, { ignoreOutliers: true });
    expect(result.xClamped).toBe(false);
  });

  it("preserves raw bounds in result even when clamped (callers can show 'raw' hint)", () => {
    const result = computeHistogramFences(outlierStepRun(), {
      ignoreOutliers: true,
    });
    expect(result.rawXDomain).toEqual([-90, 90]);
    expect(result.rawMaxFreq).toBe(1500);
    // Clamped values are different from raw.
    expect(result.xDomain[0]).not.toBe(-90);
  });
});
