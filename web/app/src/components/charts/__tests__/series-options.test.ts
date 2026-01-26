import { describe, it, expect } from "vitest";
import { generateSeriesOptions, type LineData } from "../line";

// Helper to create mock LineData
function createLine(
  label: string,
  dataPoints: number,
  options: Partial<LineData> = {}
): LineData {
  return {
    x: Array.from({ length: dataPoints }, (_, i) => i),
    y: Array.from({ length: dataPoints }, (_, i) => i * 0.1),
    label,
    color: "#ff0000",
    ...options,
  };
}

// Helper to create series data (the [x, y] pairs)
function createSeriesData(dataPoints: number): number[][] {
  return Array.from({ length: dataPoints }, (_, i) => [i, i * 0.1]);
}

describe("generateSeriesOptions", () => {
  describe("single point rendering", () => {
    it("shows symbol for single data point series", () => {
      const lines = [createLine("SinglePoint", 1)];
      const labelCounts = { SinglePoint: 1 };
      const seriesData = [createSeriesData(1)];

      const options = generateSeriesOptions(lines, labelCounts, seriesData);

      expect(options[0].showSymbol).toBe(true);
      expect(options[0].symbolSize).toBe(8);
    });

    it("hides symbol for multi-point series", () => {
      const lines = [createLine("MultiPoint", 10)];
      const labelCounts = { MultiPoint: 1 };
      const seriesData = [createSeriesData(10)];

      const options = generateSeriesOptions(lines, labelCounts, seriesData);

      expect(options[0].showSymbol).toBe(false);
      expect(options[0].symbolSize).toBe(6);
    });

    it("handles mixed single and multi-point series", () => {
      const lines = [
        createLine("Single", 1),
        createLine("Multi", 100),
        createLine("AnotherSingle", 1),
      ];
      const labelCounts = { Single: 1, Multi: 1, AnotherSingle: 1 };
      const seriesData = [
        createSeriesData(1),
        createSeriesData(100),
        createSeriesData(1),
      ];

      const options = generateSeriesOptions(lines, labelCounts, seriesData);

      // Single point series should show symbols
      expect(options[0].showSymbol).toBe(true);
      expect(options[0].symbolSize).toBe(8);

      // Multi point series should hide symbols
      expect(options[1].showSymbol).toBe(false);
      expect(options[1].symbolSize).toBe(6);

      // Another single point series should show symbols
      expect(options[2].showSymbol).toBe(true);
      expect(options[2].symbolSize).toBe(8);
    });

    it("two-point series should hide symbol (line is visible)", () => {
      const lines = [createLine("TwoPoints", 2)];
      const labelCounts = { TwoPoints: 1 };
      const seriesData = [createSeriesData(2)];

      const options = generateSeriesOptions(lines, labelCounts, seriesData);

      expect(options[0].showSymbol).toBe(false);
      expect(options[0].symbolSize).toBe(6);
    });
  });

  describe("basic series configuration", () => {
    it("sets correct series type and symbol", () => {
      const lines = [createLine("Test", 10)];
      const labelCounts = { Test: 1 };
      const seriesData = [createSeriesData(10)];

      const options = generateSeriesOptions(lines, labelCounts, seriesData);

      expect(options[0].type).toBe("line");
      expect(options[0].symbol).toBe("circle");
      expect(options[0].smooth).toBe(false);
    });

    it("applies line color correctly", () => {
      const lines = [createLine("Colored", 10, { color: "#00ff00" })];
      const labelCounts = { Colored: 1 };
      const seriesData = [createSeriesData(10)];

      const options = generateSeriesOptions(lines, labelCounts, seriesData);

      expect(options[0].lineStyle.color).toBe("#00ff00");
      expect(options[0].itemStyle.color).toBe("#00ff00");
    });

    it("applies dashed line style", () => {
      const lines = [createLine("Dashed", 10, { dashed: true })];
      const labelCounts = { Dashed: 1 };
      const seriesData = [createSeriesData(10)];

      const options = generateSeriesOptions(lines, labelCounts, seriesData);

      expect(options[0].lineStyle.type).toBe("dashed");
    });

    it("applies solid line style by default", () => {
      const lines = [createLine("Solid", 10)];
      const labelCounts = { Solid: 1 };
      const seriesData = [createSeriesData(10)];

      const options = generateSeriesOptions(lines, labelCounts, seriesData);

      expect(options[0].lineStyle.type).toBe("solid");
    });

    it("applies custom opacity", () => {
      const lines = [createLine("Opacity", 10, { opacity: 0.5 })];
      const labelCounts = { Opacity: 1 };
      const seriesData = [createSeriesData(10)];

      const options = generateSeriesOptions(lines, labelCounts, seriesData);

      expect(options[0].lineStyle.opacity).toBe(0.5);
      expect(options[0].itemStyle.opacity).toBe(0.5);
    });

    it("uses default opacity when not specified", () => {
      const lines = [createLine("Default", 10)];
      const labelCounts = { Default: 1 };
      const seriesData = [createSeriesData(10)];

      const options = generateSeriesOptions(lines, labelCounts, seriesData);

      expect(options[0].lineStyle.opacity).toBe(0.85);
      expect(options[0].itemStyle.opacity).toBe(0.85);
    });
  });

  describe("duplicate label handling", () => {
    it("appends index to duplicate labels", () => {
      const lines = [
        createLine("Duplicate", 10),
        createLine("Duplicate", 10),
      ];
      const labelCounts = { Duplicate: 2 };
      const seriesData = [createSeriesData(10), createSeriesData(10)];

      const options = generateSeriesOptions(lines, labelCounts, seriesData);

      expect(options[0].name).toBe("Duplicate (1)");
      expect(options[1].name).toBe("Duplicate (2)");
    });

    it("does not append index for unique labels", () => {
      const lines = [createLine("Unique", 10)];
      const labelCounts = { Unique: 1 };
      const seriesData = [createSeriesData(10)];

      const options = generateSeriesOptions(lines, labelCounts, seriesData);

      expect(options[0].name).toBe("Unique");
    });
  });

  describe("performance modes", () => {
    it("enables large mode for many series (>20)", () => {
      const lines = Array.from({ length: 25 }, (_, i) =>
        createLine(`Series${i}`, 10)
      );
      const labelCounts = Object.fromEntries(
        lines.map((l) => [l.label, 1])
      );
      const seriesData = lines.map(() => createSeriesData(10));

      const options = generateSeriesOptions(lines, labelCounts, seriesData);

      expect(options[0].large).toBe(true);
      expect(options[0].largeThreshold).toBe(500);
      expect(options[0].progressive).toBe(200);
    });

    it("enables large mode for large datasets (>1000 points)", () => {
      const lines = [createLine("Large", 1500)];
      const labelCounts = { Large: 1 };
      const seriesData = [createSeriesData(1500)];

      const options = generateSeriesOptions(lines, labelCounts, seriesData);

      expect(options[0].large).toBe(true);
      expect(options[0].largeThreshold).toBe(2000);
    });

    it("disables large mode for small datasets", () => {
      const lines = [createLine("Small", 100)];
      const labelCounts = { Small: 1 };
      const seriesData = [createSeriesData(100)];

      const options = generateSeriesOptions(lines, labelCounts, seriesData);

      expect(options[0].large).toBe(false);
    });
  });
});
