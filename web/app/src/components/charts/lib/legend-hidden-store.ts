// ============================
// Chart-local visibility overrides — shared across the inline ⇄ fullscreen boundary
// ============================
//
// Switching a series from the tooltip or by clicking its legend row is a
// CHART-LOCAL change: it affects only that chart, unlike the runs-table eye
// which applies everywhere. Effective visibility on a chart is
//
//     override ?? !eyeHidden
//
// so the runs table is a default that a chart may override in EITHER
// direction. Storing only "hidden" ids could not express "shown here even
// though the table hid it", which is why a local un-hide was lost the moment
// a chart was recreated — entering fullscreen re-applied the table and the
// override had nowhere to live.
//
// Toggling a run in the runs table clears that run's overrides everywhere, so
// the table stays authoritative and old per-chart tweaks don't linger.
//
// Opening fullscreen doesn't move the chart — it invokes `renderChart()` a
// second time, mounting a SEPARATE LineUplot inside the dialog while the
// inline one stays mounted behind it (3 uPlot instances for 2 visible
// charts). A per-component ref therefore starts empty in fullscreen and the
// series came back visible.
//
// Keying the set by sync group + chart title gives the inline and fullscreen
// renders of the same chart one shared store, so the hide survives the
// transition.
//
// Known limitation: two charts with the SAME title in the SAME sync group
// (e.g. a dashboard with two widgets on one metric) share a store and so
// share their chart-local hides. Callers that have a stronger identity can
// pass an explicit `legendStateKey` (a widget id) to opt out.

/** key -> (seriesId -> locally shown?) */
const stores = new Map<string, Map<string, boolean>>();

/** Listeners per store key. A chart subscribes so it can re-apply the set when
 *  ANOTHER chart sharing the key toggles a series. Without this the sharing is
 *  one-directional: entering fullscreen creates a chart, which reads the set at
 *  creation, but leaving fullscreen doesn't recreate the inline chart — so
 *  toggles made in fullscreen were never reflected on the way back out. */
const listeners = new Map<string, Set<(origin: string) => void>>();

/** How many mounted charts are using each key, so a store can be dropped when
 *  the last one goes. Without this the map only ever grows, and a later chart
 *  reusing a key can reopen with hides nobody made in this session. */
const refCounts = new Map<string, number>();

/** Claim `key` for a mounting chart. */
export function retainLegendHiddenStore(key: string): void {
  refCounts.set(key, (refCounts.get(key) ?? 0) + 1);
}

/**
 * Release `key` for an unmounting chart, dropping the store once nobody holds
 * it. Entering fullscreen keeps the inline chart mounted, so the count stays
 * above zero across that transition and the hides survive it.
 */
export function releaseLegendHiddenStore(key: string): void {
  const next = (refCounts.get(key) ?? 0) - 1;
  if (next > 0) {
    refCounts.set(key, next);
    return;
  }
  refCounts.delete(key);
  stores.delete(key);
}

/** Stable key for a chart's local hidden-series set. */
export function legendHiddenKey(
  syncKey: string,
  title: string | undefined,
  explicitKey: string | undefined,
): string {
  return explicitKey ?? `${syncKey}::${title ?? ""}`;
}

/** The shared hidden-series set for `key`, created on first use. */
export function getLegendHiddenStore(key: string): Map<string, boolean> {
  let store = stores.get(key);
  if (!store) {
    store = new Map<string, boolean>();
    stores.set(key, store);
  }
  return store;
}

/** The runId part of a seriesId (`runId` or `runId:metric`). */
export function runIdOf(seriesId: string): string {
  return seriesId.includes(":") ? seriesId.split(":")[0] : seriesId;
}

/**
 * Forget every chart-local override for `runId`.
 *
 * Called when the runs-table eye toggles that run: the table is authoritative,
 * so a per-chart tweak made earlier must not survive it.
 */
export function clearOverridesForRun(runId: string): void {
  stores.forEach((store) => {
    [...store.keys()].forEach((seriesId) => {
      if (runIdOf(seriesId) === runId) store.delete(seriesId);
    });
  });
}

/** Is this series drawn on this chart? The single source both the line and the
 *  legend row derive from — they drifted apart when each decided separately. */
export function isSeriesVisible(
  seriesId: string | undefined,
  overrides: Map<string, boolean>,
  hiddenRunIds: Set<string> | undefined,
): boolean {
  if (!seriesId) return true;
  const override = overrides.get(seriesId);
  if (override !== undefined) return override;
  return !hiddenRunIds?.has(runIdOf(seriesId));
}

/** Subscribe to changes on `key`. The callback receives the id of the chart
 *  that made the change so it can ignore its own echo. Returns an unsubscribe. */
export function subscribeLegendHidden(
  key: string,
  cb: (origin: string) => void,
): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(cb);
  return () => {
    const live = listeners.get(key);
    if (!live) return;
    live.delete(cb);
    if (live.size === 0) listeners.delete(key);
  };
}

