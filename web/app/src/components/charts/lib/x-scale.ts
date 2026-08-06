import type uPlot from "uplot";

// ============================
// X-scale refitting
// ============================
//
// Extracted from use-chart-lifecycle.ts (Boy Scout: that file is past 500
// lines). These are pure with respect to React — they read the chart's series
// `show` flags and the aligned data, and drive `setScale("x", …)`.
//
// IMPORTANT for callers: `resetXScale` changes a scale, so the caller must run
// it through `withProgrammaticScale` (flag + batch). The chart's setScale hook
// treats an unflagged X change as a *user zoom* and fires `onZoomRangeChange`,
// which stores a new zoom range. That re-renders the chart component,
// `uplotData` gets a new identity, the chart is recreated, and whatever
// prompted the refit runs again on the new instance — a self-sustaining
// rebuild loop. See `withProgrammaticScale` below for why the batch is as
// load-bearing as the flag.

/**
 * Compute the X-axis range considering only visible (non-hidden) series.
 * Returns null if no visible series have data — caller should fall back to
 * the full range.
 */
export function getVisibleXRange(
  chart: uPlot,
  data: uPlot.AlignedData,
): [number, number] | null {
  const xVals = data[0] as number[];
  if (!xVals || xVals.length === 0) return null;

  let minIdx = -1;
  let maxIdx = -1;

  for (let xi = 0; xi < xVals.length; xi++) {
    for (let si = 1; si < data.length; si++) {
      if (!chart.series[si]?.show) continue;
      const v = (data[si] as (number | null)[])[xi];
      if (v !== null && v !== undefined) {
        if (minIdx === -1) minIdx = xi;
        maxIdx = xi;
        break; // Found a visible value at this x, no need to check more series
      }
    }
  }

  if (minIdx === -1) return null;
  return [xVals[minIdx], xVals[maxIdx]];
}

/**
 * Reset the X-axis scale, respecting globalXRange if set, otherwise fitting to
 * visible (non-hidden) series data with a full-range fallback.
 *
 * Callers must wrap this in the programmatic-scale flag — see the module note.
 */
export function resetXScale(
  chart: uPlot,
  data: uPlot.AlignedData,
  globalRange: [number, number] | null,
): void {
  if (globalRange) {
    chart.setScale("x", { min: globalRange[0], max: globalRange[1] });
    return;
  }
  const visibleRange = getVisibleXRange(chart, data);
  if (visibleRange) {
    chart.setScale("x", { min: visibleRange[0], max: visibleRange[1] });
    return;
  }
  const xVals = data[0] as number[];
  if (xVals && xVals.length > 0) {
    chart.setScale("x", { min: xVals[0], max: xVals[xVals.length - 1] });
  }
}

/**
 * Run `fn` with the programmatic-scale flag raised, restoring it afterwards
 * even if `fn` throws.
 *
 * Every scale change this app drives itself must go through here (or the
 * equivalent inline try/finally + `chart.batch`). An unflagged change is
 * indistinguishable from a user zoom to the setScale hook.
 *
 * `fn` runs inside `chart.batch()`, and that is load-bearing rather than an
 * optimisation. A bare `chart.setScale(...)` only queues uPlot's `_commit` on
 * a *microtask* (uPlot.esm.js `commit()`), so the `setScale` hooks fire long
 * after this function's `finally` has already lowered the flag — the guard
 * silently does nothing and the hook reads the change as a user zoom.
 * `batch()` calls `_commit()` synchronously, so the hooks fire while the flag
 * is still raised.
 */
export function withProgrammaticScale(
  chart: uPlot,
  flagRef: { current: boolean },
  fn: () => void,
): void {
  try {
    flagRef.current = true;
    chart.batch(fn);
  } finally {
    flagRef.current = false;
  }
}
