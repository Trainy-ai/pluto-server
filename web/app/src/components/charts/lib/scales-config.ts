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
          auto: false,
          range: (): uPlot.Range.MinMax => [yRange[0], yRange[1]],
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
      // Filter out drag events on the receiving side to avoid uPlot bug:
      // src.scales[xKeySrc].ori crashes when xKeySrc is null (from scales above).
      // Cursor position sync still works; drag/zoom sync is handled by our syncXScale.
      filters: {
        pub: () => true,
        sub: (_type: string, src: uPlot) => !(src?.cursor?.drag as any)?._x && !(src?.cursor?.drag as any)?._y,
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
