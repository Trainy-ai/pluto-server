import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import LineChartUPlot, { type LineData, type LineChartUPlotRef } from "@/components/charts/line-uplot";
import { ChartLoadingSkeleton } from "@/components/charts/chart-loading-skeleton";
import { fromColumnar, type ColumnarBucketedSeries } from "@/lib/chart-data-utils";
import {
  groupFieldLabel,
} from "../runs-table/group-by-utils";
import { bucketColorFor } from "../runs-table/bucket-color";
import { useLineSettings } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/use-line-settings";
import { smoothData } from "@/lib/math/smoothing";
import { parseChTimeMs } from "@/components/charts/lib/format";
import { resolveChartBuckets } from "@/lib/chart-bucket-estimate";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useHiddenGroupPaths } from "@/hooks/use-hidden-group-paths";
import { getDashPattern } from "./metric-dash";
import { DEFAULT_MAX_GROUPS } from "@/components/charts/chart-scale-popover";

/** Phase 10 (B) — when the page has an active `groupBy`, line-chart
 *  widgets render through this component instead of <MultiLineChart>.
 *
 *  Each visible group becomes ONE line (mean) plus an envelope (min/max
 *  across the runs in the group at each bucket). Color comes from the
 *  shared `bucketColorFor(pathKey)` helper so the chart, the table
 *  bucket-header swatches, and the in-bucket runs all agree.
 *
 *  MVP scope (matches PLAN-grouping-v2-charts.md decisions):
 *  - mean + min/max band only
 *  - hidden runs excluded server-side
 *  - lineage stitching off
 *  - drag-zoom + smoothing + per-chart x-axis customization deferred to
 *    a follow-up; lands as plain `xlabel="step"` for v1
 *
 *  Tradeoff acknowledged: the existing MultiLineChart's zoom-refetch,
 *  smoothing, EMA, time x-axis, and experiments-mode segmentation are
 *  not wired here. Those are non-trivial integrations on top of the
 *  grouped data path; they ship in B-2. */

interface GroupedLineChartProps {
  organizationId: string;
  projectName: string;
  groupBy: string[];
  metrics: string[];
  /** The user's comparison — the chart aggregates ONLY over these runs.
   *  Backend filters the run universe by `id IN (selectedRunIds)`
   *  before grouping, so the "Showing N of M groups" indicator
   *  reflects the selection rather than the whole project. Empty or
   *  undefined → chart returns nothing (matches the flat chart). */
  selectedRunIds: string[];
  hiddenRunIds?: string[];
  title: string;
  subtitle?: string;
  xlabel: string;
  logXAxis?: boolean;
  logYAxis?: boolean;
  yZoomRange?: [number, number] | null;
  onYZoomRangeChange?: (range: [number, number] | null) => void;
  /** Per-widget settings selector — same key MultiLineChart uses so
   *  the Smoothing slider toggles affect grouped charts uniformly. */
  settingsRunId?: string;
  /** "step" (default) | "time" (absolute wall-clock) |
   *  "relative-time" (per-run baselined). Custom-metric-x is
   *  deferred — see PLAN-grouping-v2-charts.md. */
  xAxis?: "step" | "time" | "relative-time";
  /** Cap on the number of distinct leaf groups rendered. Backend
   *  ranks by (run count DESC, pathKey ASC) and aggregates only the
   *  top N — keeps both the SQL cost and the chart legibility
   *  bounded. Default is the backend's own default (10). */
  maxGroups?: number;
}

interface GroupedChartSeries {
  columnar: ColumnarBucketedSeries;
  /** JSON-stringified bucket trail; matches the runs-table tree pathKey. */
  pathKey: string;
}

/** Pretty label for a bucket trail — `Group: ca · batch_size: 8`. */
function labelForPath(pathKey: string): string {
  try {
    const trail = JSON.parse(pathKey) as Array<{ field: string; value: string | null }>;
    return trail
      .map((e) => `${groupFieldLabel(e.field)}: ${e.value ?? "(unset)"}`)
      .join(" · ");
  } catch {
    return pathKey;
  }
}

