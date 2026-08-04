// ============================
// Chart-local hidden series — shared across the inline ⇄ fullscreen boundary
// ============================
//
// Switching a series off from the tooltip or by clicking its legend row is a
// CHART-LOCAL hide: it affects only that chart, unlike the runs-table eye
// which hides a run everywhere. That state lived in a `useRef` inside
// LineUplot, which made it per-component.
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

const stores = new Map<string, Set<string>>();

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
export function getLegendHiddenStore(key: string): Set<string> {
  let store = stores.get(key);
  if (!store) {
    store = new Set<string>();
    stores.set(key, store);
  }
  return store;
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

export function ownerSeriesId(
  line: LegendLine,
  lines: LegendLine[],
): string | undefined {
  if (line.envelopeOf) {
    const parent = lines.find((l) => isRealSeries(l) && l.label === line.envelopeOf);
    return parent ? seriesKeyOf(parent) : undefined;
  }
  if (line.hideFromLegend) {
    // The smoothing path appends " (original)" to the parent's label
    // (see buildSeriesConfig), so strip it to find the run it belongs to.
    const parentLabel = line.label?.endsWith(ORIGINAL_SUFFIX)
      ? line.label.slice(0, -ORIGINAL_SUFFIX.length)
      : line.label;
    const parent = lines.find((l) => isRealSeries(l) && l.label === parentLabel);
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
 * Bring `u` in line with `hidden`.
 *
 * Toggles with hooks suppressed so applying a remote change can't re-notify
 * and bounce back.
 */
export function applyLegendHidden(
  u: {
    series: { show?: boolean }[];
    setSeries: (i: number, opts: { show: boolean }, fire?: boolean) => void;
  },
  lines: LegendLine[],
  hidden: Set<string>,
): boolean {
  let changed = false;
  for (let i = 1; i < u.series.length; i++) {
    const line = lines[i - 1];
    if (!line) continue;
    const owner = ownerSeriesId(line, lines);
    const shouldHide = !!owner && hidden.has(owner);
    if (u.series[i].show === shouldHide) {
      u.setSeries(i, { show: !shouldHide }, false);
      changed = true;
    }
  }
  return changed;
}
