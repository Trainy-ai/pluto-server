import { describe, it, expect } from "vitest";
import { smoothData, downsampleLTTB } from "../smoothing";

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

describe("downsampleLTTB", () => {
  it("returns original data when target >= data length", () => {
    const x = [0, 1, 2, 3, 4];
    const y = [10, 20, 30, 40, 50];
    const result = downsampleLTTB(x, y, 10);
    expect(result.x).toEqual(x);
    expect(result.y).toEqual(y);
  });

  it("returns original data when target is 0 (no limit)", () => {
    const x = [0, 1, 2, 3, 4];
    const y = [10, 20, 30, 40, 50];
    const result = downsampleLTTB(x, y, 0);
    expect(result.x).toEqual(x);
    expect(result.y).toEqual(y);
  });

  it("reduces data to target number of points", () => {
    const x = Array.from({ length: 100 }, (_, i) => i);
    const y = Array.from({ length: 100 }, (_, i) => Math.sin(i / 10));
    const result = downsampleLTTB(x, y, 20);
    expect(result.x.length).toBe(20);
    expect(result.y.length).toBe(20);
  });

  it("always includes first and last points", () => {
    const x = Array.from({ length: 100 }, (_, i) => i);
    const y = Array.from({ length: 100 }, (_, i) => Math.sin(i / 10));
    const result = downsampleLTTB(x, y, 20);
    expect(result.x[0]).toBe(0);
    expect(result.x[result.x.length - 1]).toBe(99);
  });
});
