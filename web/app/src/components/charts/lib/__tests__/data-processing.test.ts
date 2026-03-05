import { describe, it, expect } from "vitest";
import { alignDataForUPlot } from "../data-processing";
import type { LineData } from "../../line-uplot";

function makeLine(
  x: number[],
  y: number[],
  label = "test",
  color = "#000",
): LineData {
  return { x, y, label, color };
}

describe("alignDataForUPlot", () => {
  it("returns empty data for empty input", () => {
    const result = alignDataForUPlot([]);
    expect(result).toEqual([[]]);
  });

  it("aligns a single series without gaps (spanGaps default true)", () => {
    const line = makeLine([0, 1, 2, 3], [10, 20, 30, 40]);
    const result = alignDataForUPlot([line]);
    expect(result[0]).toEqual([0, 1, 2, 3]);
    expect(result[1]).toEqual([10, 20, 30, 40]);
  });

  it("aligns multiple series, inserting nulls for missing x values", () => {
    const line1 = makeLine([0, 1, 2], [10, 20, 30]);
    const line2 = makeLine([1, 2, 3], [100, 200, 300]);
    const result = alignDataForUPlot([line1, line2]);

    // Unified x-axis: [0, 1, 2, 3]
    expect(result[0]).toEqual([0, 1, 2, 3]);
    // line1 has no value at x=3
    expect(result[1]).toEqual([10, 20, 30, null]);
    // line2 has no value at x=0
    expect(result[2]).toEqual([null, 100, 200, 300]);
  });

  describe("spanGaps: false (skip missing values)", () => {
    it("inserts null gap markers for a single series with step gaps", () => {
      // Series with steps 0-4 then jumps to 100-104 — a large gap at step 5-99
      const x = [0, 1, 2, 3, 4, 100, 101, 102, 103, 104];
      const y = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const line = makeLine(x, y);

      const result = alignDataForUPlot([line], { spanGaps: false });

      // The x-axis should have a gap marker inserted between 4 and 100
      const xValues = result[0] as number[];
      expect(xValues.length).toBeGreaterThan(x.length);

      // There should be a null in the y-values at the gap marker position
      const yValues = result[1] as (number | null)[];
      const nullIndices = yValues
        .map((v, i) => (v === null ? i : -1))
        .filter((i) => i >= 0);
      expect(nullIndices.length).toBeGreaterThan(0);

      // The gap marker's x should be between 4 and 100
      for (const idx of nullIndices) {
        expect(xValues[idx]).toBeGreaterThan(4);
        expect(xValues[idx]).toBeLessThan(100);
      }
    });

    it("does not insert gap markers when data is evenly spaced", () => {
      const x = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
      const y = x.map((v) => v * 10);
      const line = makeLine(x, y);

      const result = alignDataForUPlot([line], { spanGaps: false });

      // No gap markers needed — x-axis should be the same length
      expect((result[0] as number[]).length).toBe(x.length);
      // No nulls in y-values
      expect((result[1] as (number | null)[]).every((v) => v !== null)).toBe(
        true,
      );
    });

    it("handles multiple gaps in one series", () => {
      // Steps: 0-5, gap, 50-55, gap, 200-205
      const x = [
        0, 1, 2, 3, 4, 5, 50, 51, 52, 53, 54, 55, 200, 201, 202, 203, 204,
        205,
      ];
      const y = x.map((v) => v * 0.1);
      const line = makeLine(x, y);

      const result = alignDataForUPlot([line], { spanGaps: false });

      const yValues = result[1] as (number | null)[];
      const nullCount = yValues.filter((v) => v === null).length;
      // Should have at least 2 gap markers (one per gap)
      expect(nullCount).toBeGreaterThanOrEqual(2);
    });

    it("does not affect behavior when spanGaps is true (default)", () => {
      const x = [0, 1, 2, 100, 101, 102];
      const y = [1, 2, 3, 4, 5, 6];
      const line = makeLine(x, y);

      const resultDefault = alignDataForUPlot([line]);
      const resultTrue = alignDataForUPlot([line], { spanGaps: true });

      // Both should be identical — no gap markers inserted
      expect(resultDefault[0]).toEqual(resultTrue[0]);
      expect(resultDefault[1]).toEqual(resultTrue[1]);
      // No nulls
      expect(
        (resultDefault[1] as (number | null)[]).every((v) => v !== null),
      ).toBe(true);
    });

    it("skips gap detection for multi-series with different x-lengths (comparison view)", () => {
      // Simulates comparison view: two runs with different data lengths
      // Series 1: steps 0-5, gap, 100-105 (12 points)
      const line1 = makeLine(
        [0, 1, 2, 3, 4, 5, 100, 101, 102, 103, 104, 105],
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      );
      // Series 2: continuous steps 0-10 (11 points — different length)
      const line2 = makeLine(
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110],
      );

      const result = alignDataForUPlot([line1, line2], { spanGaps: false });

      // No synthetic gap markers should be inserted (different x-lengths
      // means this is a comparison view — alignment nulls suffice)
      const xValues = result[0] as number[];
      // xSet should only contain the union of both series' x-values
      const expectedX = new Set([...line1.x, ...line2.x]);
      expect(xValues.length).toBe(expectedX.size);

      // Series 2 should have non-null values at its own x-positions
      const y2 = result[2] as (number | null)[];
      for (let i = 0; i < xValues.length; i++) {
        if (line2.x.includes(xValues[i])) {
          expect(y2[i]).not.toBeNull();
        }
      }
    });

    it("inserts gap markers for same-length companion series (smoothed)", () => {
      // Simulates single-run view with smoothing: original + smoothed
      // share the same x-values
      const x = [0, 1, 2, 3, 4, 100, 101, 102, 103, 104];
      const original = makeLine(x, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "loss");
      const smoothed = makeLine(
        x,
        [1.1, 1.9, 3.1, 3.9, 5.1, 5.9, 7.1, 7.9, 9.1, 9.9],
        "loss (smoothed)",
      );

      const result = alignDataForUPlot([original, smoothed], {
        spanGaps: false,
      });

      // Gap markers should be inserted (both series have same x-length)
      const xValues = result[0] as number[];
      expect(xValues.length).toBeGreaterThan(x.length);

      // Both series should have null at the gap marker position
      const y1 = result[1] as (number | null)[];
      const y2 = result[2] as (number | null)[];
      const nullIdx1 = y1.findIndex((v) => v === null);
      const nullIdx2 = y2.findIndex((v) => v === null);
      expect(nullIdx1).toBeGreaterThan(-1);
      expect(nullIdx2).toBeGreaterThan(-1);
      expect(nullIdx1).toBe(nullIdx2); // Same position
    });
  });

  it("respects valueFlags by inserting nulls for flagged values", () => {
    const flags = new Map<number, string>();
    flags.set(2, "NaN");
    const line: LineData = {
      x: [0, 1, 2, 3],
      y: [10, 20, 999, 40],
      label: "test",
      color: "#000",
      valueFlags: flags,
    };
    const result = alignDataForUPlot([line]);
    expect(result[1]).toEqual([10, 20, null, 40]);
  });
});
