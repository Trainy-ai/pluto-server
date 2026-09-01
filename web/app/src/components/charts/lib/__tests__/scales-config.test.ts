import { describe, it, expect, beforeAll } from "vitest";
import type uPlot from "uplot";

// uPlot probes matchMedia at MODULE load, and jsdom has none — so the stub has
// to be in place before the import runs, which rules out a plain top-level
// import here.
type BuildScalesConfig = (p: {
  logXAxis: boolean;
  logYAxis: boolean;
  isDateTime: boolean;
  yRangeRef: { current: [number, number] };
  yZoom: { min: number; max: number } | null;
  categoryCount: number;
}) => uPlot.Scales;

let buildScalesConfig: BuildScalesConfig;

beforeAll(async () => {
  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
  ({ buildScalesConfig } = (await import("../scales-config")) as unknown as {
    buildScalesConfig: BuildScalesConfig;
  });
});

/**
 * uPlot's `x` scale defaults to `time: true` — it assumes x values are seconds
 * since the epoch unless told otherwise. Every axis we draw that is NOT a
 * datetime axis has to say so explicitly.
 *
 * Getting this wrong is invisible in almost every test: the chart renders, the
 * line is correct, only the tick POSITIONS move. On a step axis they land on
 * 10.8k / 21.6k / 32.4k, which are 3h / 6h / 9h in seconds and read as
 * plausible round-ish numbers. On a parametric axis carrying a metric's own
 * values it degrades — and once a value passes 8.64e12 (JavaScript's largest
 * representable Date, in seconds) uPlot cannot place a single tick and the
 * axis renders with no labels and no gridlines at all.
 */
describe("buildScalesConfig — x scale time mode", () => {
  const base = {
    logYAxis: false,
    yRangeRef: { current: [0, 1] as [number, number] },
    yZoom: null,
    categoryCount: 0,
  };

  it("marks a linear x scale as NOT time", () => {
    const s = buildScalesConfig({ ...base, logXAxis: false, isDateTime: false });
    expect(s.x.time).toBe(false);
  });

  it("marks a log x scale as NOT time", () => {
    const s = buildScalesConfig({ ...base, logXAxis: true, isDateTime: false });
    expect(s.x.time).toBe(false);
  });

  it("keeps time mode for an actual datetime axis", () => {
    const s = buildScalesConfig({ ...base, logXAxis: false, isDateTime: true });
    expect(s.x.time).toBe(true);
  });

  it("never leaves time undefined on the x scale", () => {
    // undefined is the dangerous value: uPlot reads it as true.
    for (const logXAxis of [false, true]) {
      for (const isDateTime of [false, true]) {
        const s = buildScalesConfig({ ...base, logXAxis, isDateTime });
        expect(s.x.time, `logXAxis=${logXAxis} isDateTime=${isDateTime}`).toBeDefined();
      }
    }
  });
});
