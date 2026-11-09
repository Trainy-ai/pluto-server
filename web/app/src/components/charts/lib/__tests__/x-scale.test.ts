import { describe, it, expect, vi } from "vitest";
import type uPlot from "uplot";
import {
  getVisibleXRange,
  padDegenerateXRange,
  resetXScale,
  xScaleKind,
  withProgrammaticScale,
} from "../x-scale";

/**
 * Unit tests for the X-scale refit helpers extracted from use-chart-lifecycle.
 *
 * The `withProgrammaticScale` tests are the regression guard for the
 * hide-a-run rebuild loop: an X-scale change that the setScale hook does not
 * see as programmatic is read as a user zoom, which stores a new zoom range,
 * which re-renders the chart, which gives `uplotData` a new identity, which
 * recreates the chart, which refits the scale again…
 */

interface FakeChart {
  series: { show: boolean }[];
  setScale: ReturnType<typeof vi.fn>;
  batch: (fn: () => void) => void;
}

function makeChart(show: boolean[]): FakeChart {
  return {
    // index 0 is the x series, mirroring uPlot
    series: [{ show: true }, ...show.map((s) => ({ show: s }))],
    setScale: vi.fn(),
    batch: (fn: () => void) => fn(),
  };
}

describe("getVisibleXRange", () => {
  const x = [10, 20, 30, 40];

  it("spans only the x positions where a visible series has data", () => {
    const chart = makeChart([true, true]);
    const data = [x, [null, 1, 2, null], [null, null, 5, null]];
    expect(
      getVisibleXRange(chart as unknown as uPlot, data as uPlot.AlignedData),
    ).toEqual([20, 30]);
  });

  it("ignores hidden series when computing the range", () => {
    const chart = makeChart([false, true]);
    // The hidden series is the only one reaching x=40.
    const data = [x, [1, 1, 1, 9], [null, 2, 2, null]];
    expect(
      getVisibleXRange(chart as unknown as uPlot, data as uPlot.AlignedData),
    ).toEqual([20, 30]);
  });

  it("returns null when no visible series has data", () => {
    const chart = makeChart([false]);
    const data = [x, [1, 2, 3, 4]];
    expect(
      getVisibleXRange(chart as unknown as uPlot, data as uPlot.AlignedData),
    ).toBeNull();
  });

  it("returns null for empty x data", () => {
    const chart = makeChart([true]);
    expect(
      getVisibleXRange(chart as unknown as uPlot, [[], []] as uPlot.AlignedData),
    ).toBeNull();
  });
});

describe("resetXScale", () => {
  const x = [0, 1, 2, 3];

  it("prefers the global range when one is set", () => {
    const chart = makeChart([true]);
    resetXScale(
      chart as unknown as uPlot,
      [x, [1, 2, 3, 4]] as uPlot.AlignedData,
      [100, 200],
    );
    expect(chart.setScale).toHaveBeenCalledWith("x", { min: 100, max: 200 });
  });

  it("fits to the visible range when there is no global range", () => {
    const chart = makeChart([true]);
    resetXScale(
      chart as unknown as uPlot,
      [x, [null, 5, 6, null]] as uPlot.AlignedData,
      null,
    );
    expect(chart.setScale).toHaveBeenCalledWith("x", { min: 1, max: 2 });
  });

  it("falls back to the full x extent when nothing visible has data", () => {
    const chart = makeChart([false]);
    resetXScale(
      chart as unknown as uPlot,
      [x, [1, 2, 3, 4]] as uPlot.AlignedData,
      null,
    );
    expect(chart.setScale).toHaveBeenCalledWith("x", { min: 0, max: 3 });
  });

  it("does nothing when there is no x data at all", () => {
    const chart = makeChart([true]);
    resetXScale(chart as unknown as uPlot, [[], []] as uPlot.AlignedData, null);
    expect(chart.setScale).not.toHaveBeenCalled();
  });
});

