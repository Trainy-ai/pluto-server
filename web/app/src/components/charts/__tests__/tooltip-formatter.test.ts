import { describe, it, expect } from "vitest";
import {
  generateTooltipFormatter,
  MAX_TOOLTIP_SERIES,
  formatAxisLabel,
  type LineData,
} from "../line";

// Helper to create mock ECharts tooltip params
function createTooltipParam(
  seriesName: string,
  seriesIndex: number,
  x: number,
  y: number,
  color = "#ff0000"
) {
  return {
    seriesName,
    seriesIndex,
    value: [x, y],
    marker: `<span style="background-color:${color};"></span>`,
    color,
  };
}

// Helper to create mock LineData
function createLine(
  label: string,
  options: Partial<LineData> = {}
): LineData {
  return {
    x: [1, 2, 3],
    y: [10, 20, 30],
    label,
    color: "#ff0000",
    ...options,
  };
}

describe("formatAxisLabel", () => {
  it("formats zero correctly", () => {
    expect(formatAxisLabel(0)).toBe("0");
  });

  it("formats very small numbers in exponential notation", () => {
    expect(formatAxisLabel(0.00001)).toMatch(/e/);
    expect(formatAxisLabel(-0.00001)).toMatch(/e/);
  });

  it("formats large numbers with SI units", () => {
    expect(formatAxisLabel(1000)).toBe("1k");
    expect(formatAxisLabel(1500)).toBe("1.5k");
    expect(formatAxisLabel(1000000)).toBe("1M");
    expect(formatAxisLabel(1000000000)).toBe("1G");
    expect(formatAxisLabel(1000000000000)).toBe("1T");
  });

  it("formats regular numbers with precision", () => {
    expect(formatAxisLabel(123)).toBe("123");
    expect(formatAxisLabel(123.456)).toBe("123.5");
    expect(formatAxisLabel(0.5)).toBe("0.5");
  });

  it("handles negative numbers", () => {
    expect(formatAxisLabel(-1000)).toBe("-1k");
    expect(formatAxisLabel(-123.456)).toBe("-123.5");
  });
});

