import { describe, it, expect } from "vitest";
import { interpolate } from "../chart-sync-context";

describe("interpolate", () => {
  describe("edge cases", () => {
    it("returns x unchanged when arrays are empty", () => {
      expect(interpolate([], [], 5)).toBe(5);
    });

    it("clamps to first y when x is below range", () => {
      const xs = [10, 20, 30];
      const ys = [100, 200, 300];
      expect(interpolate(xs, ys, 5)).toBe(100);
    });

    it("clamps to last y when x is above range", () => {
      const xs = [10, 20, 30];
      const ys = [100, 200, 300];
      expect(interpolate(xs, ys, 50)).toBe(300);
    });

    it("returns exact y when x matches an array element", () => {
      const xs = [10, 20, 30];
      const ys = [100, 200, 300];
      expect(interpolate(xs, ys, 20)).toBe(200);
    });

    it("returns first y when x equals first element", () => {
      const xs = [10, 20, 30];
      const ys = [100, 200, 300];
      expect(interpolate(xs, ys, 10)).toBe(100);
    });

    it("returns last y when x equals last element", () => {
      const xs = [10, 20, 30];
      const ys = [100, 200, 300];
      expect(interpolate(xs, ys, 30)).toBe(300);
    });

    it("handles single-element arrays", () => {
      expect(interpolate([10], [100], 10)).toBe(100);
      expect(interpolate([10], [100], 5)).toBe(100);
      expect(interpolate([10], [100], 15)).toBe(100);
    });
  });

  describe("linear interpolation", () => {
    it("interpolates midpoint correctly", () => {
      const xs = [0, 100];
      const ys = [0, 1000];
      expect(interpolate(xs, ys, 50)).toBe(500);
    });

    it("interpolates quarter point correctly", () => {
      const xs = [0, 100];
      const ys = [0, 1000];
      expect(interpolate(xs, ys, 25)).toBe(250);
    });

    it("interpolates between non-zero start points", () => {
      const xs = [10, 20];
      const ys = [50, 150];
      expect(interpolate(xs, ys, 15)).toBe(100);
    });

    it("interpolates in the correct segment of multi-segment data", () => {
      const xs = [0, 10, 20, 30, 40];
      const ys = [0, 100, 400, 900, 1600];
      // Between xs[1]=10 and xs[2]=20, midpoint x=15
      // t = (15 - 10) / (20 - 10) = 0.5
      // y = 100 + 0.5 * (400 - 100) = 250
      expect(interpolate(xs, ys, 15)).toBe(250);
    });

    it("interpolates near the end of a multi-segment array", () => {
      const xs = [0, 10, 20, 30, 40];
      const ys = [0, 100, 400, 900, 1600];
      // Between xs[3]=30 and xs[4]=40, x=35
      // t = (35 - 30) / (40 - 30) = 0.5
      // y = 900 + 0.5 * (1600 - 900) = 1250
      expect(interpolate(xs, ys, 35)).toBe(1250);
    });
  });

  describe("step↔time translation use case", () => {
    it("translates step range to relative time range", () => {
      // Simulating a run: steps 0..1000 over 60 seconds
      const steps = [0, 250, 500, 750, 1000];
      const relTimeSecs = [0, 15, 30, 45, 60];

      // Zoom to steps [200, 800]
      const timeMin = interpolate(steps, relTimeSecs, 200);
      const timeMax = interpolate(steps, relTimeSecs, 800);

      // 200 is between 0 and 250: t = 200/250 = 0.8, y = 0 + 0.8 * 15 = 12
      expect(timeMin).toBeCloseTo(12, 5);
      // 800 is between 750 and 1000: t = 50/250 = 0.2, y = 45 + 0.2 * 15 = 48
      expect(timeMax).toBeCloseTo(48, 5);
    });

    it("translates relative time range to step range", () => {
      // Same mapping, reverse direction
      const steps = [0, 250, 500, 750, 1000];
      const relTimeSecs = [0, 15, 30, 45, 60];

      // Zoom to time [12, 48] seconds
      const stepMin = interpolate(relTimeSecs, steps, 12);
      const stepMax = interpolate(relTimeSecs, steps, 48);

      expect(stepMin).toBeCloseTo(200, 5);
      expect(stepMax).toBeCloseTo(800, 5);
    });

    it("roundtrips step→time→step accurately", () => {
      const steps = [0, 100, 500, 1000, 2000, 5000, 10000];
      const relTimeSecs = [0, 5, 30, 120, 300, 600, 1800];

      const originalStep = 3000;
      const time = interpolate(steps, relTimeSecs, originalStep);
      const roundtripped = interpolate(relTimeSecs, steps, time);

      expect(roundtripped).toBeCloseTo(originalStep, 3);
    });
  });

  describe("non-uniform spacing", () => {
    it("handles non-uniform step spacing (common in ML training)", () => {
      // Steps logged at irregular intervals
      const steps = [0, 1, 10, 100, 1000];
      const relTimeSecs = [0, 0.1, 1, 10, 100];

      // x=5 is between steps[1]=1 and steps[2]=10
      // t = (5 - 1) / (10 - 1) = 4/9
      // y = 0.1 + (4/9) * (1 - 0.1) = 0.1 + 0.4 = 0.5
      expect(interpolate(steps, relTimeSecs, 5)).toBeCloseTo(0.1 + (4 / 9) * 0.9, 10);
    });
  });
});
