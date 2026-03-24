import { describe, it, expect } from "vitest";
import { smoothData } from "../smoothing";

describe("smoothData", () => {
  const xData = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const yData = [10, 12, 8, 15, 7, 13, 9, 14, 6, 11];

  describe("EMA algorithm", () => {
    it("returns same length as input", () => {
      const result = smoothData(xData, yData, "ema", 0.6);
      expect(result.length).toBe(yData.length);
    });

    it("first value equals original first value", () => {
      const result = smoothData(xData, yData, "ema", 0.6);
      expect(result[0]).toBe(yData[0]);
    });

    it("smoothed values differ from original for noisy data", () => {
      const result = smoothData(xData, yData, "ema", 0.6);
      const hasSmoothedValues = result.some(
        (val, i) => i > 0 && val !== yData[i],
      );
      expect(hasSmoothedValues).toBe(true);
    });

    it("higher alpha gives less smoothing (closer to original)", () => {
      const highAlpha = smoothData(xData, yData, "ema", 0.9);
      const lowAlpha = smoothData(xData, yData, "ema", 0.1);

      // High alpha should be closer to original data
      const highAlphaDiff = highAlpha.reduce(
        (sum, v, i) => sum + Math.abs(v - yData[i]),
        0,
      );
      const lowAlphaDiff = lowAlpha.reduce(
        (sum, v, i) => sum + Math.abs(v - yData[i]),
        0,
      );
      expect(highAlphaDiff).toBeLessThan(lowAlphaDiff);
    });

    it("alpha=0 returns original data", () => {
      const result = smoothData(xData, yData, "ema", 0);
      expect(result).toEqual(yData);
    });
  });

  describe("running average algorithm", () => {
    it("window=1 returns original data", () => {
      const result = smoothData(xData, yData, "running", 1);
      expect(result).toEqual(yData);
    });

    it("larger window produces smoother output", () => {
      const small = smoothData(xData, yData, "running", 3);
      const large = smoothData(xData, yData, "running", 7);

      // Compute variance as a measure of smoothness
      const variance = (arr: number[]) => {
        const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
        return arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length;
      };

      expect(variance(large)).toBeLessThan(variance(small));
    });
  });

  describe("gaussian algorithm", () => {
    it("returns same length as input", () => {
      const result = smoothData(xData, yData, "gaussian", 2);
      expect(result.length).toBe(yData.length);
    });

    it("produces smoothed output different from original", () => {
      const result = smoothData(xData, yData, "gaussian", 2);
      const hasSmoothedValues = result.some(
        (val, i) => val !== yData[i],
      );
      expect(hasSmoothedValues).toBe(true);
    });
  });

  describe("twema algorithm", () => {
    it("returns same length as input", () => {
      const result = smoothData(xData, yData, "twema", 2);
      expect(result.length).toBe(yData.length);
    });

    it("first value equals original first value", () => {
      const result = smoothData(xData, yData, "twema", 2);
      expect(result[0]).toBe(yData[0]);
    });
  });

  describe("mean preservation", () => {
    // Generate a longer dataset with known mean to test mean preservation.
    // This is the key invariant: smoothing should not shift the overall level
    // of the data. A violation here would manifest as the smoothed line
    // appearing at a different vertical position than the raw data.
    const longX = Array.from({ length: 200 }, (_, i) => i);

    // gpu_util-like data: oscillating around 87 with noise
    const gpuUtilData = longX.map(
      (_, i) => 80 + 15 * Math.sin(i * 0.3) * 0.5 + 7.5,
    );
    const gpuUtilMean =
      gpuUtilData.reduce((a, b) => a + b, 0) / gpuUtilData.length;

    // loss-like data: exponential decay from ~2.0 to ~0.2
    const lossData = longX.map(
      (_, i) => Math.exp(-i / 60) * 2 + 0.05,
    );
    const lossMean =
      lossData.reduce((a, b) => a + b, 0) / lossData.length;

    const algorithms: Array<{ name: string; algo: string; param: number }> = [
      { name: "gaussian (sigma=2)", algo: "gaussian", param: 2 },
      { name: "gaussian (sigma=5)", algo: "gaussian", param: 5 },
      { name: "running (window=5)", algo: "running", param: 5 },
      { name: "running (window=15)", algo: "running", param: 15 },
      { name: "ema (alpha=0.3)", algo: "ema", param: 0.3 },
      { name: "ema (alpha=0.6)", algo: "ema", param: 0.6 },
      { name: "twema (halfLife=5)", algo: "twema", param: 5 },
    ];

    for (const { name, algo, param } of algorithms) {
      it(`${name} preserves mean of stationary data (gpu_util-like)`, () => {
        const smoothed = smoothData(
          longX,
          gpuUtilData,
          algo as "gaussian" | "running" | "ema" | "twema",
          param,
        );
        const smoothedMean =
          smoothed.reduce((a, b) => a + b, 0) / smoothed.length;
        // Mean should stay within 10% of the original
        const relativeShift =
          Math.abs(smoothedMean - gpuUtilMean) /
          Math.max(Math.abs(gpuUtilMean), 1);
        expect(relativeShift).toBeLessThan(0.1);
      });

      it(`${name} preserves mean of decaying data (loss-like)`, () => {
        const smoothed = smoothData(
          longX,
          lossData,
          algo as "gaussian" | "running" | "ema" | "twema",
          param,
        );
        const smoothedMean =
          smoothed.reduce((a, b) => a + b, 0) / smoothed.length;
        const relativeShift =
          Math.abs(smoothedMean - lossMean) /
          Math.max(Math.abs(lossMean), 1);
        expect(relativeShift).toBeLessThan(0.1);
      });
    }
  });

  describe("edge cases", () => {
    it("handles empty arrays", () => {
      const result = smoothData([], [], "ema", 0.6);
      expect(result).toEqual([]);
    });

    it("handles single element", () => {
      const result = smoothData([0], [5], "ema", 0.6);
      expect(result).toEqual([5]);
    });

    it("throws on mismatched array lengths", () => {
      expect(() => smoothData([0, 1], [5], "ema", 0.6)).toThrow();
    });
  });
});

