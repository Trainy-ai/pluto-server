import uPlot from "uplot";

interface ScalesConfigParams {
  logXAxis: boolean;
  logYAxis: boolean;
  isDateTime: boolean;
  yRange: [number, number, boolean];
  yZoom: boolean;
}

/**
 * Build uPlot scales configuration for X and Y axes.
 *
 * X-axis always uses auto:true so zoom (drag-to-select) works.
 * Global X range is applied AFTER chart creation via setScale().
 *
 * Y-axis supports: auto-scale, outlier-aware range (yRange[2]),
 * and log scale (distr: 3).
 */
export function buildScalesConfig({
  logXAxis,
  logYAxis,
  isDateTime,
  yRange,
  yZoom,
}: ScalesConfigParams): uPlot.Scales {
  return {
    x: logXAxis
      ? { distr: 3 }
      : isDateTime
        ? { time: true, auto: true }
        : { auto: true },
    y: logYAxis
      ? { distr: 3 }
      : {
          // auto:true makes uPlot recompute Y range from visible (shown)
          // series on every commit — including after setSeries toggles.
          // The range callback adds padding to the auto-computed min/max.
          auto: true,
          range: (_self: uPlot, dataMin: number | null, dataMax: number | null): uPlot.Range.MinMax => {
            // No visible data — fall back to pre-computed range
            if (dataMin == null || dataMax == null) return [yRange[0], yRange[1]];

            const range = dataMax - dataMin;
            const mag = Math.max(Math.abs(dataMax), Math.abs(dataMin), 0.1);
            const minRange = mag * 0.1;

            let yMin: number, yMax: number;
            if (range < minRange) {
              const center = (dataMin + dataMax) / 2;
              yMin = center - minRange / 2;
              yMax = center + minRange / 2;
              if (dataMin >= 0 && yMin < 0) { yMin = 0; yMax = minRange; }
            } else {
              const padding = range * 0.05;
              yMin = dataMin - padding;
              yMax = dataMax + padding;
              if (dataMin >= 0 && yMin < 0) yMin = 0;
            }
            return [yMin, yMax];
          },
        },
  };
}

/**
 * Build uPlot cursor configuration with sync and drag settings.
 */
export function buildCursorConfig(
  effectiveSyncKey: string,
  yZoom: boolean,
): uPlot.Cursor {
  return {
    sync: {
      key: effectiveSyncKey,
      // IMPORTANT: Do NOT sync scales via uPlot's built-in mechanism.
      // It syncs ALL charts with the same key regardless of zoom group,
      // causing Step zoom to leak to Relative Time charts. Our custom
      // syncXScale handles zoom sync with proper group filtering.
      scales: [null, null],
      setSeries: false, // DISABLED - was causing seriesIdx to always be null due to cross-chart sync
      // Block mousedown/mouseup sync to prevent receivers from entering drag
      // mode, which would crash at src.scales[null].ori (scales: [null, null]).
      // Cursor position sync (mousemove) still works; drag/zoom is handled by
      // our custom syncXScale. NOTE: the old filter checked drag._x/._y, but
      // uPlot initializes those from drag.x (the config boolean, e.g. true),
      // so before the first mousedown they incorrectly blocked ALL sync events.
      filters: {
        pub: () => true,
        sub: (type: string) => type !== "mousedown" && type !== "mouseup",
      },
    },
    focus: {
      prox: -1, // Always highlight the closest series regardless of distance
    },
    drag: {
      x: true,
      y: yZoom,
      ...(yZoom && { uni: Infinity }),
      setScale: true,
    },
  };
}
