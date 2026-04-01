import { describe, it, expect } from "vitest";
import {
  applySmoothing,
  buildValueFlags,
  getTimeUnitForDisplay,
  alignAndUnzip,
  applyServerBuckets,
  bucketedAndSmooth,
  fromColumnar,
  type ChartSeriesData,
  type SmoothingSettings,
  type ChartDataPoint,
  type BucketedChartDataPoint,
  type ColumnarBucketedSeries,
} from "../chart-data-utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** Relative difference between two values, guarded against division by zero. */
function relDiff(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1);
}

/** Generate uniformly-spaced x values. */
function makeX(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/** gpu_util–like data: noisy, oscillating around ~87. */
function makeGpuUtil(n: number): number[] {
  return Array.from(
    { length: n },
    (_, i) => 80 + Math.sin(i * 0.2) * 7 + 7,
  );
}

/** loss–like data: exponential decay from ~2 to ~0.1. */
function makeLoss(n: number): number[] {
  return Array.from(
    { length: n },
    (_, i) => Math.exp(-i / (n / 3)) * 2 + 0.05,
  );
}

/** lr–like data: tiny values, warmup then decay. */
function makeLr(n: number): number[] {
  return Array.from({ length: n }, (_, i) => {
    const progress = i / n;
    return progress < 0.1
      ? 0.001 * (progress / 0.1)
      : 0.001 * Math.exp(-(progress - 0.1));
  });
}

function makeChartSeries(
  x: number[],
  y: number[],
  label = "metric",
): ChartSeriesData {
  return { x, y, label, color: "#00f" };
}

const SMOOTHING_CONFIGS: Array<{
  name: string;
  settings: SmoothingSettings;
}> = [
  {
    name: "gaussian (sigma=2)",
    settings: {
      enabled: true,
      algorithm: "gaussian",
      parameter: 2,
      showOriginalData: false,
    },
  },
  {
    name: "gaussian (sigma=5)",
    settings: {
      enabled: true,
      algorithm: "gaussian",
      parameter: 5,
      showOriginalData: false,
    },
  },
  {
    name: "running (window=5)",
    settings: {
      enabled: true,
      algorithm: "running",
      parameter: 5,
      showOriginalData: false,
    },
  },
  {
    name: "ema (alpha=0.3)",
    settings: {
      enabled: true,
      algorithm: "ema",
      parameter: 0.3,
      showOriginalData: false,
    },
  },
  {
    name: "twema (halfLife=5)",
    settings: {
      enabled: true,
      algorithm: "twema",
      parameter: 5,
      showOriginalData: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("applySmoothing", () => {
  describe("mean preservation", () => {
    // This test suite guards against the bug where a smoothed line appeared at
    // a completely different vertical level than the raw data (e.g., smoothed
    // gpu_util at ~45 when raw data was ~87). The root cause was wrong seed
    // data, but these tests ensure the smoothing pipeline itself never
    // introduces such a mean shift.
    const N = 200;
    const datasets: Array<{
      name: string;
      y: number[];
      tolerance: number;
    }> = [
      { name: "gpu_util-like (stationary ~87)", y: makeGpuUtil(N), tolerance: 0.1 },
      { name: "loss-like (decay from 2 to 0.1)", y: makeLoss(N), tolerance: 0.1 },
      { name: "lr-like (tiny values ~0.001)", y: makeLr(N), tolerance: 0.15 },
    ];

    for (const { name: dataName, y, tolerance } of datasets) {
      for (const { name: algoName, settings } of SMOOTHING_CONFIGS) {
        it(`${algoName} on ${dataName}`, () => {
          const x = makeX(y.length);
          const series = makeChartSeries(x, y);
          const result = applySmoothing(series, settings);

          // First series is the smoothed output
          const smoothedY = result[0].y;
          expect(smoothedY.length).toBe(y.length);

          const inputMean = mean(y);
          const outputMean = mean(smoothedY.filter((v): v is number => v !== null));
          const shift = relDiff(outputMean, inputMean);
          expect(shift).toBeLessThan(tolerance);
        });
      }
    }
  });

  describe("disabled smoothing", () => {
    it("returns data unchanged when smoothing is disabled", () => {
      const x = makeX(10);
      const y = makeGpuUtil(10);
      const series = makeChartSeries(x, y);
      const settings: SmoothingSettings = {
        enabled: false,
        algorithm: "gaussian",
        parameter: 2,
        showOriginalData: false,
      };

      const result = applySmoothing(series, settings);
      expect(result).toHaveLength(1);
      expect(result[0].y).toEqual(y);
    });
  });

  describe("envelope series passthrough", () => {
    it("does not smooth envelope boundary series", () => {
      const x = makeX(10);
      const y = makeGpuUtil(10);
      const envSeries: ChartSeriesData = {
        ...makeChartSeries(x, y, "metric_env_min"),
        envelopeOf: "metric",
        envelopeBound: "min",
      };
      const settings: SmoothingSettings = {
        enabled: true,
        algorithm: "gaussian",
        parameter: 5,
        showOriginalData: false,
      };

      const result = applySmoothing(envSeries, settings);
      expect(result).toHaveLength(1);
      expect(result[0].y).toEqual(y);
    });
  });

  describe("showOriginalData", () => {
    it("returns two series when showOriginalData is true", () => {
      const x = makeX(50);
      const y = makeGpuUtil(50);
      const series = makeChartSeries(x, y);
      const settings: SmoothingSettings = {
        enabled: true,
        algorithm: "gaussian",
        parameter: 2,
        showOriginalData: true,
      };

      const result = applySmoothing(series, settings);
      expect(result).toHaveLength(2);
      // First is smoothed, second is original (dimmed)
      expect(result[0].opacity).toBe(1);
      expect(result[1].opacity).toBe(0.07);
      expect(result[1].y).toEqual(y);
      expect(result[1].label).toContain("(original)");
    });
  });

  describe("valueFlags gap handling", () => {
    it("smooths segments independently across NaN gaps", () => {
      const x = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
      const y = [80, 82, 84, 0, 90, 88, 86, 0, 81, 83];
      const flags = new Map<number, string>();
      flags.set(3, "NaN");
      flags.set(7, "NaN");

      const series: ChartSeriesData = {
        ...makeChartSeries(x, y),
        valueFlags: flags,
      };
      const settings: SmoothingSettings = {
        enabled: true,
        algorithm: "gaussian",
        parameter: 1,
        showOriginalData: false,
      };

      const result = applySmoothing(series, settings);
      expect(result[0].y.length).toBe(10);
      // Flagged positions should keep their original value
      expect(result[0].y[3]).toBe(0);
      expect(result[0].y[7]).toBe(0);
    });
  });
});

describe("buildValueFlags", () => {
  it("returns undefined when no flags", () => {
    const data: ChartDataPoint[] = [
      { step: 0, time: "t0", value: 1 },
      { step: 1, time: "t1", value: 2 },
    ];
    expect(buildValueFlags(data, (d) => d.step)).toBeUndefined();
  });

  it("builds map for flagged points", () => {
    const data: ChartDataPoint[] = [
      { step: 0, time: "t0", value: 1 },
      { step: 1, time: "t1", value: NaN, valueFlag: "NaN" },
      { step: 2, time: "t2", value: Infinity, valueFlag: "Inf" },
    ];
    const flags = buildValueFlags(data, (d) => d.step);
    expect(flags).toBeDefined();
    expect(flags!.size).toBe(2);
    expect(flags!.get(1)).toBe("NaN");
    expect(flags!.get(2)).toBe("Inf");
  });

  it("ignores empty string flags", () => {
    const data: ChartDataPoint[] = [
      { step: 0, time: "t0", value: 1, valueFlag: "" },
    ];
    expect(buildValueFlags(data, (d) => d.step)).toBeUndefined();
  });
});

describe("getTimeUnitForDisplay", () => {
  it("returns seconds for < 2 minutes", () => {
    expect(getTimeUnitForDisplay(60)).toEqual({ divisor: 1, unit: "s" });
  });

  it("returns minutes for < 1 hour", () => {
    expect(getTimeUnitForDisplay(300)).toEqual({ divisor: 60, unit: "min" });
  });

  it("returns hours for < 1 day", () => {
    expect(getTimeUnitForDisplay(7200)).toEqual({ divisor: 3600, unit: "hr" });
  });

  it("returns days for < 1 week", () => {
    expect(getTimeUnitForDisplay(172800)).toEqual({
      divisor: 86400,
      unit: "day",
    });
  });
});

describe("alignAndUnzip", () => {
  it("aligns by step and sorts by x value", () => {
    const xData: ChartDataPoint[] = [
      { step: 0, time: "t0", value: 10 },
      { step: 1, time: "t1", value: 20 },
      { step: 2, time: "t2", value: 30 },
    ];
    const yData: ChartDataPoint[] = [
      { step: 2, time: "t2", value: 0.9 },
      { step: 0, time: "t0", value: 0.5 },
      { step: 1, time: "t1", value: 0.7 },
    ];

    const result = alignAndUnzip(xData, yData);
    expect(result.x).toEqual([10, 20, 30]);
    expect(result.y).toEqual([0.5, 0.7, 0.9]);
  });

  it("drops unmatched steps", () => {
    const xData: ChartDataPoint[] = [
      { step: 0, time: "t0", value: 10 },
      { step: 2, time: "t2", value: 30 },
    ];
    const yData: ChartDataPoint[] = [
      { step: 0, time: "t0", value: 0.5 },
      { step: 1, time: "t1", value: 0.7 },
      { step: 2, time: "t2", value: 0.9 },
    ];

    const result = alignAndUnzip(xData, yData);
    expect(result.x).toEqual([10, 30]);
    expect(result.y).toEqual([0.5, 0.9]);
  });
});

// ---------------------------------------------------------------------------
// smoothPass with null y-values (Fix 1)
// ---------------------------------------------------------------------------

describe("applySmoothing with null y-values", () => {
  it("smoothing skips null values without creating dips", () => {
    const N = 100;
    const x = makeX(N);
    const y = makeLoss(N);

    // Insert nulls at known positions
    const yWithNulls: (number | null)[] = [...y];
    const nullPositions = [10, 25, 50, 75, 90];
    for (const pos of nullPositions) {
      yWithNulls[pos] = null;
    }

    const series: ChartSeriesData = makeChartSeries(x, y);
    const seriesWithNulls: ChartSeriesData = {
      ...makeChartSeries(x, y),
      y: yWithNulls,
    };
    const settings: SmoothingSettings = {
      enabled: true,
      algorithm: "gaussian",
      parameter: 3,
      showOriginalData: false,
    };

    const resultClean = applySmoothing(series, settings);
    const resultNulls = applySmoothing(seriesWithNulls, settings);

    // Null positions should remain null
    for (const pos of nullPositions) {
      expect(resultNulls[0].y[pos]).toBeNull();
    }

    // Adjacent values should NOT be pulled toward 0.
    // Compare to clean smoothing — values near gaps should be similar
    // (not dramatically different due to null→0 coercion).
    for (const pos of nullPositions) {
      for (const adj of [pos - 1, pos + 1]) {
        if (adj < 0 || adj >= N || nullPositions.includes(adj)) continue;
        const cleanVal = resultClean[0].y[adj] as number;
        const nullsVal = resultNulls[0].y[adj] as number;
        // Adjacent values should be within 30% of clean result (not pulled to 0)
        expect(
          Math.abs(nullsVal - cleanVal) / Math.max(Math.abs(cleanVal), 1e-9)
        ).toBeLessThan(0.3);
      }
    }
  });

  it("smoothing preserves mean with sprinkled nulls", () => {
    const N = 200;
    const x = makeX(N);
    const y = makeGpuUtil(N);

    // Insert ~5% random nulls (deterministic positions)
    const yWithNulls: (number | null)[] = [...y];
    for (let i = 0; i < N; i++) {
      if (i % 20 === 7) yWithNulls[i] = null; // 5% = every 20th
    }

    const series: ChartSeriesData = {
      ...makeChartSeries(x, y),
      y: yWithNulls,
    };
    const settings: SmoothingSettings = {
      enabled: true,
      algorithm: "gaussian",
      parameter: 2,
      showOriginalData: false,
    };

    const result = applySmoothing(series, settings);
    const outputNonNull = result[0].y.filter((v): v is number => v !== null);
    const inputNonNull = yWithNulls.filter((v): v is number => v !== null);

    const inputMean = mean(inputNonNull);
    const outputMean = mean(outputNonNull);
    const shift = relDiff(outputMean, inputMean);
    expect(shift).toBeLessThan(0.1);
  });
});

// ---------------------------------------------------------------------------
// applyServerBuckets with non-finite flags (Fix 3b)
// ---------------------------------------------------------------------------

describe("applyServerBuckets", () => {
  it("emits null for all-NaN buckets", () => {
    const data: BucketedChartDataPoint[] = [
      { step: 0, time: "t0", value: 1.5, minY: 1.0, maxY: 2.0, count: 10 },
      { step: 1, time: "t1", value: null, minY: null, maxY: null, count: 10, nonFiniteFlags: 1 },
      { step: 2, time: "t2", value: 2.0, minY: 1.5, maxY: 2.5, count: 10 },
    ];

    const [main] = applyServerBuckets(data, "test", "#00f");
    expect(main.y[0]).toBe(1.5);
    expect(main.y[1]).toBeNull();
    expect(main.y[2]).toBe(2.0);
  });

  it("preserves finite average for mixed buckets", () => {
    const data: BucketedChartDataPoint[] = [
      { step: 0, time: "t0", value: 1.5, minY: 1.0, maxY: 2.0, count: 10, nonFiniteFlags: 1 },
      { step: 1, time: "t1", value: 3.0, minY: 2.5, maxY: 3.5, count: 10, nonFiniteFlags: 2 },
    ];

    const [main] = applyServerBuckets(data, "test", "#00f");
    // Mixed buckets: y-value is the finite average, not null or 0
    expect(main.y[0]).toBe(1.5);
    expect(main.y[1]).toBe(3.0);
  });

  it("builds nonFiniteMarkers map", () => {
    const data: BucketedChartDataPoint[] = [
      { step: 0, time: "t0", value: 1.5, minY: 1.0, maxY: 2.0, count: 10 },
      { step: 1, time: "t1", value: null, minY: null, maxY: null, count: 10, nonFiniteFlags: 1 },
      { step: 2, time: "t2", value: 2.0, minY: 1.5, maxY: 2.5, count: 10, nonFiniteFlags: 6 },
      { step: 3, time: "t3", value: 3.0, minY: 2.5, maxY: 3.5, count: 10 },
    ];

    const [main] = applyServerBuckets(data, "test", "#00f");
    expect(main.nonFiniteMarkers).toBeDefined();
    const markers = main.nonFiniteMarkers!;

    // Step 0: no flags
    expect(markers.has(0)).toBe(false);

    // Step 1: NaN only
    expect(markers.has(1)).toBe(true);
    expect(markers.get(1)!.has("NaN")).toBe(true);
    expect(markers.get(1)!.size).toBe(1);

    // Step 2: Inf + -Inf
    expect(markers.has(2)).toBe(true);
    expect(markers.get(2)!.has("Inf")).toBe(true);
    expect(markers.get(2)!.has("-Inf")).toBe(true);
    expect(markers.get(2)!.size).toBe(2);

    // Step 3: no flags
    expect(markers.has(3)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fromColumnar (columnar → row-oriented conversion)
// ---------------------------------------------------------------------------

describe("fromColumnar", () => {
  it("converts columnar format to row-oriented BucketedChartDataPoint[]", () => {
    const columnar: ColumnarBucketedSeries = {
      steps: [0, 10, 20],
      times: ["2024-01-01T00:00:00", "2024-01-01T00:01:00", "2024-01-01T00:02:00"],
      values: [1.5, 2.0, null],
      minYs: [1.0, 1.5, null],
      maxYs: [2.0, 2.5, null],
      counts: [10, 20, 5],
      nfFlags: [0, 0, 1],
    };

    const rows = fromColumnar(columnar);
    expect(rows).toHaveLength(3);

    expect(rows[0]).toEqual({
      step: 0,
      time: "2024-01-01T00:00:00",
      value: 1.5,
      minY: 1.0,
      maxY: 2.0,
      count: 10,
      nonFiniteFlags: 0,
    });

    expect(rows[1]).toEqual({
      step: 10,
      time: "2024-01-01T00:01:00",
      value: 2.0,
      minY: 1.5,
      maxY: 2.5,
      count: 20,
      nonFiniteFlags: 0,
    });

    expect(rows[2]).toEqual({
      step: 20,
      time: "2024-01-01T00:02:00",
      value: null,
      minY: null,
      maxY: null,
      count: 5,
      nonFiniteFlags: 1,
    });
  });

  it("handles empty columnar series", () => {
    const columnar: ColumnarBucketedSeries = {
      steps: [],
      times: [],
      values: [],
      minYs: [],
      maxYs: [],
      counts: [],
      nfFlags: [],
    };

    const rows = fromColumnar(columnar);
    expect(rows).toHaveLength(0);
  });

  it("roundtrips through applyServerBuckets without data loss", () => {
    const original: BucketedChartDataPoint[] = [
      { step: 0, time: "t0", value: 1.5, minY: 1.0, maxY: 2.0, count: 10, nonFiniteFlags: 0 },
      { step: 1, time: "t1", value: null, minY: null, maxY: null, count: 5, nonFiniteFlags: 1 },
      { step: 2, time: "t2", value: 3.0, minY: 2.5, maxY: 3.5, count: 20, nonFiniteFlags: 6 },
    ];

    // Simulate server toColumnar (manual construction matching the server function)
    const columnar: ColumnarBucketedSeries = {
      steps: original.map((p) => p.step),
      times: original.map((p) => p.time),
      values: original.map((p) => p.value),
      minYs: original.map((p) => p.minY),
      maxYs: original.map((p) => p.maxY),
      counts: original.map((p) => p.count),
      nfFlags: original.map((p) => p.nonFiniteFlags ?? 0),
    };

    const restored = fromColumnar(columnar);
    expect(restored).toEqual(original);

    // Verify applyServerBuckets produces identical output from restored data
    const [mainOriginal] = applyServerBuckets(original, "test", "#00f");
    const [mainRestored] = applyServerBuckets(restored, "test", "#00f");
    expect(mainRestored.x).toEqual(mainOriginal.x);
    expect(mainRestored.y).toEqual(mainOriginal.y);
  });
});

// ---------------------------------------------------------------------------
// bucketedAndSmooth — smoothed line must stay within envelope bands
// ---------------------------------------------------------------------------

describe("bucketedAndSmooth envelope invariant", () => {
  /**
   * Generate LTTB-like bucketed data where each bucket has a tight min/max
   * band but the representative value jumps between high and low ranges.
   * This simulates LTTB selecting an extreme data point from alternating
   * high/low regions — realistic for noisy metrics where adjacent buckets
   * happen to sample opposite ends of the noise spectrum.
   *
   * The key property: each value IS within its bucket's [minY, maxY], but
   * adjacent buckets have very different value ranges. When smoothing blends
   * across bucket boundaries, the smoothed line can escape a bucket's band.
   */
  function makeLttbLikeBuckets(n: number): BucketedChartDataPoint[] {
    return Array.from({ length: n }, (_, i) => {
      // Alternate between high-range buckets and low-range buckets
      const isHigh = i % 2 === 0;
      const center = isHigh ? 0.85 : 0.15;
      const halfWidth = 0.05;
      const minY = center - halfWidth;
      const maxY = center + halfWidth;
      // LTTB picks a point within the bucket's range
      const value = center;
      return {
        step: i * 100,
        time: `2024-01-01T00:${String(i).padStart(2, "0")}:00`,
        value,
        minY,
        maxY,
        count: 50,
        nonFiniteFlags: 0,
      };
    });
  }

  for (const { name, settings } of SMOOTHING_CONFIGS) {
    it(`${name}: smoothed line stays within envelope bands`, () => {
      const buckets = makeLttbLikeBuckets(100);
      const series = bucketedAndSmooth(buckets, "metric", "#00f", settings);

      // Find the main series (not envelope, not companion)
      const main = series.find(
        (s) => !s.envelopeOf && !s.label.includes("(original)"),
      );
      const envMin = series.find((s) => s.envelopeBound === "min");
      const envMax = series.find((s) => s.envelopeBound === "max");

      expect(main).toBeDefined();
      expect(envMin).toBeDefined();
      expect(envMax).toBeDefined();

      for (let i = 0; i < main!.y.length; i++) {
        const v = main!.y[i];
        const lo = envMin!.y[i];
        const hi = envMax!.y[i];
        if (v === null || lo === null || hi === null) continue;

        expect(v).toBeGreaterThanOrEqual(lo as number);
        expect(v).toBeLessThanOrEqual(hi as number);
      }
    });
  }

  it("without smoothing: line stays within envelope bands (baseline)", () => {
    const buckets = makeLttbLikeBuckets(100);
    const noSmooth: SmoothingSettings = {
      enabled: false,
      algorithm: "gaussian",
      parameter: 2,
      showOriginalData: false,
    };
    const series = bucketedAndSmooth(buckets, "metric", "#00f", noSmooth);

    const main = series.find(
      (s) => !s.envelopeOf && !s.label.includes("(original)"),
    );
    const envMin = series.find((s) => s.envelopeBound === "min");
    const envMax = series.find((s) => s.envelopeBound === "max");

    expect(main).toBeDefined();
    expect(envMin).toBeDefined();
    expect(envMax).toBeDefined();

    for (let i = 0; i < main!.y.length; i++) {
      const v = main!.y[i];
      const lo = envMin!.y[i];
      const hi = envMax!.y[i];
      if (v === null || lo === null || hi === null) continue;

      expect(v).toBeGreaterThanOrEqual(lo as number);
      expect(v).toBeLessThanOrEqual(hi as number);
    }
  });
});