/** Bordered card with a header row + scrollable body, used by the
 *  truncation-banner popover for each of the dropped/no-data lists.
 *  Visual match for metric-results-list.tsx (the metric picker in
 *  add-widget) so the popover reads as part of the same design system.
 *  Items pass through `formatItem` (defaults to `labelForPath` so
 *  pathKey JSON renders as `Group: a · batch_size: 1024`); plain
 *  strings like metric names flow through the labelForPath fallback
 *  branch and render untouched. */
function GroupListCard({
  header,
  items,
  overflowMore = 0,
  testId,
  formatItem = labelForPath,
}: {
  header: string;
  items: readonly string[];
  /** When the server's hard 50-cap truncated the payload, how many more
   *  items would have been included if it hadn't. Adds an italic
   *  "…and N more" row to the bottom of the scroll body. */
  overflowMore?: number;
  testId?: string;
  formatItem?: (raw: string) => string;
}) {
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="border-b bg-muted/30 px-2.5 py-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">
          {header}
        </span>
      </div>
      <div
        className="max-h-[72px] overflow-y-auto overflow-x-hidden"
        data-testid={testId}
      >
        {items.map((raw) => {
          const label = formatItem(raw);
          return (
            // Each row has its own Tooltip with a short delay so the
            // full label appears almost instantly on hover for the
            // truncated rows. Native `title=` was used before but its
            // ~700ms default delay was noticeably sluggish.
            <Tooltip key={raw} delayDuration={100}>
              <TooltipTrigger asChild>
                <div className="truncate px-2.5 py-0.5 text-xs hover:bg-accent/50">
                  {label}
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[400px] break-words">
                {label}
              </TooltipContent>
            </Tooltip>
          );
        })}
        {overflowMore > 0 && (
          <div className="px-2.5 py-0.5 text-xs italic text-muted-foreground">
            …and {overflowMore} more
          </div>
        )}
      </div>
    </div>
  );
}

