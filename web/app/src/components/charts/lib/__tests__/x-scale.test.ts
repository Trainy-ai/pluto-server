import { describe, it, expect, vi } from "vitest";
import type uPlot from "uplot";
import {
  getVisibleXRange,
  resetXScale,
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
