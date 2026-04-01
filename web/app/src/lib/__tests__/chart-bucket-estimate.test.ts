import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  estimateStandardBuckets,
  resolveChartBuckets,
  MAX_BUCKETS,
  PREVIEW_BUCKETS,
  RESOLUTION_PRESETS,
} from "../chart-bucket-estimate";

describe("estimateStandardBuckets", () => {
  let originalInnerWidth: number;

  beforeEach(() => {
    originalInnerWidth = window.innerWidth;
  });

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", {
      value: originalInnerWidth,
      writable: true,
    });
  });

  function setWindowWidth(w: number) {
    Object.defineProperty(window, "innerWidth", { value: w, writable: true });
  }

  it("returns a value between PREVIEW_BUCKETS and MAX_BUCKETS", () => {
    const result = estimateStandardBuckets();
    expect(result).toBeGreaterThanOrEqual(PREVIEW_BUCKETS);
    expect(result).toBeLessThanOrEqual(MAX_BUCKETS);
  });

  it("1 column returns more buckets than 3 columns", () => {
    setWindowWidth(1400);
    const oneCol = estimateStandardBuckets(1);
    const threeCols = estimateStandardBuckets(3);
    expect(oneCol).toBeGreaterThan(threeCols);
  });

  it("floors at PREVIEW_BUCKETS for narrow windows", () => {
    setWindowWidth(0);
    expect(estimateStandardBuckets()).toBe(PREVIEW_BUCKETS);
  });

  it("caps at MAX_BUCKETS for very wide screens", () => {
    setWindowWidth(100_000);
    expect(estimateStandardBuckets()).toBeLessThanOrEqual(MAX_BUCKETS);
  });

  it("applies minimum 200px chart width when sidebar takes all space", () => {
    // innerWidth=280 means available=0 after subtracting sidebar,
    // but Math.max(200, ...) ensures chart width is at least 200
    setWindowWidth(280);
    expect(estimateStandardBuckets(1)).toBeGreaterThanOrEqual(200);
  });
});

describe("resolveChartBuckets", () => {
  it("returns preset values for named resolutions", () => {
    expect(resolveChartBuckets("high", false)).toBe(RESOLUTION_PRESETS.high);
    expect(resolveChartBuckets("max", false)).toBe(RESOLUTION_PRESETS.max);
    expect(resolveChartBuckets("ultra", false)).toBe(RESOLUTION_PRESETS.ultra);
  });

  it("presets ignore smoothing flag", () => {
    expect(resolveChartBuckets("high", true)).toBe(resolveChartBuckets("high", false));
    expect(resolveChartBuckets("max", true)).toBe(resolveChartBuckets("max", false));
  });

  it("auto delegates to estimateStandardBuckets", () => {
    expect(resolveChartBuckets("auto", false)).toBe(estimateStandardBuckets());
  });

  it("auto passes columns through", () => {
    expect(resolveChartBuckets("auto", false, 1)).toBe(estimateStandardBuckets(1));
    expect(resolveChartBuckets("auto", false, 2)).toBe(estimateStandardBuckets(2));
  });

  it("auto with columns=1 returns more than columns=3 on wide screens", () => {
    Object.defineProperty(window, "innerWidth", { value: 2400, writable: true });
    const oneCol = resolveChartBuckets("auto", false, 1);
    const threeCols = resolveChartBuckets("auto", false, 3);
    expect(oneCol).toBeGreaterThan(threeCols);
  });
});