export function GroupedLineChart({
  organizationId,
  projectName,
  groupBy,
  metrics,
  selectedRunIds,
  hiddenRunIds,
  title,
  subtitle,
  xlabel,
  logXAxis,
  logYAxis,
  yZoomRange,
  onYZoomRangeChange,
  settingsRunId,
  xAxis,
  maxGroups,
}: GroupedLineChartProps) {
  // Fall back to the workspace Line Settings selectedLog when no
  // explicit xAxis is passed. Matches MultiLineChart's
  // `xAxisOverride ?? settings.selectedLog` behaviour so the global
  // Line Settings x-axis switcher affects grouped charts identically.
  // `settings` is read below.
  // (placeholder — actual resolution happens after `settings` is
  // initialised, see below.)
  const { settings } = useLineSettings(organizationId, projectName, settingsRunId ?? "full");
  const smoothingActive = settings.smoothing.enabled;
  // Match flat-chart bucket sizing so unzoomed grouped density tracks
  // the user's resolution setting. Previously the grouped query sent
  // no `buckets` and fell back to the server's DEFAULT_BUCKETS=1000,
  // which made grouped charts denser than flat ones (1/5 vs 1/25 on a
  // 5000-step seed at "auto"). Now both honour the same setting.
  const standardBuckets = useMemo(
    () => resolveChartBuckets(settings.chartResolution, settings.smoothing.enabled),
    [settings.chartResolution, settings.smoothing.enabled],
  );

  // Resolve the effective x-axis. Order of precedence:
  //   1. Explicit `xAxis` prop (set by ChartWidget from
  //      ChartWidgetConfig.xAxis).
  //   2. The workspace Line Settings `selectedLog` — same fallback
  //      MultiLineChart uses, so the gear-popover x-axis switcher
  //      affects both flat and grouped charts.
  // Unknown values (e.g. a custom metric name) fall back to "step"
  // — custom-metric x-axis is deferred in grouped mode per
  // PLAN-grouping-v2-charts.md.
  const effectiveXAxis: "step" | "time" | "relative-time" =
    xAxis !== undefined
      ? xAxis
      : settings.selectedLog === "Absolute Time"
        ? "time"
        : settings.selectedLog === "Relative Time"
          ? "relative-time"
          : "step";
  const isAbsoluteTime = effectiveXAxis === "time";
  const isRelativeTime = effectiveXAxis === "relative-time";

  // Drag-to-zoom support. When the user selects a step range we fire
  // a second high-resolution query against that window and prefer
  // those buckets over the base query's data. Mirrors what
  // useZoomRefetch does for flat charts — finer buckets inside the
  // zoomed range without re-fetching the whole series.
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null);
  const onZoomRangeChangeInternal = useCallback(
    (range: [number, number] | null) => {
      setZoomRange(range);
    },
    [],
  );

  // ---- Double-click-to-reset fix for grouped charts ----
  // The chart-lifecycle dblclick handler calls `resetXScale(chart,
  // currentData)` BEFORE React clears zoomRange and the base-data
  // re-fetch lands. `currentData` at that moment is the high-res
  // ZOOM query's data, so the "reset" snaps the scale back to the
  // zoomed range — looks like dblclick did nothing.
  // Fix: watch zoomRange transitions; when it flips from non-null
  // to null, wait one frame (long enough for LineChartUPlot's
  // data-effect to setData the base data into uPlot) and then
  // explicitly setScale("x") to the new data's full extent.
  const chartHandleRef = useRef<LineChartUPlotRef>(null);
  const prevZoomRangeRef = useRef<[number, number] | null>(null);
  useEffect(() => {
    const wasZoomed = prevZoomRangeRef.current != null;
    prevZoomRangeRef.current = zoomRange;
    if (!wasZoomed || zoomRange != null) return;
    const raf = requestAnimationFrame(() => {
      const chart = chartHandleRef.current?.getChart();
      if (!chart) return;
      const xs = chart.data?.[0] as number[] | undefined;
      if (!xs || xs.length === 0) return;
      try {
        chart.setScale("x", { min: xs[0], max: xs[xs.length - 1] });
      } catch {
        // Chart may have been destroyed mid-frame.
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [zoomRange]);

  // Hidden bucket pathKeys — fed by the eye-icon on bucket header
  // rows. Sorted+deduped before sending so the input is stable and
  // doesn't bust the React Query cache key on every render.
  const hiddenGroupPathsSet = useHiddenGroupPaths(projectName);
  const hiddenGroupPaths = useMemo(
    () => (hiddenGroupPathsSet.size > 0 ? Array.from(hiddenGroupPathsSet).sort() : undefined),
    [hiddenGroupPathsSet],
  );

  // Base query: full range, bucket count from user resolution setting.
  // `keepPreviousData` keeps the OLD response visible while the new one
  // streams in whenever an input (hiddenGroupPaths, hiddenRunIds,
  // maxGroups, …) changes. Without it, the query key change is treated
  // as a fresh query, query.data goes undefined, and the chart flashes
  // its "Loading grouped chart…" placeholder until the new response
  // resolves. Flat charts already get this behaviour by default
  // because their cache covers the new key too — grouped queries are
  // input-heavier so the key changes more often.
  const query = useQuery({
    ...trpc.runs.data.graphMultiMetricBatchBucketedGrouped.queryOptions({
      organizationId,
      projectName,
      groupBy,
      logNames: metrics,
      selectedRunIds,
      hiddenRunIds: hiddenRunIds && hiddenRunIds.length > 0 ? hiddenRunIds : undefined,
      hiddenGroupPaths,
      buckets: standardBuckets,
      xAxis: effectiveXAxis,
      maxGroups,
    }),
    placeholderData: keepPreviousData,
    // Evict the cache as soon as the chart unmounts (no `gcTime` →
    // TanStack default = 5 min). Mirrors the flat chart's GC_TIME = 0
    // so VirtualizedChart's unmount/remount on scroll actually
    // round-trips back to the server (with the loading skeleton
    // flashing in between) instead of silently re-rendering from the
    // 5-min cache and looking like the chart never left the viewport.
    gcTime: 0,
  });

  // Zoom query: only fires when zoomed; same params + stepMin/stepMax.
  // Adaptive bucket count: ask for one bucket per step in the zoomed
  // window, capped at the server's hard max (3000). With the seed
  // running at 1 metric/step this guarantees per-step resolution as
  // long as the zoom range is <= 3000 steps; tighter zooms always
  // surface every step. NOTE: stepMin/stepMax are step-only; in time
  // / relative-time modes the step bounds don't translate to a time
  // window so the zoom query stays disabled until we add timeMin /
  // timeMax bounds.
  // uPlot's drag-zoom produces fractional pixel-derived xMin/xMax. The
  // server's Zod schema rejects floats for buckets / stepMin / stepMax,
  // so floor/ceil to ints — widens the window slightly which is the
  // safe direction (don't accidentally drop the boundary steps).
  const zoomStepMin = zoomRange ? Math.floor(zoomRange[0]) : undefined;
  const zoomStepMax = zoomRange ? Math.ceil(zoomRange[1]) : undefined;
  const zoomBuckets =
    zoomStepMin != null && zoomStepMax != null
      ? Math.min(3000, Math.max(10, zoomStepMax - zoomStepMin + 1))
      : undefined;
  const zoomEnabled = zoomRange != null && effectiveXAxis === "step";
  const zoomQuery = useQuery({
    ...trpc.runs.data.graphMultiMetricBatchBucketedGrouped.queryOptions({
      organizationId,
      projectName,
      groupBy,
      logNames: metrics,
      selectedRunIds,
      hiddenRunIds: hiddenRunIds && hiddenRunIds.length > 0 ? hiddenRunIds : undefined,
      hiddenGroupPaths,
      stepMin: zoomStepMin,
      stepMax: zoomStepMax,
      buckets: zoomBuckets,
      xAxis: effectiveXAxis,
      maxGroups,
    }),
    enabled: zoomEnabled,
    // Same rationale as the base query above.
    placeholderData: keepPreviousData,
    gcTime: 0,
  });

  // Phase 10-D wraps the response as `{ buckets, totalGroupCount }`.
  // Read both fields here so the truncation subtitle below
  // ("Showing first N of M groups") can compare visible vs total.
  // The wrap field is named `buckets` rather than `data` so it
  // doesn't collide with the tRPC streaming-protocol path key
  // `result.data` (same-named keys at adjacent tree levels confuse
  // the JSONL frame assembler).
  const totalGroupCount = (query.data as { totalGroupCount?: number } | undefined)?.totalGroupCount;
  // pathKeys of groups the backend's maxGroups cap excluded. Empty when
  // the cap didn't fire. Capped server-side at 50; we show the first
  // few in the truncation-banner tooltip + "and M more" tag if any
  // overflow.
  const droppedGroupKeys =
    (query.data as { droppedGroupKeys?: string[] } | undefined)?.droppedGroupKeys ?? [];
  // Per-metric: groups the cap KEPT but ClickHouse returned no rows for
  // under that logName. The metric-availability cousin of
  // droppedGroupKeys — surfaced in the data-limited branch of the
  // tooltip.
  const noDataByLogName =
    (query.data as { noDataByLogName?: Record<string, string[]> } | undefined)?.noDataByLogName ?? {};
  // Split groups missing at least one metric into two buckets so the
  // user can tell "I'll see this group on the chart but with fewer
  // lines" apart from "this group is completely absent":
  //   - partialGroupKeys: missing some metrics, has data for at least
  //     one → still drawn for the metrics that DO have data
  //   - fullyMissingGroupKeys: missing EVERY metric on this chart →
  //     contributes zero lines, won't appear on the chart at all
  // Each is deduped within its bucket. For single-metric charts every
  // entry naturally lands in fullyMissingGroupKeys (the one metric IS
  // every metric), so partial is empty and the UI collapses to a
  // single "missing this metric" card.
  const { partialGroupKeys, fullyMissingGroupKeys } = (() => {
    const missingCountByGroup = new Map<string, number>();
    for (const m of metrics) {
      for (const k of noDataByLogName[m] ?? []) {
        missingCountByGroup.set(k, (missingCountByGroup.get(k) ?? 0) + 1);
      }
    }
    const partial: string[] = [];
    const fully: string[] = [];
    for (const [k, count] of missingCountByGroup) {
      if (count >= metrics.length) fully.push(k);
      else partial.push(k);
    }
    return { partialGroupKeys: partial, fullyMissingGroupKeys: fully };
  })();

  const lines = useMemo<LineData[]>(() => {
    const baseData = ((query.data as { buckets?: Record<string, Record<string, ColumnarBucketedSeries>> } | undefined)?.buckets ?? {}) as Record<
      string,
      Record<string, ColumnarBucketedSeries>
    >;
    // When zoomed, prefer the high-res buckets for any
    // (logName, groupKey) the zoom query produced; fall through to
    // the base buckets for keys the zoom query happens to not cover
    // (e.g. groups whose runs have no metrics in the zoomed window).
    // Important: ONLY read zoom data when zoom is ACTIVE — otherwise
    // `placeholderData: keepPreviousData` makes `zoomQuery.data`
    // still return the LAST zoom response after the user dblclicks
    // to unzoom, which left the chart frozen at the zoomed extents.
    const zoomData = (zoomRange != null
      ? ((zoomQuery.data as { buckets?: Record<string, Record<string, ColumnarBucketedSeries>> } | undefined)?.buckets ?? {})
      : {}) as Record<string, Record<string, ColumnarBucketedSeries>>;
    const data: typeof baseData = {};
    const allLogNames = new Set([...Object.keys(baseData), ...Object.keys(zoomData)]);
    for (const ln of allLogNames) {
      const merged: Record<string, ColumnarBucketedSeries> = {};
      const baseByGroup = baseData[ln] ?? {};
      const zoomByGroup = zoomData[ln] ?? {};
      for (const k of new Set([...Object.keys(baseByGroup), ...Object.keys(zoomByGroup)])) {
        merged[k] = zoomByGroup[k] ?? baseByGroup[k];
      }
      data[ln] = merged;
    }
    const out: LineData[] = [];
    const isMultiMetric = metrics.length > 1;

    for (const [metricIndex, metricName] of metrics.entries()) {
      const byGroup = data[metricName];
      if (!byGroup) continue;

      const groups: GroupedChartSeries[] = Object.entries(byGroup).map(
        ([pathKey, columnar]) => ({ pathKey, columnar }),
      );

      for (const { pathKey, columnar } of groups) {
        const points = fromColumnar(columnar);
        if (points.length === 0) continue;
        // X-axis extraction varies by mode:
        // - step / relative-time: step field carries the x-value
        //   (training step in step mode; bucket-start relative ms in
        //   relative-time mode — backend encodes it there).
        // - time (absolute): parse the DateTime64 `time` field into
        //   ms-since-epoch for uPlot's isDateTime axis.
        const sorted = isAbsoluteTime
          ? [...points].sort((a, b) => parseChTimeMs(a.time) - parseChTimeMs(b.time))
          : [...points].sort((a, b) => a.step - b.step);
        const xs = isAbsoluteTime
          ? sorted.map((p) => parseChTimeMs(p.time))
          : isRelativeTime
            ? sorted.map((p) => p.step / 1000) // ms → seconds
            : sorted.map((p) => p.step);
        const groupLabel = labelForPath(pathKey);
        const seriesLabel = isMultiMetric
          ? `${groupLabel} · ${metricName}`
          : groupLabel;
        const color = bucketColorFor(pathKey);
        // Max contributing-run count across buckets — answers "how
        // reliable is this aggregate" at a glance. We use the max
        // rather than the per-step count because sparse logging
        // produces noisy fluctuations; the user cares about how many
        // runs the bucket COULD have, not how many happened to log
        // at the exact hovered step.
        let maxContributingRuns = 0;
        for (const p of sorted) {
          if (p.count > maxContributingRuns) maxContributingRuns = p.count;
        }
        const runCountLabel = `${maxContributingRuns} run${maxContributingRuns === 1 ? "" : "s"}`;
        // Mean line. Smoothing applies ONLY to this series — bands
        // stay as raw min/max envelopes per the locked decision (#2
        // in PLAN-grouping-v2-charts.md). null bucket values
        // collapse to 0 inside the smoother since smoothData
        // requires numeric inputs; they were already 0 in the raw
        // backend response (see sanitizeBucketedRows on the server).
        const rawMean = sorted.map((p) => (p.value == null ? 0 : p.value));
        const ys =
          smoothingActive && rawMean.length > 1
            ? smoothData(xs, rawMean, settings.smoothing.algorithm, settings.smoothing.parameter)
            : sorted.map((p) => p.value);
        out.push({
          x: xs,
          y: ys,
          label: seriesLabel,
          seriesId: `${pathKey}:${metricName}`,
          color,
          // Grouped multi-metric: color encodes the GROUP (bucketColorFor),
          // dash encodes the METRIC — same per-metric pattern the ungrouped
          // chart uses (metric 0 = solid). Single-metric charts get index 0 =
          // solid, so this is a no-op there. Bands stay solid (envelope fill).
          dash: getDashPattern(metricIndex),
          // For grouped lines we used to put the bucket's run count
          // ("3 runs") in `runId` so the tooltip's DISPLAY ID column
          // surfaced it. The fullscreen-legend sidebar reads
          // `runId || runName || label` as the row label, though, so
          // the sidebar ended up showing rows of "3 runs : 0.14",
          // "2 runs : 0.42" — useless when every row shared similar
          // run counts. Swap: put the descriptive bucket label in
          // `runId` so the sidebar names the group, and move the run
          // count into `runName` (the tooltip's RUN NAME column,
          // which now reads "1 run" / "2 runs" — still informative,
          // just no longer the primary identifier).
          runId: groupLabel,
          runName: runCountLabel,
          metricName,
        });
        // Envelope: min/max boundaries. `envelopeOf` wires them to the
        // main series via line-uplot's buildBandsConfig — same code
        // path the per-run min/max band uses today.
        out.push({
          x: xs,
          y: sorted.map((p) => p.minY),
          label: `${seriesLabel} (min)`,
          seriesId: `${pathKey}:${metricName}:min`,
          color,
          envelopeOf: seriesLabel,
          envelopeBound: "min",
          hideFromLegend: true,
        });
        out.push({
          x: xs,
          y: sorted.map((p) => p.maxY),
          label: `${seriesLabel} (max)`,
          seriesId: `${pathKey}:${metricName}:max`,
          color,
          envelopeOf: seriesLabel,
          envelopeBound: "max",
          hideFromLegend: true,
        });
      }
    }
    return out;
  }, [query.data, zoomQuery.data, zoomRange, metrics, smoothingActive, settings.smoothing.algorithm, settings.smoothing.parameter, isAbsoluteTime, isRelativeTime]);

  // Guard against re-labelling STALE data during an x-axis mode switch.
  // `keepPreviousData` keeps the previous response visible while the new query
  // (different `xAxis` key) is in flight, but the memo above parses X using the
  // NEW mode — so step↔time switching would briefly draw the old bucket rows on
  // the wrong axis. Track the axis the resolved data belongs to and, while
  // showing placeholder data for a different mode, fall back to the loading
  // skeleton instead of a misleading chart.
  const dataXAxisRef = useRef(effectiveXAxis);
  useEffect(() => {
    if (!query.isPlaceholderData) dataXAxisRef.current = effectiveXAxis;
  }, [query.isPlaceholderData, effectiveXAxis]);
  const staleAxisData =
    query.isPlaceholderData && dataXAxisRef.current !== effectiveXAxis;

  // Show the loading placeholder until the base query has actually
  // RESOLVED. React Query v5 has separate `status` ("pending"|"success"
  // |"error") and `isLoading` (= isPending && isFetching) — relying on
  // `isLoading` alone produces a false-negative window where the query
  // is pending but not yet fetching, during which `lines` is empty and
  // the chart wrongly flashed "No data for this grouping". Treat
  // anything that isn't `success` with data as still loading. Uses
  // the same skeleton (gray panel + title + spinner) as the flat
  // <MultiLineChart> so grouped/non-grouped don't look different on
  // first paint; pills are omitted because the group set isn't
  // resolved before the query lands.
  const hasResolvedData =
    query.status === "success" && !!query.data && !staleAxisData;
  if (!hasResolvedData) {
    return <ChartLoadingSkeleton title={title} />;
  }
  if (lines.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No data for this grouping.
      </div>
    );
  }

  // Truncation notice — wandb-style "Showing first N of M groups"
  // plus a pointer to where the user can change it. Shown whenever
  // the chart isn't drawing every group in the universe.
  //
  // Two distinct numbers matter, and they used to be conflated:
  //   - visibleGroupCount: actual mean lines drawn (groups that have
  //     data for THIS metric)
  //   - cappedGroupCount: groups the backend selected after applying
  //     the maxGroups cap = min(maxGroups, totalGroupCount)
  // visible < capped happens when some of the picked groups don't log
  // this metric. Without distinguishing the two, raising the cap from
  // 8 → 10 looked like "the graph didn't update" if both numbers had
  // the same visible count — the chart actually refetched and asked
  // for 10 groups, the user just couldn't see any difference because
  // the new additions had no data for that metric.
  //
  // Banner now reads:
  //   "Showing {visible} of {capped} ({total} total groups)"
  // — the {capped} half tracks the user's Max Groups setting so a
  // change is immediately visible; the {visible} half stays honest
  // about how many lines are actually drawn.
  // Count DISTINCT groups that have at least one line on the chart, not
  // total line count. For multi-metric charts the old `lines / metrics`
  // average produced fractional values (e.g. "7.8 of 10 largest") when
  // different metrics had different visible-group counts. A group is
  // "visible" if any of its mean series rendered; we dedupe on the
  // group label.
  //
  // The dedup key is `runId` (which holds the pretty group label —
  // see the swap rationale where lines are pushed around L482). Was
  // `runName ?? label`, but `runName` now holds the run-count label
  // ("4 runs") — multiple groups with the same run count would
  // collapse to one entry, undercounting visible groups. E.g. 3
  // groups × 4 runs each → "Showing 1 of 3" while 3 lines were
  // clearly drawn.
  const visibleGroupCount = (() => {
    const seen = new Set<string>();
    for (const l of lines) {
      if (l.envelopeOf || l.hideFromLegend) continue;
      const key = l.runId ?? l.label;
      if (key) seen.add(key);
    }
    return seen.size;
  })();
  const effectiveMaxGroups = maxGroups ?? DEFAULT_MAX_GROUPS;
  const cappedGroupCount =
    totalGroupCount !== undefined
      ? Math.min(effectiveMaxGroups, totalGroupCount)
      : visibleGroupCount;
  const someGroupsLackData = visibleGroupCount < cappedGroupCount;
  // The banner shows whenever the chart's representation isn't a clean
  // "all selected groups, all metrics" — that includes any of:
  //   - the cap actually dropped some groups
  //   - some capped groups have no data for any metric (fully missing)
  //   - some capped groups have data for SOME but not all metrics
  //     (partial — only meaningful on multi-metric charts)
  const truncated =
    totalGroupCount !== undefined &&
    (cappedGroupCount < totalGroupCount ||
      someGroupsLackData ||
      partialGroupKeys.length > 0);

  return (
    // Flex column: optional truncation banner at top, chart fills the
    // rest. Reserving real layout space (rather than absolute-
    // positioning over the canvas) means uPlot's title + chart grid
    // get rendered BELOW the banner instead of underneath it — fixes
    // the visual overlap with the top gridline that the previous
    // absolute layout produced.
    <div className="flex h-full w-full flex-col">
      {truncated && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="shrink-0 cursor-pointer text-center text-[11px] text-muted-foreground pt-1 hover:underline w-full"
              data-testid="grouped-truncation-banner"
            >
              {/* Per .github/GROUPING_V2_PR_NOTES.md vocab rules:
                  multi-level grouping uses "leaf groups" for the
                  innermost level (what each chart series represents);
                  single-level grouping just calls them "groups". */}
              {(() => {
                const noun = groupBy.length >= 2 ? "leaf groups" : "groups";
                return someGroupsLackData
                  ? `Showing ${visibleGroupCount} of ${cappedGroupCount} largest (of ${totalGroupCount} total selected ${noun})`
                  : `Showing ${cappedGroupCount} largest (of ${totalGroupCount} total selected ${noun})`;
              })()}
            </button>
          </PopoverTrigger>
          {/* Popover instead of Tooltip — click to lock open so the
              user can interact with the scrollable lists below. Each
              list lives in a bordered card (matching the
              metric-results-list style from add-widget) with a header
              row + fixed-height scroll body so the popover height
              stays bounded regardless of selection size. */}
          <PopoverContent side="bottom" className="max-w-[420px] text-left text-xs">
            <div className="space-y-3">
              {/* "leaf groups" at depth ≥ 2 — each chart series
                  corresponds to one leaf bucket. Single-level
                  grouping just uses "groups". */}
              {(() => {
                const noun = groupBy.length >= 2 ? "leaf groups" : "groups";
                return (
              <p>
                {someGroupsLackData ? (
                  metrics.length > 1 ? (
                    <>
                      The {cappedGroupCount} {noun} with the most runs are
                      selected. {visibleGroupCount} appear on this chart;
                      the other {cappedGroupCount - visibleGroupCount}{" "}
                      never logged any of the chart&apos;s metrics. See
                      the lists below for details. Click the settings
                      icon to raise the cap.
                    </>
                  ) : (
                    <>
                      The {cappedGroupCount} {noun} with the most runs are
                      selected, but only {visibleGroupCount} have data for{" "}
                      {metrics[0]}. The remaining{" "}
                      {cappedGroupCount - visibleGroupCount} aren&apos;t
                      plotted because their runs never logged this metric.
                      Click the settings icon to raise the cap.
                    </>
                  )
                ) : (
                  <>
                    The {cappedGroupCount} {noun} with the most runs are
                    plotted (ties broken alphabetically). Click the settings
                    icon at the top right of this chart to raise the cap.
                  </>
                )}
              </p>
                );
              })()}

              {metrics.length > 1 && (
                <GroupListCard
                  testId="grouped-tooltip-metrics-list"
                  header={`Metrics on this chart (${metrics.length})`}
                  items={metrics}
                  formatItem={(m) => m}
                />
              )}

              {partialGroupKeys.length > 0 && (
                <GroupListCard
                  testId="grouped-tooltip-partial-list"
                  header={`Partial data — missing some metrics (${partialGroupKeys.length})`}
                  items={partialGroupKeys}
                />
              )}

              {fullyMissingGroupKeys.length > 0 && (
                <GroupListCard
                  testId="grouped-tooltip-nodata-list"
                  header={
                    metrics.length > 1
                      ? `Not drawn — missing every metric on this chart (${fullyMissingGroupKeys.length})`
                      : `In the cap but missing this metric (${fullyMissingGroupKeys.length})`
                  }
                  items={fullyMissingGroupKeys}
                />
              )}

              {droppedGroupKeys.length > 0 && (
                <GroupListCard
                  testId="grouped-tooltip-dropped-list"
                  header={
                    totalGroupCount !== undefined
                      ? `Selected but not in the cap (${totalGroupCount - cappedGroupCount})`
                      : `Selected but not in the cap (${droppedGroupKeys.length}+)`
                  }
                  items={droppedGroupKeys}
                  overflowMore={
                    totalGroupCount !== undefined
                      ? totalGroupCount - cappedGroupCount - droppedGroupKeys.length
                      : 0
                  }
                />
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
      <div className="relative min-h-0 flex-1">
      <LineChartUPlot
        ref={chartHandleRef}
        lines={lines}
        title={title}
        subtitle={subtitle}
        // Relative-time x-axis shows raw seconds since the run's own
        // baseline (e.g. "0", "300", "1800") — duration formatter
        // can be wired later. Absolute time uses DateTime axis.
        xlabel={isRelativeTime ? "time (s)" : xlabel}
        isDateTime={isAbsoluteTime}
        logXAxis={logXAxis}
        logYAxis={logYAxis}
        yZoomRange={yZoomRange}
        onYZoomRangeChange={onYZoomRangeChange}
        // Drag-zoom triggers our zoom-refetch above (high-res
        // buckets inside the selected window).
        onZoomRangeChange={onZoomRangeChangeInternal}
        // Required for fullscreen — ChartFullscreenDialog polls
        // uPlot's `.u-legend` and relocates it into the right-hand
        // sidebar. With showLegend off, uPlot never creates
        // `.u-legend` so the sidebar would be permanently empty and
        // only the divider would show.
        showLegend={true}
      />
      </div>
    </div>
  );
}