describe("generateTooltipFormatter", () => {
  const theme = "dark";
  const isDateTime = false;
  const timeRange = 1000;

  describe("basic formatting", () => {
    it("returns empty string when no data", () => {
      const formatter = generateTooltipFormatter(theme, isDateTime, timeRange, []);
      expect(formatter([])).toBe("");
      expect(formatter([{ value: null }])).toBe("");
    });

    it("formats single series correctly", () => {
      const lines = [createLine("Loss")];
      const formatter = generateTooltipFormatter(theme, isDateTime, timeRange, lines);

      const params = [createTooltipParam("Loss", 0, 1, 0.5)];
      const result = formatter(params);

      expect(result).toContain("Loss");
      expect(result).toContain("0.5");
      expect(result).toContain("1"); // x value
    });

    it("formats multiple series correctly", () => {
      const lines = [createLine("Loss"), createLine("Accuracy")];
      const formatter = generateTooltipFormatter(theme, isDateTime, timeRange, lines);

      const params = [
        createTooltipParam("Loss", 0, 1, 0.5),
        createTooltipParam("Accuracy", 1, 1, 0.95),
      ];
      const result = formatter(params);

      expect(result).toContain("Loss");
      expect(result).toContain("Accuracy");
      expect(result).toContain("0.5");
      expect(result).toContain("0.95");
    });

    it("sorts series by Y value descending", () => {
      const lines = [createLine("A"), createLine("B"), createLine("C")];
      const formatter = generateTooltipFormatter(theme, isDateTime, timeRange, lines);

      const params = [
        createTooltipParam("A", 0, 1, 10),
        createTooltipParam("B", 1, 1, 30), // Highest
        createTooltipParam("C", 2, 1, 20),
      ];
      const result = formatter(params);

      // B should appear before C, and C before A
      const indexB = result.indexOf("B:");
      const indexC = result.indexOf("C:");
      const indexA = result.indexOf("A:");

      expect(indexB).toBeLessThan(indexC);
      expect(indexC).toBeLessThan(indexA);
    });
  });

  describe("hideFromLegend filtering", () => {
    it("filters out series with hideFromLegend=true", () => {
      const lines = [
        createLine("Visible"),
        createLine("Hidden", { hideFromLegend: true }),
      ];
      const formatter = generateTooltipFormatter(theme, isDateTime, timeRange, lines);

      const params = [
        createTooltipParam("Visible", 0, 1, 0.5),
        createTooltipParam("Hidden", 1, 1, 0.3),
      ];
      const result = formatter(params);

      expect(result).toContain("Visible");
      expect(result).not.toContain("Hidden:");
    });

    it("shows series when hideFromLegend=false", () => {
      const lines = [createLine("Visible", { hideFromLegend: false })];
      const formatter = generateTooltipFormatter(theme, isDateTime, timeRange, lines);

      const params = [createTooltipParam("Visible", 0, 1, 0.5)];
      const result = formatter(params);

      expect(result).toContain("Visible");
    });

    it("handles series with undefined hideFromLegend", () => {
      const lines = [createLine("Default")];
      const formatter = generateTooltipFormatter(theme, isDateTime, timeRange, lines);

      const params = [createTooltipParam("Default", 0, 1, 0.5)];
      const result = formatter(params);

      expect(result).toContain("Default");
    });
  });

  describe("MAX_TOOLTIP_SERIES truncation", () => {
    it("limits to MAX_TOOLTIP_SERIES entries", () => {
      const count = MAX_TOOLTIP_SERIES + 10;
      const lines = Array.from({ length: count }, (_, i) =>
        createLine(`Series ${i}`)
      );
      const formatter = generateTooltipFormatter(theme, isDateTime, timeRange, lines);

      const params = Array.from({ length: count }, (_, i) =>
        createTooltipParam(`Series ${i}`, i, 1, i)
      );
      const result = formatter(params);

      // Should show "+10 more series" message
      expect(result).toContain("+10 more series");

      // Count actual series entries (by counting "Series " occurrences in data rows)
      const seriesMatches = result.match(/Series \d+:/g);
      expect(seriesMatches?.length).toBeLessThanOrEqual(MAX_TOOLTIP_SERIES);
    });

    it("does not show truncation message when under limit", () => {
      const lines = [createLine("A"), createLine("B")];
      const formatter = generateTooltipFormatter(theme, isDateTime, timeRange, lines);

      const params = [
        createTooltipParam("A", 0, 1, 0.5),
        createTooltipParam("B", 1, 1, 0.3),
      ];
      const result = formatter(params);

      expect(result).not.toContain("more series");
    });

    it("shows exactly MAX_TOOLTIP_SERIES at boundary", () => {
      const lines = Array.from({ length: MAX_TOOLTIP_SERIES }, (_, i) =>
        createLine(`Series ${i}`)
      );
      const formatter = generateTooltipFormatter(theme, isDateTime, timeRange, lines);

      const params = Array.from({ length: MAX_TOOLTIP_SERIES }, (_, i) =>
        createTooltipParam(`Series ${i}`, i, 1, i)
      );
      const result = formatter(params);

      expect(result).not.toContain("more series");
    });
  });

  describe("theme handling", () => {
    it("uses white text for dark theme", () => {
      const lines = [createLine("Test")];
      const formatter = generateTooltipFormatter("dark", isDateTime, timeRange, lines);

      const params = [createTooltipParam("Test", 0, 1, 0.5)];
      const result = formatter(params);

      expect(result).toContain("color: #fff");
    });

    it("uses black text for light theme", () => {
      const lines = [createLine("Test")];
      const formatter = generateTooltipFormatter("light", isDateTime, timeRange, lines);

      const params = [createTooltipParam("Test", 0, 1, 0.5)];
      const result = formatter(params);

      expect(result).toContain("color: #000");
    });
  });

  describe("edge cases", () => {
    it("handles single param (not array)", () => {
      const lines = [createLine("Single")];
      const formatter = generateTooltipFormatter(theme, isDateTime, timeRange, lines);

      const param = createTooltipParam("Single", 0, 1, 0.5);
      const result = formatter(param);

      expect(result).toContain("Single");
    });

    it("deduplicates series with same name and value", () => {
      const lines = [createLine("Duplicate"), createLine("Duplicate")];
      const formatter = generateTooltipFormatter(theme, isDateTime, timeRange, lines);

      const params = [
        createTooltipParam("Duplicate", 0, 1, 0.5),
        createTooltipParam("Duplicate", 1, 1, 0.5), // Same name and value
      ];
      const result = formatter(params);

      // Should only show one "Duplicate: 0.5"
      const matches = result.match(/Duplicate: 0\.5/g);
      expect(matches?.length).toBe(1);
    });

    it("handles params without seriesIndex gracefully", () => {
      const lines = [createLine("Test")];
      const formatter = generateTooltipFormatter(theme, isDateTime, timeRange, lines);

      const param = {
        seriesName: "Test",
        seriesIndex: undefined,
        value: [1, 0.5],
        marker: "<span></span>",
      };
      const result = formatter([param]);

      expect(result).toContain("Test");
    });

    it("handles empty lines array with valid params", () => {
      const formatter = generateTooltipFormatter(theme, isDateTime, timeRange, []);

      const param = createTooltipParam("Orphan", 0, 1, 0.5);
      const result = formatter([param]);

      // Should still work since index check allows missing lines
      expect(result).toContain("Orphan");
    });

    it("returns empty string on exception", () => {
      const lines = [createLine("Test")];
      const formatter = generateTooltipFormatter(theme, isDateTime, timeRange, lines);

      // Force an exception by passing invalid params
      const result = formatter(null as any);
      expect(result).toBe("");
    });
  });
});

describe("MAX_TOOLTIP_SERIES constant", () => {
  it("has a reasonable value", () => {
    expect(MAX_TOOLTIP_SERIES).toBeGreaterThanOrEqual(20);
    expect(MAX_TOOLTIP_SERIES).toBeLessThanOrEqual(100);
  });

  it("equals 50", () => {
    expect(MAX_TOOLTIP_SERIES).toBe(50);
  });
});