describe("withProgrammaticScale", () => {
  /**
   * Stand-in for uPlot's commit scheduling. Outside `batch()`, `setScale`
   * only queues `_commit` on a microtask, so the setScale hooks run *after*
   * the caller's synchronous try/finally. Inside `batch()`, `_commit` (and
   * therefore the hooks) runs synchronously. This fake reproduces exactly
   * that asymmetry, because it is the whole reason the helper batches.
   */
  function makeCommitChart(onScaleHook: () => void) {
    let inBatch = false;
    let pending = false;
    const commit = () => {
      pending = false;
      onScaleHook();
    };
    return {
      flushMicrotasks: async () => {
        await Promise.resolve();
        if (pending) commit();
      },
      chart: {
        setScale: () => {
          if (inBatch) {
            pending = true;
          } else if (!pending) {
            pending = true;
            void Promise.resolve().then(() => {
              if (pending) commit();
            });
          }
        },
        batch: (fn: () => void) => {
          inBatch = true;
          try {
            fn();
          } finally {
            inBatch = false;
          }
          if (pending) commit();
        },
      },
    };
  }

  it("raises the flag for the duration of the callback", () => {
    const ref = { current: false };
    const chart = makeChart([true]);
    let seen: boolean | null = null;
    withProgrammaticScale(chart as unknown as uPlot, ref, () => {
      seen = ref.current;
    });
    expect(seen).toBe(true);
  });

  it("lowers the flag afterwards", () => {
    const ref = { current: false };
    const chart = makeChart([true]);
    withProgrammaticScale(chart as unknown as uPlot, ref, () => {});
    expect(ref.current).toBe(false);
  });

  it("lowers the flag even when the callback throws", () => {
    // A stuck flag would silently disable zoom-refetch for the rest of the
    // session — the opposite failure to the rebuild loop, equally invisible.
    const ref = { current: false };
    const chart = makeChart([true]);
    expect(() =>
      withProgrammaticScale(chart as unknown as uPlot, ref, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(ref.current).toBe(false);
  });

  it("still has the flag raised when the setScale hook fires", async () => {
    // The regression: `setScale` outside a batch defers the hook to a
    // microtask, by which point a plain try/finally has already lowered the
    // flag — the hook then reads the refit as a user zoom and starts the
    // rebuild loop. Batching forces the hook to fire inside the guard.
    const ref = { current: false };
    const flagAtHook: boolean[] = [];
    const { chart, flushMicrotasks } = makeCommitChart(() =>
      flagAtHook.push(ref.current),
    );

    withProgrammaticScale(chart as unknown as uPlot, ref, () => {
      chart.setScale();
    });
    await flushMicrotasks();

    expect(flagAtHook).toEqual([true]);
  });

  it("shows the unbatched call it replaces losing the flag", async () => {
    // Control for the test above: this is what the old
    // `try { flag = true; resetXScale(...) } finally { flag = false }`
    // shape actually did.
    const ref = { current: false };
    const flagAtHook: boolean[] = [];
    const { chart, flushMicrotasks } = makeCommitChart(() =>
      flagAtHook.push(ref.current),
    );

    try {
      ref.current = true;
      chart.setScale();
    } finally {
      ref.current = false;
    }
    await flushMicrotasks();

    expect(flagAtHook).toEqual([false]);
  });
});

/**
 * Regression guard for the zero-width X scale that hung uPlot and OOM'd the tab.
 *
 * uPlot assigns an explicit `setScale("x", { min, max })` verbatim — no range
 * callback, no padding. With min === max, `findIncr` sees delta 0, so every
 * increment "fits" and it picks the smallest one its digit budget allows
 * (1e-16 for a one-digit value). `numAxisSplits` then loops
 * `val = roundDec(val + incr)`, and since `6 + 1e-16 === 6` the value never
 * advances: `splits.push(6)` runs until V8's array-length cap (~1 GB), throwing
 * "Invalid array length" or killing the renderer first. Seen in prod on a
 * metric every run logged exactly once.
 */
describe("padDegenerateXRange", () => {
  it("passes a real range through untouched", () => {
    expect(padDegenerateXRange(0, 10)).toEqual([0, 10]);
    expect(padDegenerateXRange(-5, 5)).toEqual([-5, 5]);
  });

  it("widens a single point at x=6 — the value from the prod crash", () => {
    const [min, max] = padDegenerateXRange(6, 6);
    expect(min).toBeLessThan(6);
    expect(max).toBeGreaterThan(6);
  });

  it("centres the point, matching the chart's existing single-point framing", () => {
    // ±max(|x|·0.5, 1) — the same padding use-chart-lifecycle used inline.
    expect(padDegenerateXRange(6, 6)).toEqual([3, 9]);
    expect(padDegenerateXRange(0, 0)).toEqual([-1, 1]);
    expect(padDegenerateXRange(1, 1)).toEqual([0, 2]);
    expect(padDegenerateXRange(-7, -7)).toEqual([-10.5, -3.5]);
  });

  it("leaves a range wide enough for ticks at every magnitude", () => {
    // Values chosen from the ones verified to hang uPlot 1.6.32 unpadded.
    for (const x of [1, 3, 6, 99, 5000, 123457, 1.5e9, -7, 0.3]) {
      const [min, max] = padDegenerateXRange(x, x);
      // The width must be representable at this magnitude, or uPlot's tick
      // loop can stall exactly as it did for the unpadded point.
      expect(max - min).toBeGreaterThanOrEqual(1);
      expect(min + (max - min) / 2).toBeCloseTo(x);
    }
  });
});

describe("padDegenerateXRange on log and time axes", () => {
  // The reset and double-click paths are not gated on axis type, so the
  // padding reaches these scales too. Linear padding would be wrong on both.

  it("pads a log axis multiplicatively, so the range stays positive", () => {
    // Linear ±1 on x=1 would give [0, 2], and an explicit min of 0 sends
    // uPlot's logAxisSplits into its own log(0) infinite loop.
    expect(padDegenerateXRange(1, 1, "log")).toEqual([0.5, 2]);
    expect(padDegenerateXRange(0.25, 0.25, "log")).toEqual([0.125, 0.5]);
    expect(padDegenerateXRange(5000, 5000, "log")).toEqual([2500, 10000]);
  });

  it("pads a time axis by one minute, not by half the epoch", () => {
    const t = Date.UTC(2026, 10, 7, 12, 0, 0); // ms, as the chart stores it
    expect(padDegenerateXRange(t, t, "time")).toEqual([t - 60_000, t + 60_000]);
  });

  it("passes a real range through on every axis kind", () => {
    expect(padDegenerateXRange(1, 10, "log")).toEqual([1, 10]);
    expect(padDegenerateXRange(1000, 2000, "time")).toEqual([1000, 2000]);
  });
});

describe("xScaleKind", () => {
  it("reads log from distr 3 and time from the time flag", () => {
    const of = (x: object) => xScaleKind({ scales: { x } } as unknown as uPlot);
    expect(of({ distr: 3, time: false })).toBe("log");
    expect(of({ distr: 1, time: true })).toBe("time");
    expect(of({ distr: 1, time: false })).toBe("linear");
  });

  it("defaults to linear when the chart has no x scale yet", () => {
    expect(xScaleKind({ scales: {} } as unknown as uPlot)).toBe("linear");
    expect(xScaleKind({} as unknown as uPlot)).toBe("linear");
  });
});

describe("resetXScale never commits a zero-width range", () => {
  function lastRange(chart: FakeChart): { min: number; max: number } {
    const calls = chart.setScale.mock.calls;
    return calls[calls.length - 1][1];
  }

  it("pads a single-step series fitted from visible data", () => {
    const chart = makeChart([true, true, true]);
    // Every run logged the metric once, at step 6.
    resetXScale(
      chart as unknown as uPlot,
      [[6], [0.5], [1.2], [2]] as uPlot.AlignedData,
      null,
    );
    const { min, max } = lastRange(chart);
    expect(max).toBeGreaterThan(min);
  });

  it("pads when the only visible series has a single point", () => {
    // The hidden series spans 0..6; the visible one only reaches x=6.
    const chart = makeChart([false, true]);
    resetXScale(
      chart as unknown as uPlot,
      [[0, 6], [1, 2], [null, 3]] as uPlot.AlignedData,
      null,
    );
    const { min, max } = lastRange(chart);
    expect(min).toBeLessThan(6);
    expect(max).toBeGreaterThan(6);
  });

  it("pads the full-extent fallback when nothing visible has data", () => {
    const chart = makeChart([false]);
    resetXScale(
      chart as unknown as uPlot,
      [[6], [1]] as uPlot.AlignedData,
      null,
    );
    const { min, max } = lastRange(chart);
    expect(max).toBeGreaterThan(min);
  });

  it("pads a single point on a log X axis without reaching zero", () => {
    const chart = makeChart([true]);
    (chart as unknown as { scales: object }).scales = { x: { distr: 3, time: false } };
    resetXScale(
      chart as unknown as uPlot,
      [[1], [7]] as uPlot.AlignedData,
      null,
    );
    expect(lastRange(chart)).toEqual({ min: 0.5, max: 2 });
  });

  it("pads a degenerate global range", () => {
    const chart = makeChart([true]);
    resetXScale(
      chart as unknown as uPlot,
      [[6], [1]] as uPlot.AlignedData,
      [6, 6],
    );
    const { min, max } = lastRange(chart);
    expect(max).toBeGreaterThan(min);
  });
});
