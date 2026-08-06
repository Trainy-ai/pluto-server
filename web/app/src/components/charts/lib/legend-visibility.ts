import type uPlot from "uplot";

// ============================
// Legend Row Visibility — runs hidden via the runs-table eye toggle
// ============================
//
// Hiding a run switches its series off with `setSeries(i, { show: false })`,
// which stops uPlot drawing the line but leaves the series — and therefore its
// legend row — in place. These helpers take the row out of the legend too.
//
// Inline `display` is deliberate: the PNG exporter treats a `display: none`
// row as "not in the legend" (see `extractLegendEntries` in
// chart-export-utils.ts), so the export follows the on-screen legend with no
// export-side changes. The fullscreen sidebar preserves it via an explicit
// `[style*="display: none"]` rule in index.css, which would otherwise be
// overridden by that sidebar's `display: flex` row layout.

/** Rows that are hidden for a reason unrelated to run visibility. */
const COMPANION_FLAG = "legendCompanion";

/**
 * Cache the `.u-legend` element on the chart.
 *
 * The fullscreen dialog re-parents the legend out of `chart.root` and into its
 * own sidebar, so re-querying `chart.root` finds nothing once a chart has been
 * opened fullscreen. A direct node reference survives the move.
 */
export function cacheLegendElement(chart: uPlot): void {
  (chart as unknown as { _legendEl?: Element | null })._legendEl =
    chart.root.querySelector(".u-legend");
}

/** The legend's rows, fetched once. Callers touching many series must hoist
 *  this: querying per series turns a redraw into an O(n^2) DOM crawl, which
 *  hung the page on projects with a few hundred runs. */
export function getLegendRowList(chart: uPlot): NodeListOf<HTMLElement> | null {
  const cached = (chart as unknown as { _legendEl?: Element | null })._legendEl;
  const legend = cached ?? chart.root.querySelector(".u-legend");
  return legend
    ? (legend.querySelectorAll("tr.u-series") as NodeListOf<HTMLElement>)
    : null;
}

/** Show/hide one already-resolved row. */
export function setLegendRowRemovedAt(
  rows: NodeListOf<HTMLElement> | null,
  seriesIdx: number,
  removed: boolean,
): void {
  const row = rows?.[seriesIdx];
  if (!row || row.dataset[COMPANION_FLAG] === "true") return;
  row.style.display = removed ? "none" : "";
}

function getLegendRows(chart: uPlot): NodeListOf<HTMLElement> | null {
  const cached = (chart as unknown as { _legendEl?: Element | null })._legendEl;
  const legend = cached ?? chart.root.querySelector(".u-legend");
  return legend
    ? (legend.querySelectorAll("tr.u-series") as NodeListOf<HTMLElement>)
    : null;
}

/**
 * Flag a row as hidden for a non-run reason (the "(original)" smoothing
 * companion series). Such rows must stay hidden when a run is un-hidden.
 */
export function markLegendCompanionRow(row: HTMLElement): void {
  row.dataset[COMPANION_FLAG] = "true";
}

/**
 * Show or hide the legend row for a run toggled via the runs-table eye.
 *
 * uPlot emits one legend row per series preceded by the x-axis row, so legend
 * row N belongs to series N.
 *
 * Two kinds of row are deliberately left alone:
 *   - companion rows, hidden for an unrelated reason;
 *   - series switched off by clicking the legend, which keep their row so
 *     there is something left to click to bring them back.
 */
export function setRunLegendRowHidden(
  chart: uPlot,
  seriesIdx: number,
  hidden: boolean,
): void {
  const row = getLegendRows(chart)?.[seriesIdx];
  if (!row || row.dataset[COMPANION_FLAG] === "true") return;
  row.style.display = hidden ? "none" : "";
}
