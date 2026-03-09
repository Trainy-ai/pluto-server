import { describe, it, expect } from "vitest";
import {
  applySmoothing,
  downsampleAndSmooth,
  buildValueFlags,
  getTimeUnitForDisplay,
  alignAndUnzip,
  applyDownsampling,
  type ChartSeriesData,
  type BaseSeriesData,
  type SmoothingSettings,
  type ChartDataPoint,
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

function makeBaseSeries(
  x: number[],
  y: number[],
  label = "metric",
): BaseSeriesData {
  return { x, y, label, color: "#00f" };
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
          const outputMean = mean(smoothedY);
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

describe("downsampleAndSmooth", () => {
  describe("mean preservation through full pipeline", () => {
    // The full pipeline (downsample → smooth) should also preserve the mean.
    // This catches bugs where downsampling + smoothing interact badly.
    const N = 500;
    const x = makeX(N);
    const datasets: Array<{ name: string; y: number[] }> = [
      { name: "gpu_util", y: makeGpuUtil(N) },
      { name: "loss", y: makeLoss(N) },
    ];

    for (const { name: dataName, y } of datasets) {
      for (const { name: algoName, settings } of SMOOTHING_CONFIGS) {
        it(`${algoName} on ${dataName} (500 pts → 100)`, () => {
          const base = makeBaseSeries(x, y);
          const result = downsampleAndSmooth(base, 100, settings);

          // Find the main smoothed series (not envelope, not original)
          const mainSeries = result.find(
            (s) => !s.envelopeOf && !s.hideFromLegend,
          );
          expect(mainSeries).toBeDefined();

          const inputMean = mean(y);
          const outputMean = mean(mainSeries!.y);
          const shift = relDiff(outputMean, inputMean);
          // Allow slightly more tolerance for the combined pipeline
          expect(shift).toBeLessThan(0.15);
        });
      }
    }
  });

  describe("series structure", () => {
    it("produces main + 2 envelope series without smoothing", () => {
      const base = makeBaseSeries(makeX(100), makeGpuUtil(100));
      const noSmoothing: SmoothingSettings = {
        enabled: false,
        algorithm: "gaussian",
        parameter: 2,
        showOriginalData: false,
      };

      const result = downsampleAndSmooth(base, 50, noSmoothing);
      expect(result).toHaveLength(3);
      // main, env_min, env_max
      expect(result[0].envelopeOf).toBeUndefined();
      expect(result[1].envelopeBound).toBe("min");
      expect(result[2].envelopeBound).toBe("max");
    });

    it("produces main + 2 envelope + original when showOriginalData", () => {
      const base = makeBaseSeries(makeX(100), makeGpuUtil(100));
      const settings: SmoothingSettings = {
        enabled: true,
        algorithm: "gaussian",
        parameter: 2,
        showOriginalData: true,
      };

      const result = downsampleAndSmooth(base, 50, settings);
      // main(smoothed) + original(dimmed) + env_min + env_max = 4
      expect(result).toHaveLength(4);
    });
  });
});

describe("applyDownsampling", () => {
  it("always produces exactly 3 series", () => {
    const base = makeBaseSeries(makeX(100), makeGpuUtil(100));
    const result = applyDownsampling(base, 20);
    expect(result).toHaveLength(3);
  });

  it("envelope min ≤ main ≤ envelope max at each point", () => {
    const base = makeBaseSeries(makeX(200), makeGpuUtil(200));
    const result = applyDownsampling(base, 50);
    const [main, envMin, envMax] = result;
    for (let i = 0; i < main.x.length; i++) {
      expect(envMin.y[i]).toBeLessThanOrEqual(main.y[i] + 1e-9);
      expect(envMax.y[i]).toBeGreaterThanOrEqual(main.y[i] - 1e-9);
    }
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
