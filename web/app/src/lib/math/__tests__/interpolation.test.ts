import { describe, it, expect } from "vitest";
import { interpolateValue } from "../interpolation";

describe("interpolateValue", () => {
  describe("when value exists at index", () => {
    it("returns the existing value for linear mode", () => {
      const xValues = [0, 1, 2, 3, 4];
      const yValues = [10, 20, 30, 40, 50];
      expect(interpolateValue(xValues, yValues, 2, "linear")).toBe(30);
    });

    it("returns the existing value for last mode", () => {
      const xValues = [0, 1, 2, 3, 4];
      const yValues = [10, 20, 30, 40, 50];
      expect(interpolateValue(xValues, yValues, 2, "last")).toBe(30);
    });
  });

  describe("linear interpolation", () => {
    it("interpolates midpoint between two values", () => {
      const xValues = [0, 5, 10];
      const yValues: (number | null)[] = [10, null, 20];
      expect(interpolateValue(xValues, yValues, 1, "linear")).toBe(15);
    });

    it("interpolates non-midpoint correctly", () => {
      // x=2 is 20% of the way from x=0 to x=10
      const xValues = [0, 2, 10];
      const yValues: (number | null)[] = [0, null, 100];
      expect(interpolateValue(xValues, yValues, 1, "linear")).toBe(20);
    });

    it("handles multiple consecutive nulls", () => {
      const xValues = [0, 1, 2, 3, 4];
      const yValues: (number | null)[] = [10, null, null, null, 50];
      // x=2 is 50% of the way from x=0 to x=4
      expect(interpolateValue(xValues, yValues, 2, "linear")).toBe(30);
      // x=1 is 25% of the way from x=0 to x=4
      expect(interpolateValue(xValues, yValues, 1, "linear")).toBe(20);
      // x=3 is 75% of the way from x=0 to x=4
      expect(interpolateValue(xValues, yValues, 3, "linear")).toBe(40);
    });

    it("returns null at left edge (no left neighbor)", () => {
      const xValues = [0, 1, 2];
      const yValues: (number | null)[] = [null, null, 20];
      expect(interpolateValue(xValues, yValues, 0, "linear")).toBeNull();
      expect(interpolateValue(xValues, yValues, 1, "linear")).toBeNull();
    });

    it("returns null at right edge (no right neighbor)", () => {
      const xValues = [0, 1, 2];
      const yValues: (number | null)[] = [10, null, null];
      expect(interpolateValue(xValues, yValues, 1, "linear")).toBeNull();
      expect(interpolateValue(xValues, yValues, 2, "linear")).toBeNull();
    });

    it("returns null when all values are null", () => {
      const xValues = [0, 1, 2];
      const yValues: (number | null)[] = [null, null, null];
      expect(interpolateValue(xValues, yValues, 1, "linear")).toBeNull();
    });

    it("handles negative values", () => {
      const xValues = [0, 5, 10];
      const yValues: (number | null)[] = [-10, null, 10];
      expect(interpolateValue(xValues, yValues, 1, "linear")).toBe(0);
    });

    it("handles non-uniform x spacing", () => {
      // x=1 is 10% of the way from x=0 to x=10
      const xValues = [0, 1, 10];
      const yValues: (number | null)[] = [0, null, 100];
      expect(interpolateValue(xValues, yValues, 1, "linear")).toBe(10);
    });
  });

  describe("last (forward-fill) interpolation", () => {
    it("uses the last known value", () => {
      const xValues = [0, 5, 10];
      const yValues: (number | null)[] = [10, null, 20];
      expect(interpolateValue(xValues, yValues, 1, "last")).toBe(10);
    });

    it("handles multiple consecutive nulls", () => {
      const xValues = [0, 1, 2, 3, 4];
      const yValues: (number | null)[] = [10, null, null, null, 50];
      expect(interpolateValue(xValues, yValues, 1, "last")).toBe(10);
      expect(interpolateValue(xValues, yValues, 2, "last")).toBe(10);
      expect(interpolateValue(xValues, yValues, 3, "last")).toBe(10);
    });

    it("returns null at left edge (no previous value)", () => {
      const xValues = [0, 1, 2];
      const yValues: (number | null)[] = [null, null, 20];
      expect(interpolateValue(xValues, yValues, 0, "last")).toBeNull();
      expect(interpolateValue(xValues, yValues, 1, "last")).toBeNull();
    });

    it("fills from nearest left value, not from distant ones", () => {
      const xValues = [0, 1, 2, 3, 4];
      const yValues: (number | null)[] = [10, 20, null, null, 50];
      // Should use 20 (at idx 1), not 10 (at idx 0)
      expect(interpolateValue(xValues, yValues, 2, "last")).toBe(20);
      expect(interpolateValue(xValues, yValues, 3, "last")).toBe(20);
    });
  });

  describe("realistic scenario: different logging frequencies", () => {
    it("handles run A logging every step, run B every 5 steps", () => {
      // Aligned x values: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
      const xValues = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

      // Run B: logged at steps 0, 5, 10 → nulls everywhere else
      const runBValues: (number | null)[] = [
        1.0, null, null, null, null, 0.5, null, null, null, null, 0.2,
      ];

      // Linear: at step 3, should be 60% of the way from 1.0 to 0.5
      const linearAt3 = interpolateValue(xValues, runBValues, 3, "linear");
      expect(linearAt3).toBeCloseTo(0.7);

      // Last: at step 3, should be 1.0 (last known value)
      const lastAt3 = interpolateValue(xValues, runBValues, 3, "last");
      expect(lastAt3).toBe(1.0);

      // Linear: at step 7, should be 40% of the way from 0.5 to 0.2
      const linearAt7 = interpolateValue(xValues, runBValues, 7, "linear");
      expect(linearAt7).toBeCloseTo(0.38);

      // Last: at step 7, should be 0.5
      const lastAt7 = interpolateValue(xValues, runBValues, 7, "last");
      expect(lastAt7).toBe(0.5);
    });
  });

  describe("realistic scenario: step-frequency comparison (seed data pattern)", () => {
    // Simulates aligned data from runs with step intervals 1, 5, 10, 50
    // After alignment, the x-axis is the union of all step values
    // and each series has nulls where it didn't log

    it("interpolates between large step gaps (every-50 run)", () => {
      // x-axis: steps 0, 10, 20, 30, 40, 50 (from every-10 run)
      // every-50 run only logged at 0 and 50
      const xValues = [0, 10, 20, 30, 40, 50];
      const every50: (number | null)[] = [1.0, null, null, null, null, 0.5];

      // Linear: at step 20, should be 40% of way from 1.0 to 0.5
      expect(interpolateValue(xValues, every50, 2, "linear")).toBeCloseTo(0.8);
      // Linear: at step 30, should be 60% of way
      expect(interpolateValue(xValues, every50, 3, "linear")).toBeCloseTo(0.7);
      // Last: should forward-fill from step 0
      expect(interpolateValue(xValues, every50, 2, "last")).toBe(1.0);
      expect(interpolateValue(xValues, every50, 4, "last")).toBe(1.0);
    });

    it("returns actual values (not interpolated) for dense run", () => {
      // every-step run has data at every x position — no interpolation needed
      const xValues = [0, 1, 2, 3, 4, 5];
      const everyStep = [1.0, 0.95, 0.9, 0.85, 0.8, 0.75];

      for (let i = 0; i < xValues.length; i++) {
        expect(interpolateValue(xValues, everyStep, i, "linear")).toBe(
          everyStep[i],
        );
        expect(interpolateValue(xValues, everyStep, i, "last")).toBe(
          everyStep[i],
        );
      }
    });

    it("handles tooltip isInterpolated flag pattern", () => {
      // This tests the pattern used in line-uplot.tsx tooltip:
      // yVal == null → try interpolation → mark isInterpolated = true
      const xValues = [0, 1, 2, 3, 4, 5];
      const sparseRun: (number | null)[] = [1.0, null, null, null, null, 0.5];

      // Simulate the tooltip logic for each index
      for (let idx = 0; idx < xValues.length; idx++) {
        const yVal = sparseRun[idx];
        if (yVal != null) {
          // Actual value — isInterpolated should be false
          expect(yVal).toBeGreaterThanOrEqual(0);
        } else {
          // Missing value — interpolation should fill it
          const linear = interpolateValue(xValues, sparseRun, idx, "linear");
          expect(linear).not.toBeNull();
          // Interpolated value should be between the two boundary values
          expect(linear!).toBeGreaterThanOrEqual(0.5);
          expect(linear!).toBeLessThanOrEqual(1.0);
        }
      }
    });
  });

  describe("edge cases", () => {
    it("handles single-element arrays", () => {
      expect(interpolateValue([0], [null], 0, "linear")).toBeNull();
      expect(interpolateValue([0], [null], 0, "last")).toBeNull();
      expect(interpolateValue([0], [5], 0, "linear")).toBe(5);
      expect(interpolateValue([0], [5], 0, "last")).toBe(5);
    });

    it("handles undefined values same as null", () => {
      const xValues = [0, 5, 10];
      const yValues: (number | null | undefined)[] = [10, undefined, 20];
      expect(interpolateValue(xValues, yValues, 1, "linear")).toBe(15);
      expect(interpolateValue(xValues, yValues, 1, "last")).toBe(10);
    });

    it("handles identical x values (division by zero guard)", () => {
      const xValues = [5, 5, 5];
      const yValues: (number | null)[] = [10, null, 20];
      // Should return left value instead of NaN
      expect(interpolateValue(xValues, yValues, 1, "linear")).toBe(10);
    });
  });
});