/** Tell every other chart on `key` that the hidden set changed. */
export function notifyLegendHidden(key: string, origin: string): void {
  listeners.get(key)?.forEach((cb) => cb(origin));
}

/**
 * Which series' hidden-state does `line` follow?
 *
 * Only a "real" series is recorded in the hidden set. Its companions — the
 * faint unsmoothed "(original)" line and the min/max envelope bands — are not,
 * so each has to resolve back to its parent.
 *
 * Companions can't be matched on seriesId: the smoothing companion is given
 * its OWN id (`val/mAP (original)` next to the parent's `val/mAP`) on the
 * individual-run page, so an id comparison silently fails there and the faint
 * original line kept drawing after its run was hidden. They do share the
 * parent's LABEL, which is what identifies the run in the legend.
 */
const ORIGINAL_SUFFIX = " (original)";

/** Index the real (non-companion) series by label, once, so owner lookup is a
 *  map hit rather than a scan. Doing it per series made this O(n^2) and hung
 *  pages with a few hundred runs. */
export function indexRealSeriesByLabel(
  lines: LegendLine[],
): Map<string, LegendLine> {
  const byLabel = new Map<string, LegendLine>();
  for (const l of lines) {
    if (isRealSeries(l) && l.label && !byLabel.has(l.label)) byLabel.set(l.label, l);
  }
  return byLabel;
}

export function ownerSeriesId(
  line: LegendLine,
  linesOrIndex: LegendLine[] | Map<string, LegendLine>,
): string | undefined {
  const byLabel = Array.isArray(linesOrIndex)
    ? indexRealSeriesByLabel(linesOrIndex)
    : linesOrIndex;
  if (line.envelopeOf) {
    const parent = byLabel.get(line.envelopeOf);
    return parent ? seriesKeyOf(parent) : undefined;
  }
  if (line.hideFromLegend) {
    // The smoothing path appends " (original)" to the parent's label
    // (see buildSeriesConfig), so strip it to find the run it belongs to.
    const parentLabel = line.label?.endsWith(ORIGINAL_SUFFIX)
      ? line.label.slice(0, -ORIGINAL_SUFFIX.length)
      : line.label;
    const parent = parentLabel ? byLabel.get(parentLabel) : undefined;
    return parent ? seriesKeyOf(parent) : undefined;
  }
  return seriesKeyOf(line);
}

function isRealSeries(l: LegendLine): boolean {
  return !l.envelopeOf && !l.hideFromLegend;
}

function seriesKeyOf(l: LegendLine): string | undefined {
  return l.seriesId ?? l.label;
}

export interface LegendLine {
  label?: string;
  seriesId?: string;
  envelopeOf?: string;
  hideFromLegend?: boolean;
}

/**
 * Bring a chart's lines AND legend rows in line with the overrides + the runs
 * table, in one pass.
 *
 * Row rules, which is where the two used to disagree:
 *   drawn                        -> row shown
 *   hidden by the runs table     -> row REMOVED, so a hidden run leaves the
 *                                   legend entirely (and the export with it)
 *   hidden only on this chart    -> row KEPT and greyed by uPlot, so it stays
 *                                   one click from coming back
 *
 * Series toggles suppress hooks so applying a remote change can't re-notify
 * and bounce back.
 */
export function applyChartVisibility(
  u: {
    series: { show?: boolean; _seriesId?: string }[];
    setSeries: (i: number, opts: { show: boolean }, fire?: boolean) => void;
  },
  lines: LegendLine[],
  overrides: Map<string, boolean>,
  hiddenRunIds: Set<string> | undefined,
  /** Called once per series with an already-resolved row list — see
   *  setLegendRowRemovedAt. Never query the DOM per series here. */
  setRowRemoved: (seriesIdx: number, removed: boolean) => void,
): boolean {
  let changed = false;
  const byLabel = indexRealSeriesByLabel(lines);
  for (let i = 1; i < u.series.length; i++) {
    const line = lines[i - 1];
    if (!line) continue;

    // Companions (the faint "(original)" line and the min/max bands) aren't
    // recorded themselves — they follow whichever run they belong to.
    const owner = ownerSeriesId(line, byLabel);
    const visible = isSeriesVisible(owner, overrides, hiddenRunIds);

    if (u.series[i].show !== visible) {
      u.setSeries(i, { show: visible }, false);
      changed = true;
    }

    // Removed only when the RUNS TABLE is what hides it. Testing for "no
    // override" instead was wrong for a run hidden in the table, un-hidden
    // here, then hidden here again: an override then exists, so the row was
    // left greyed when it should be gone, exactly as if it had never been
    // touched. Greying is for a run the table still shows, where the row is
    // the way back to it.
    setRowRemoved(i, !visible && !!owner && !!hiddenRunIds?.has(runIdOf(owner)));
  }
  return changed;
}
