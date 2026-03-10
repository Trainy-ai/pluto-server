import { describe, it, expect } from "vitest";
import { formatAxisLabel, formatAxisLabels } from "../format";

describe("formatAxisLabel", () => {
  it("returns empty string for null/undefined", () => {
    expect(formatAxisLabel(null)).toBe("");
    expect(formatAxisLabel(undefined)).toBe("");
  });

  it("returns '0' for zero", () => {
    expect(formatAxisLabel(0)).toBe("0");
  });

  it("formats very small values as scientific notation", () => {
    expect(formatAxisLabel(0.00001)).toBe("1e-5");
    expect(formatAxisLabel(0.00005)).toBe("5e-5");
  });

  it("formats values with SI suffixes", () => {
    expect(formatAxisLabel(1500)).toBe("1.5k");
    expect(formatAxisLabel(1000000)).toBe("1M");
    expect(formatAxisLabel(2500000)).toBe("2.5M");
  });

  it("formats mid-range values with precision", () => {
    expect(formatAxisLabel(0.5)).toBe("0.5");
    expect(formatAxisLabel(42)).toBe("42");
    expect(formatAxisLabel(999)).toBe("999");
  });
});

describe("formatAxisLabels", () => {
  it("returns empty array for empty input", () => {
    expect(formatAxisLabels([])).toEqual([]);
  });

  it("formats regular values with abbreviated format", () => {
    const result = formatAxisLabels([0, 500, 1000, 1500, 2000]);
    expect(result).toEqual(["0", "500", "1k", "1.5k", "2k"]);
  });

  it("handles null values in the array", () => {
    const result = formatAxisLabels([null, 100, 200, null]);
    expect(result).toEqual(["", "100", "200", ""]);
  });
});

describe("formatAxisLabels with isLogScale", () => {
  it("uses scientific notation for small values on log scale", () => {
    const vals = [0.001, 0.003, 0.005, 0.007, 0.01];
    const result = formatAxisLabels(vals, true);
    expect(result).toEqual(["1e-3", "3e-3", "5e-3", "7e-3", "1e-2"]);
  });

  it("uses scientific notation for very small values on log scale", () => {
    const vals = [0.00001, 0.0001, 0.001, 0.01];
    const result = formatAxisLabels(vals, true);
    expect(result).toEqual(["1e-5", "1e-4", "1e-3", "1e-2"]);
  });

  it("uses scientific notation for mixed small/medium values on log scale", () => {
    const vals = [0.001, 0.01, 0.1, 1];
    const result = formatAxisLabels(vals, true);
    // When the smallest value is < 0.01, all should be scientific
    expect(result).toEqual(["1e-3", "1e-2", "1e-1", "1e0"]);
  });

  it("uses scientific notation when values span multiple orders of magnitude on log scale", () => {
    const vals = [1, 10, 100, 1000];
    const result = formatAxisLabels(vals, true);
    // Values span 3 orders of magnitude (1000/1 >= 100), so scientific notation is used
    expect(result).toEqual(["1e0", "1e1", "1e2", "1e3"]);
  });

  it("does NOT use scientific notation when log scale values are close together", () => {
    const vals = [10, 20, 50, 80];
    const result = formatAxisLabels(vals, true);
    // Values span less than 2 orders of magnitude (80/10 < 100), so regular formatting
    expect(result).toEqual(["10", "20", "50", "80"]);
  });

  it("handles zero values in log scale formatting", () => {
    const vals = [0, 0.001, 0.01, 0.1];
    const result = formatAxisLabels(vals, true);
    expect(result[0]).toBe("0");
    expect(result[1]).toBe("1e-3");
  });

  it("handles non-round small values on log scale", () => {
    const vals = [0.0025, 0.005, 0.0075, 0.01];
    const result = formatAxisLabels(vals, true);
    expect(result[0]).toBe("2.5e-3");
    expect(result[1]).toBe("5e-3");
    expect(result[2]).toBe("7.5e-3");
    expect(result[3]).toBe("1e-2");
  });

  it("uses scientific notation for log scale with large values spanning orders of magnitude", () => {
    const vals = [100, 1000, 10000, 100000];
    const result = formatAxisLabels(vals, true);
    // Values span 3 orders of magnitude (100000/100 >= 100)
    expect(result).toEqual(["1e2", "1e3", "1e4", "1e5"]);
  });

  it("uses scientific notation when log scale has a wide range including small values", () => {
    const vals = [0.001, 0.01, 0.1, 1, 10];
    const result = formatAxisLabels(vals, true);
    expect(result[0]).toBe("1e-3");
    expect(result[1]).toBe("1e-2");
    expect(result[2]).toBe("1e-1");
  });

  it("handles null values in log scale formatting", () => {
    const vals: (number | null)[] = [null, 0.001, 0.01, null];
    const result = formatAxisLabels(vals, true);
    expect(result[0]).toBe("");
    expect(result[1]).toBe("1e-3");
    expect(result[2]).toBe("1e-2");
    expect(result[3]).toBe("");
  });

  it("keeps isLogScale=false behavior unchanged", () => {
    const vals = [0.001, 0.003, 0.005, 0.007, 0.01];
    const result = formatAxisLabels(vals, false);
    // Without log scale flag, should use the standard abbreviated format
    expect(result).toEqual(["0.001", "0.003", "0.005", "0.007", "0.01"]);
  });
});
