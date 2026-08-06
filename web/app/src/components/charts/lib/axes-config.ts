import type uPlot from "uplot";
import { formatAxisLabels, formatRelativeTimeValues, smartDateFormatter } from "./format";

/** Vertical room one category label needs: 9px font plus breathing space. */
const MIN_CATEGORY_TICK_PX = 14;

interface AxesConfigParams {
  showXAxis: boolean;
  showYAxis: boolean;
  axisColor: string;
  gridColor: string;
  isDateTime: boolean;
  isRelativeTime: boolean;
  logXAxis: boolean;
  logYAxis: boolean;
  xlabel: string | undefined;
  ylabel: string | undefined;
  timeRange: number;
  /**
   * Y-axis tick labels for a categorical series (string metrics like
   * `phase: warmup → train → done`), indexed by their numeric y value.
   *
   * When set, the Y axis stops being a number line: ticks are pinned to one
   * per category and labelled with the category, which is the whole reason a
   * string metric can be drawn as a chart at all. Undefined everywhere else,
   * so every existing chart keeps its numeric formatting untouched.
   */
  yCategories?: string[];
}

/**
 * Build uPlot axes configuration for X and Y axes.
 * Handles datetime, relative time, and numeric axis formatting.
 */
export function buildAxesConfig({
  showXAxis,
  showYAxis,
  axisColor,
  gridColor,
  isDateTime,
  isRelativeTime,
  logXAxis,
  logYAxis,
  xlabel,
  ylabel,
  timeRange,
  yCategories,
}: AxesConfigParams): uPlot.Axis[] {
  // Length, not mere presence: an empty array would make `Math.max(...[])`
  // return -Infinity (and so `size: -Infinity`), while `categoryCount` in
  // scales-config stayed falsy — leaving the axis categorical but the scale
  // numeric. Keyed on the same condition as every other categorical branch
  // below so the two can't disagree.
  const isCategorical = !!yCategories?.length;

  // Widen the gutter to fit the longest label — category names ("warmup",
  // "throttled") are far wider than the numbers the default 40px assumes.
  const categoryAxisWidth = isCategorical
    ? Math.min(120, 24 + Math.max(...yCategories.map((c) => c.length)) * 5.5)
    : 0;

  return [
    {
      // X axis
      show: showXAxis !== false,
      stroke: axisColor,
      grid: { stroke: gridColor, dash: [2, 2] },
      ticks: { stroke: gridColor, size: 3 },
      values: isDateTime
        ? (u, vals) => vals.map((v) => smartDateFormatter(v, timeRange))
        : isRelativeTime
          ? (u, vals) => formatRelativeTimeValues(vals)
          : (u, vals) => formatAxisLabels(vals, logXAxis),
      label: xlabel,
      labelSize: xlabel ? 14 : 0,
      labelFont: "10px ui-monospace, monospace",
      font: "9px ui-monospace, monospace",
      size: xlabel ? 32 : 24, // Compact height for x-axis
      gap: 2,
    },
    {
      // Y axis
      show: showYAxis !== false,
      stroke: axisColor,
      grid: { stroke: gridColor, dash: [2, 2] },
      ticks: { stroke: gridColor, size: 3 },
      values: isCategorical
        ? (u, vals) => vals.map((v) => yCategories![v] ?? "")
        : (u, vals) => formatAxisLabels(vals, logYAxis),
      // One tick per category, no fractional steps between them — but thinned
      // when they can't fit. uPlot draws nothing at all rather than an
      // unreadable smear, so a 39-value series (which does happen: a string
      // metric logging near-unique values) came out with a completely blank
      // axis. Showing every Nth label at least anchors the reader.
      ...(isCategorical
        ? {
            splits: (u: uPlot) => {
              const plotHeight = u.bbox.height / (window.devicePixelRatio || 1);
              const perTick = plotHeight / yCategories!.length;
              const stride = perTick >= MIN_CATEGORY_TICK_PX
                ? 1
                : Math.ceil(MIN_CATEGORY_TICK_PX / Math.max(perTick, 1));
              return yCategories!
                .map((_, i) => i)
                .filter((i) => i % stride === 0);
            },
            // NO `incrs` here. Pinning it to [1] made uPlot require one tick
            // per category *before* consulting `splits`, and its default 30px
            // minimum Y tick spacing then made 39 categories need 1170px in a
            // 297px plot. Unable to satisfy that, uPlot drew no ticks and no
            // labels at all — a completely blank axis. `splits` already
            // decides tick placement; `space` just tells uPlot the density is
            // intentional.
            space: MIN_CATEGORY_TICK_PX,
          }
        : {}),
      label: ylabel,
      labelSize: ylabel ? 14 : 0,
      labelFont: "10px ui-monospace, monospace",
      font: "9px ui-monospace, monospace",
      size: isCategorical ? categoryAxisWidth : ylabel ? 50 : 40,
      gap: 2,
    },
  ];
}
