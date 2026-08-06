import React, {
  useRef,
  useEffect,
  useMemo,
  forwardRef,
  useImperativeHandle,
  useId,
} from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { useTheme } from "@/lib/hooks/use-theme";
import { cn } from "@/lib/utils";
import { useChartSyncContext, applySeriesHighlight } from "./context/chart-sync-context";
import { useChartLineWidth } from "@/lib/hooks/use-chart-line-width";
import { createPortal } from "react-dom";

// Extracted modules
import { formatAxisLabel, formatRelativeTimeValue, smartDateFormatter } from "./lib/format";
import { arrayMin, arrayMax, filterDataForLogScale, alignDataForUPlot } from "./lib/data-processing";
import { tooltipPlugin, type HoverState } from "./lib/tooltip-plugin";
import { buildSeriesConfig } from "./lib/series-config";
import { buildFocusDetectionHook, buildInterpolationDotsHook } from "./lib/cursor-hooks";
import { buildScalesConfig, buildCursorConfig } from "./lib/scales-config";
import { buildAxesConfig } from "./lib/axes-config";
import { buildBandsConfig } from "./lib/bands-config";
import { buildDrawHook } from "./lib/draw-hook";
import { buildSetScaleHook, buildSetSelectHook } from "./lib/set-scale-hook";
import { nonFiniteMarkersPlugin } from "./lib/non-finite-markers-plugin";
import { forkStepPlugin } from "./lib/fork-step-plugin";
import { useContainerSize } from "./hooks/use-container-size";
import { useChartLifecycle } from "./hooks/use-chart-lifecycle";
import { useZoomSync } from "./hooks/use-zoom-sync";
import { useYRange } from "./hooks/use-y-range";

// Re-export types from lib/types
export type { LineData, LineChartUPlotRef } from "./lib/types";
import type { LineChartUPlotRef, LineChartProps } from "./lib/types";
import {
  setRunLegendRowHidden,
  getLegendRowList,
  setLegendRowRemovedAt,
} from "./lib/legend-visibility";
import {
  getLegendHiddenStore,
  legendHiddenKey,
  subscribeLegendHidden,
  notifyLegendHidden,
  applyChartVisibility,
  retainLegendHiddenStore,
  releaseLegendHiddenStore,
  runIdOf,
} from "./lib/legend-hidden-store";
import { DEFAULT_SYNC_KEY } from "./lib/types";


// ============================
// Chart title with hover tooltip (avoids Radix TooltipProvider per chart)
// ============================

const ChartTitle = React.memo(function ChartTitle({
  title,
  theme,
}: {
  title: string;
  theme: string;
}) {
  const [tooltipPos, setTooltipPos] = React.useState<{ x: number; y: number } | null>(null);
  const titleRef = useRef<HTMLDivElement>(null);

  const handlePointerEnter = React.useCallback(() => {
    const el = titleRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) { return; }
    const rect = el.getBoundingClientRect();
    setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top });
  }, []);

  const handlePointerLeave = React.useCallback(() => {
    setTooltipPos(null);
  }, []);

  return (
    <>
      <div
        ref={titleRef}
        data-testid="chart-title"
        className="relative z-10 shrink-0 truncate text-center font-mono text-xs px-1"
        style={{ color: theme === "dark" ? "#fff" : "#000" }}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        {title}
      </div>
      {tooltipPos &&
        createPortal(
          <div
            className="pointer-events-none fixed z-50 max-w-sm -translate-x-1/2 -translate-y-full rounded-md bg-muted px-3 py-1.5 text-xs break-all font-mono text-muted-foreground"
            style={{ left: tooltipPos.x, top: tooltipPos.y - 4 }}
          >
            {title}
          </div>,
          document.body,
        )}
    </>
  );
});


// ============================
// Main Component
// ============================

const LineChartUPlotInner = forwardRef<LineChartUPlotRef, LineChartProps>(
  (
    {
      lines,
      isDateTime = false,
      logXAxis = false,
      logYAxis = false,
      xlabel,
      ylabel,
      title,
      subtitle,
      showXAxis = true,
      showYAxis = true,
      showLegend = false,
      syncKey,
      tooltipInterpolation = "none",
      onZoomRangeChange,
      outlierDetection = false,
      spanGaps = true,
      yZoom = true,
      yZoomRange,
      onYZoomRangeChange,
      forkSteps,
      extraLeftPadding,
      extraRightPadding,
      yCategories,
      stepped,
      legendStateKey,
      className,
      ...rest
    },
    ref
  ) => {
    const { resolvedTheme: theme } = useTheme();
    const { lineWidth: chartLineWidth } = useChartLineWidth();
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<uPlot | null>(null);
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const hoverStateRef = useRef<HoverState>({
      isHovering: false, isPinned: false,
      lastIdx: null, lastLeft: null, lastTop: null,
    });
    const { width, height } = useContainerSize(chartContainerRef);
    const chartId = useId();

    // Chart sync context
    const chartSyncContext = useChartSyncContext();
    const chartSyncContextRef = useRef(chartSyncContext);
    useEffect(() => { chartSyncContextRef.current = chartSyncContext; }, [chartSyncContext]);

    const isRelativeTime = xlabel === "relative time";
    const zoomGroup = isRelativeTime ? "relative-time" : (xlabel || "default");

    // Emphasis tracking refs
    const lastFocusedSeriesRef = useRef<number | null>(null);
    const crossChartRunIdRef = useRef<string | null>(null);
    const localTableHighlightRef = useRef<string | null>(null);
    const tableHighlightRef = chartSyncContext?.tableHighlightedSeriesRef ?? localTableHighlightRef;
    const highlightedSeriesRef = useRef<string | null>(null);
    // Ref for tooltip to access highlighted run ID for row matching
    const highlightedRunIdRef = useRef<string | null>(null);
    // Ref for tooltip to access highlighted series ID for exact series matching
    const highlightedSeriesIdRef = useRef<string | null>(null);

    // Stable refs for callbacks
    const chartLineWidthRef = useRef(chartLineWidth);
    chartLineWidthRef.current = chartLineWidth;
    const spanGapsRef = useRef(spanGaps);
    spanGapsRef.current = spanGaps;

    const processedLinesRef = useRef<typeof lines>([]);
    const chartInstanceRef = useRef<uPlot | null>(null);

    const onZoomRangeChangeRef = useRef(onZoomRangeChange);
    onZoomRangeChangeRef.current = onZoomRangeChange;
    const zoomRangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const effectiveSyncKey = chartSyncContext?.syncKey ?? syncKey ?? DEFAULT_SYNC_KEY;

    // Chart-local hidden series (tooltip / legend-row toggles), persisted
    // across chart recreations AND across the inline ⇄ fullscreen boundary.
    // Fullscreen mounts a SEPARATE LineUplot, so a per-component ref would
    // start empty there and the series would reappear. Assigned during render
    // so the store is correct before any effect reads it.
    const legendHiddenSeriesRef = useRef<Map<string, boolean>>(new Map());
    const legendHiddenKeyRef = useRef<string>("");
    legendHiddenKeyRef.current = legendHiddenKey(
      effectiveSyncKey,
      title,
      legendStateKey,
    );
    legendHiddenSeriesRef.current = getLegendHiddenStore(
      legendHiddenKeyRef.current,
    );
    // Expose the key on the instance so the sync context can read this chart's
    // overrides when the runs-table eye changes.
    if (chartRef.current) {
      (chartRef.current as any)._legendHiddenKey = legendHiddenKeyRef.current;
    }

    // Hold the shared store while this chart is mounted so it can be dropped
    // once nothing is using the key.
    useEffect(() => {
      const key = legendHiddenKeyRef.current;
      retainLegendHiddenStore(key);
      return () => releaseLegendHiddenStore(key);
    }, [effectiveSyncKey, title, legendStateKey]);

    // Re-apply the shared hidden set when the OTHER render of this chart
    // (inline ⇄ fullscreen) toggles a series. Both share one Set, but the set
    // is only read when a chart is created — entering fullscreen creates a
    // chart so it picked changes up, while leaving fullscreen does not
    // recreate the inline chart, so toggles made in fullscreen were lost.
    useEffect(() => {
      const key = legendHiddenKeyRef.current;
      return subscribeLegendHidden(key, (origin) => {
        if (origin === chartId) return;
        const u = chartRef.current ?? chartInstanceRef.current;
        if (!u) return;
        let changed = false;
        const rows = getLegendRowList(u);
        u.batch(() => {
          changed = applyChartVisibility(
            u as never,
            processedLinesRef.current,
            getLegendHiddenStore(key),
            chartSyncContextRef.current?.hiddenRunIdsRef?.current,
            (idx, removed) => setLegendRowRemovedAt(rows, idx, removed),
          );
        });
        if (changed) {
          // applyChartVisibility suppresses uPlot's setSeries hooks, so this
          // render does not get the axis refit that the toggling render got
          // from the hook. Do it here or the twin keeps the old range.
          (u as any)._forceYRecalc?.();
          u.redraw();
        }
      });
    }, [effectiveSyncKey, title, legendStateKey, chartId]);

    // Process data for log scales
    const processedLines = useMemo(
      () => filterDataForLogScale(lines, logXAxis, logYAxis),
      [lines, logXAxis, logYAxis]
    );
    processedLinesRef.current = processedLines;
    // Keep companion metadata on the instance so the runs-table eye handler
    // can resolve envelope / "(original)" series back to their owner.
    if (chartRef.current) {
      (chartRef.current as any)._legendLines = processedLines;
    }

    // No pruning of the hidden set here. It used to drop ids that were absent
    // from this chart's lines, which was safe while the set was per-component
    // but now reaches into the SHARED store: a chart rendering with briefly
    // empty or different lines — a refetch, a sibling widget on the same key —
    // would wipe its fullscreen twin's hides. Stale ids are harmless anyway,
    // since applyLegendHidden walks the chart's own series and never consults
    // an id it doesn't own.

    // Calculate time range for datetime formatting
    const timeRange = useMemo(() => {
      if (!isDateTime || processedLines.length === 0) return 1;
      const allX = processedLines.flatMap((l) => l.x);
      if (allX.length === 0) return 1;
      return (arrayMax(allX) - arrayMin(allX)) || 1;
    }, [isDateTime, processedLines]);

    // Convert LineData[] to uPlot data format
    const uplotData = useMemo<uPlot.AlignedData>(
      () => alignDataForUPlot(processedLines, { spanGaps }),
      [processedLines, spanGaps]
    );
    const uplotDataRef = useRef(uplotData);
    uplotDataRef.current = uplotData;

    // Pre-calculate y-axis range with IQR-based outlier detection (extracted hook)
    const yRange = useYRange(uplotData, logYAxis, outlierDetection, yCategories?.length);
    // Hold yRange in a ref so buildScalesConfig's no-data fallback reads the
    // live value without yRange's always-fresh identity entering the `options`
    // useMemo deps. That dep was rebuilding the entire uPlot chart on every
    // data refresh — wasteful, and it leaked the old chart (see Bug B).
    const yRangeRef = useRef(yRange);
    yRangeRef.current = yRange;

    // Callback ref for reset bounds (used by chart lifecycle)
    const onResetBoundsRef = useRef<(() => void) | undefined>(undefined);

    // Zoom state refs
    const userHasZoomedRef = useRef(false);
    const userHasZoomedYRef = useRef(yZoomRange != null);
    const userYZoomRangeRef = useRef<[number, number] | null>(yZoomRange ?? null);
    const isXZoomAutoRangeRef = useRef(false);
    const onYZoomRangeChangeRef = useRef(onYZoomRangeChange);
    onYZoomRangeChangeRef.current = onYZoomRangeChange;
    const lastAppliedGlobalRangeRef = useRef<[number, number] | null>(null);
    const isProgrammaticScaleRef = useRef(false);
    const noDataToastShownRef = useRef<string | null>(null);

    // Sync Y zoom range from prop (e.g. fullscreen chart updated the shared range)
    useEffect(() => {
      if (yZoomRange) {
        userHasZoomedYRef.current = true;
        userYZoomRangeRef.current = yZoomRange;
      } else {
        userHasZoomedYRef.current = false;
        userYZoomRangeRef.current = null;
      }
      const chart = chartRef.current;
      if (!chart) return;
      try {
        isProgrammaticScaleRef.current = true;
        if (yZoomRange) {
          chart.batch(() => { chart.setScale("y", { min: yZoomRange[0], max: yZoomRange[1] }); });
        }
      } catch { /* disposed chart */ } finally {
        isProgrammaticScaleRef.current = false;
      }
    }, [yZoomRange]);

    // Zoom sync effect (extracted hook)
    useZoomSync({
      chartRef, chartId, chartSyncContext, chartSyncContextRef,
      logXAxis, isDateTime, zoomGroup,
      userHasZoomedRef, lastAppliedGlobalRangeRef, isProgrammaticScaleRef,
    });

    // Hover change callback
    const handleHoverChange = useMemo(() => {
      return (isHovering: boolean) => {
        const ctx = chartSyncContextRef.current;
        if (!ctx) return;
        if (isHovering) {
          ctx.setHoveredChart(chartId);
        } else {
          const currentHovered = ctx.hoveredChartIdRef?.current ?? ctx.hoveredChartId;
          if (currentHovered === chartId) ctx.setHoveredChart(null);
          lastFocusedSeriesRef.current = null;
          const u = chartInstanceRef.current;
          if (u) {
            delete (u as any)._lastFocusedSeriesIdx;
            (u as any)._crossHighlightRunId = null;
            (u as any)._crossHighlightRunIds = null;
            // Fall back to table highlight — use _tableHighlightRunIds for experiment group support
            const tableRunIds: string[] | null = (u as any)._tableHighlightRunIds;
            if (tableRunIds && tableRunIds.length > 1) {
              const lw = chartLineWidthRef.current;
              const highlightedWidth = Math.max(1, lw * 1.25);
              const dimmedWidth = Math.max(0.4, lw * 0.85);
              for (let i = 1; i < u.series.length; i++) {
                const sid = (u.series[i] as any)?._seriesId;
                const match = tableRunIds.some((id: string) => sid === id || (sid && sid.startsWith(id + ':')));
                u.series[i].width = match ? highlightedWidth : dimmedWidth;
              }
            } else {
              applySeriesHighlight(u, tableHighlightRef.current, '_seriesId', chartLineWidthRef.current);
            }
            u.redraw(false);
          }
          ctx.highlightUPlotSeries(chartId, null);
        }
      };
    }, [chartId]);

    const isActiveChart = useMemo(() => {
      return () => {
        const ctx = chartSyncContextRef.current;
        if (!ctx) return true;
        const currentHovered = ctx.hoveredChartIdRef?.current ?? ctx.hoveredChartId;
        return currentHovered === null || currentHovered === chartId;
      };
    }, [chartId]);

    // Tooltip row hover emphasis
    const handleTooltipSeriesHover = useMemo(() => {
      return (seriesLabel: string | null, runId: string | null, directSeriesIdx?: number) => {
        const u = chartInstanceRef.current;
        const ctx = chartSyncContextRef.current;
        if (!u) return;
        if (seriesLabel) {
          // Use direct series index when available (avoids ambiguity when multiple series share a label)
          const seriesIdx = directSeriesIdx ?? u.series.findIndex((s, i) => {
            if (i === 0) return false;
            if (typeof s.label === "string" && s.label === seriesLabel) return true;
            return processedLinesRef.current[i - 1]?.label === seriesLabel;
          });
          if (seriesIdx > 0) {
            lastFocusedSeriesRef.current = seriesIdx;
            (u as any)._lastFocusedSeriesIdx = seriesIdx;
            (u as any)._crossHighlightRunId = null;
            const lw = chartLineWidthRef.current;
            for (let si = 1; si < u.series.length; si++) {
              u.series[si].width = si === seriesIdx ? Math.max(1, lw * 1.25) : Math.max(0.4, lw * 0.85);
            }
            u.redraw(false);
          }
          highlightedSeriesRef.current = seriesLabel;
          ctx?.setHighlightedSeriesName(seriesLabel);
          if (runId) { ctx?.highlightUPlotSeries(chartId, runId); ctx?.setHighlightedRunId(runId); }
        } else {
          lastFocusedSeriesRef.current = null;
          delete (u as any)._lastFocusedSeriesIdx;
          (u as any)._crossHighlightRunId = null;
          (u as any)._crossHighlightRunIds = null;
          const tRunIds: string[] | null = (u as any)._tableHighlightRunIds;
          if (tRunIds && tRunIds.length > 1) {
            const lw2 = chartLineWidthRef.current;
            const hw = Math.max(1, lw2 * 1.25);
            const dw = Math.max(0.4, lw2 * 0.85);
            for (let si = 1; si < u.series.length; si++) {
              const sid = (u.series[si] as any)?._seriesId;
              const m = tRunIds.some((id: string) => sid === id || (sid && sid.startsWith(id + ':')));
              u.series[si].width = m ? hw : dw;
            }
          } else {
            applySeriesHighlight(u, tableHighlightRef.current, '_seriesId', chartLineWidthRef.current);
          }
          u.redraw(false);
          ctx?.highlightUPlotSeries(chartId, null);
        }
      };
    }, [chartId]);

    const isZoomSourceChart = useMemo(() => {
      return () => {
        const ctx = chartSyncContextRef.current;
        if (!ctx) return true;
        const currentHovered = ctx.hoveredChartIdRef?.current ?? ctx.hoveredChartId;
        return currentHovered === chartId;
      };
    }, [chartId]);

    // Structural fingerprint of series metadata — only changes when series are
    // added/removed or their visual config changes (label, color, dash, etc.),
    // NOT when data values (x/y) change. This keeps `options` stable across
    // data-only updates (like zoom refetch), enabling the fast setData() path
    // in use-chart-lifecycle instead of costly chart destroy+recreate.
    const seriesStructureKey = useMemo(() => {
      return processedLines.map((l) =>
        `${l.label}\0${l.seriesId ?? ""}\0${l.color ?? ""}\0${l.dash?.join(",") ?? ""}\0${l.envelopeOf ?? ""}\0${l.envelopeBound ?? ""}\0${l.hideFromLegend ? 1 : 0}\0${l.opacity ?? ""}`
      ).join("\n");
    }, [processedLines]);

    // Build uPlot options (memoized)
    // Uses seriesStructureKey instead of processedLines so options stay stable
    // when only data changes (zoom refetch). Builder functions read the latest
    // processedLines via processedLinesRef.
    const options = useMemo<uPlot.Options>(() => {
      const isDark = theme === "dark";
      const axisColor = isDark ? "#fff" : "#000";
      const gridColor = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";

      const series = buildSeriesConfig(processedLinesRef.current, xlabel, chartLineWidth, {
        lastFocusedSeriesRef, crossChartRunIdRef, tableHighlightRef,
        experimentRunIdsMapRef: chartSyncContext?.experimentRunIdsMapRef,
      }, {
        spanGaps, theme, yCategories,
        // Built here, where uPlot's runtime is already loaded.
        steppedPaths: stepped ? uPlot.paths.stepped!({ align: 1 }) : undefined,
        xLegendValue: isDateTime
          ? (_u, val) => val == null ? "--" : smartDateFormatter(val, timeRange)
          : isRelativeTime
            ? (_u, val) => val == null ? "--" : formatRelativeTimeValue(val)
            : (_u, val) => val == null ? "--" : formatAxisLabel(val),
      });

      const scales = buildScalesConfig({ logXAxis, logYAxis, isDateTime, yRangeRef, yZoom, categoryCount: yCategories?.length });
      const axes = buildAxesConfig({ showXAxis, showYAxis, axisColor, gridColor, isDateTime, isRelativeTime, logXAxis, logYAxis, xlabel, ylabel, timeRange, yCategories });
      const cursor = buildCursorConfig(effectiveSyncKey, yZoom);
      const bands = buildBandsConfig(processedLinesRef.current, lastFocusedSeriesRef, crossChartRunIdRef, tableHighlightRef);
      const drawHook = buildDrawHook(processedLinesRef, lastFocusedSeriesRef, crossChartRunIdRef, tableHighlightRef, chartLineWidthRef, theme);
      const focusDetectionHook = buildFocusDetectionHook({
        processedLines: processedLinesRef.current, tooltipInterpolation, spanGaps, isActiveChart,
        lastFocusedSeriesRef, highlightedSeriesRef, highlightedRunIdRef,
        highlightedSeriesIdRef, chartLineWidthRef,
        chartId, chartSyncContextRef: chartSyncContextRef as any,
        experimentRunIdsMapRef: chartSyncContext?.experimentRunIdsMapRef,
      });
      const interpolationDotsHook = buildInterpolationDotsHook({ processedLines: processedLinesRef.current, tooltipInterpolation, spanGaps, isActiveChart });
      const setScaleHook = buildSetScaleHook({
        isCategoricalY: !!yCategories,
        logYAxis, logXAxis,
        isProgrammaticScaleRef, chartSyncContextRef, isZoomSourceChart,
        chartId, zoomGroup, userHasZoomedRef, userHasZoomedYRef,
        userYZoomRangeRef, isXZoomAutoRangeRef, onYZoomRangeChangeRef,
        noDataToastShownRef, processedLinesRef,
        spanGapsRef, zoomRangeTimerRef, onZoomRangeChangeRef,
      });

      return {
        width: 400, height: 300,
        series, scales, axes, cursor,
        legend: { show: showLegend },
        select: { show: true, over: true, left: 0, top: 0, width: 0, height: 0 },
        bands: bands.length > 0 ? bands : undefined,
        focus: { alpha: 1 },
        // Optional left/right padding for end-to-end alignment with a
        // sibling canvas panel below (e.g. a transposed bars heatmap).
        // uPlot's `padding` is [top, right, bottom, left] — null keeps
        // the auto-padding default on that side.
        ...((extraLeftPadding != null && extraLeftPadding > 0) ||
        (extraRightPadding != null && extraRightPadding > 0)
          ? {
              padding: [
                null,
                extraRightPadding != null && extraRightPadding > 0
                  ? extraRightPadding
                  : null,
                null,
                extraLeftPadding != null && extraLeftPadding > 0
                  ? extraLeftPadding
                  : null,
              ] as [number | null, number | null, number | null, number | null],
            }
          : {}),
        plugins: [
          // Focus detection must run BEFORE tooltip so highlightedSeriesRef is set
          // when the tooltip reads it to sort/highlight the hovered series
          { hooks: { setCursor: [focusDetectionHook] } },
          tooltipPlugin({
            yCategories,
            theme, isDateTime, timeRange, lines: processedLinesRef.current,
            hoverStateRef, onHoverChange: handleHoverChange,
            isActiveChart, highlightedSeriesRef, highlightedRunIdRef,
            highlightedSeriesIdRef, tooltipInterpolation,
            spanGaps, xlabel, title, subtitle,
            onSeriesHover: handleTooltipSeriesHover,
            // Shared tooltip: single DOM element from ChartSyncProvider
            sharedTooltipEl: chartSyncContext?.getOrCreateTooltipEl(theme ?? "dark") ?? null,
            sharedContentContainer: chartSyncContext?.sharedTooltipContentRef?.current ?? null,
            chartId,
            activeTooltipChartRef: chartSyncContext?.activeTooltipChartRef,
            reparentTooltip: chartSyncContext?.reparentTooltip,
          }),
          nonFiniteMarkersPlugin({
            lines: processedLinesRef.current,
            theme: theme,
          }),
          ...(forkSteps && forkSteps.size > 0
            ? [forkStepPlugin({ forkSteps, theme: theme ?? "light" })]
            : []),
        ],
        hooks: {
          ready: [(u) => {
            chartInstanceRef.current = u;
            if (tooltipInterpolation !== "none") {
              const dots: HTMLDivElement[] = [];
              for (let i = 1; i < u.series.length; i++) {
                const dot = document.createElement("div");
                dot.style.cssText = "position:absolute;width:8px;height:8px;border-radius:50%;border:2px solid;transform:translate(-50%,-50%);pointer-events:none;display:none;z-index:100;background:transparent;";
                u.over.appendChild(dot);
                dots.push(dot);
              }
              (u as any)._interpDots = dots;
            }
          }],
          setCursor: [interpolationDotsHook],
          setSeries: [(u, seriesIdx, opts) => {
            if (seriesIdx == null || seriesIdx < 1) return;
            const toggled = processedLinesRef.current[seriesIdx - 1];
            if (!toggled || toggled.envelopeOf || toggled.hideFromLegend) return;
            const shouldShow = u.series[seriesIdx].show;
            const seriesId = (u.series[seriesIdx] as any)?._seriesId as string | undefined;
            const originalLabel = toggled.label;
            // Cursor focus also fires this hook with `{ focus }` only. A missing
            // override is not the same as `true`, so treating every fire as a
            // toggle wrote spurious `shown` entries and pinged the twin chart.
            const showToggled = !!opts && Object.prototype.hasOwnProperty.call(opts, "show");

            // Record the toggle in the CHART-LOCAL store, unless this change
            // came from the runs-table eye. That is a different mechanism —
            // it hides a run on every chart — and writing it here conflated
            // the two, leaving ids behind that no chart-local hide created.
            // Companion syncing below still runs either way.
            let storeChanged = false;
            if (seriesId && !(u as any)._applyingRunVisibility && showToggled) {
              // Record BOTH directions. Storing only hides could not express
              // "shown here although the runs table hid it", so a local
              // un-hide vanished the moment the chart was recreated.
              if (legendHiddenSeriesRef.current.get(seriesId) !== !!shouldShow) {
                legendHiddenSeriesRef.current.set(seriesId, !!shouldShow);
                storeChanged = true;
              }
              // The row follows the line, by the same rule as
              // applyChartVisibility: it leaves the legend only when the RUNS
              // TABLE is what hides the run. Un-hiding an eye-hidden run here
              // brings its row back; hiding it here again takes the row away
              // again, since the table still hides it. A run the table shows
              // keeps its greyed row, which is the way back to it.
              const eyeHidden = !!chartSyncContextRef.current?.hiddenRunIdsRef
                ?.current?.has(runIdOf(seriesId));
              setRunLegendRowHidden(u, seriesIdx, !shouldShow && eyeHidden);
            }
            for (let i = 1; i < u.series.length; i++) {
              if (i === seriesIdx) continue;
              const companion = processedLinesRef.current[i - 1];
              if (!companion) continue;
              // Match on the parent's LABEL, not its seriesId. The smoothing
              // companion carries its own id ("val/mAP (original)" beside the
              // parent's "val/mAP") on the individual-run page, so an id
              // comparison silently missed it there and the faint original
              // line kept drawing after its run was hidden.
              const isCompanion =
                (companion.envelopeOf && companion.envelopeOf === originalLabel) ||
                (companion.hideFromLegend &&
                  (companion.label === `${originalLabel} (original)` ||
                    (!!seriesId && companion.seriesId === seriesId)));
              if (isCompanion && u.series[i].show !== shouldShow) u.setSeries(i, { show: shouldShow }, false);
            }
            // Refit both axes to what is now visible — the same thing the
            // runs-table eye does, via the same function, so a chart-local
            // toggle and a table toggle leave the axes in the same state.
            //
            // Without this a local un-hide redrew the line but left the axes
            // where the runs-table hide had shrunk them, so a run reaching
            // past the others ran off the right edge and stopped. The hide
            // direction was equally stale: switching off the run that owned
            // an edge left dead space where its data had been.
            //
            // Skipped while the runs-table path is applying, because that
            // path fires this hook once per series and calls _forceYRecalc
            // itself once at the end.
            if (storeChanged && !(u as any)._applyingRunVisibility) {
              (u as any)._forceYRecalc?.();
            }
            // Tell the other render of this chart (inline ⇄ fullscreen) that
            // the shared hidden set moved, so it re-applies instead of only
            // picking the set up when it is next created. Only when it really
            // moved: uPlot fires this hook for cursor focus as well, which
            // leaves visibility untouched.
            if (storeChanged) notifyLegendHidden(legendHiddenKeyRef.current, chartId);
          }],
          draw: [drawHook],
          setScale: [setScaleHook],
          // Hover-end cleanup for chart-destroyed-mid-hover. uPlot fires this
          // synchronously inside chart.destroy(); we use it to scrub any
          // hover-related state that survives chart recreation. Without this,
          // when the chart is torn down while the user was hovering it (drag-
          // zoom past chart bounds → auto-zoom on mouseleave → refetch →
          // recreate; or FS dialog closed via ESC with the cursor still
          // inside the FS chart overlay), the tooltip plugin's destroy hook
          // cancels its 50ms mouseleave-hide timer without ever firing
          // onHoverChange(false), so handleHoverChange's hover-end path
          // doesn't run. Two things leak as a result:
          //   1. component-level lastFocusedSeriesRef survives recreation
          //      and the next chart's stroke function picks it up as
          //      stuck local focus (series-config.ts ~L82 fallback) →
          //      "1 chart stuck on a specific run color, ignores row hover".
          //   2. chart-sync-context.hoveredChartIdRef keeps pointing at
          //      this (now-dead) chart's id → handleRunTableHover early-
          //      returns at `if (hoveredChartIdRef.current !== null) return`
          //      → row hover does nothing on any chart.
          // Reading hoveredChartIdRef directly is the reliable signal here;
          // the tooltip plugin's local isHovering state may have already
          // been flipped by an earlier-firing destroy hook.
          destroy: [(_u) => {
            const ctx = chartSyncContextRef.current;
            if (ctx?.hoveredChartIdRef?.current !== chartId) return;
            lastFocusedSeriesRef.current = null;
            // setHoveredChart(null) clears hoveredChartIdRef + companion
            // refs (highlightedSeriesNameRef, highlightedRunIdRef) and
            // dispatches the runs-table "chart-hover-run" cleanup event.
            ctx.setHoveredChart(null);
            // Broadcast a hover-end so any other chart that received
            // this chart's _crossHighlightRunId during the drag has it
            // cleared. Iterates uplotInstancesRef which no longer
            // contains this chart (unregisterUPlot already removed it
            // earlier in the effect cleanup), so the source-skip check
            // inside is moot — every remaining chart gets the clear.
            ctx.highlightUPlotSeries(chartId, null);
          }],
          ...(yZoom ? { setSelect: [buildSetSelectHook(userHasZoomedYRef, userYZoomRangeRef, onYZoomRangeChangeRef)] } : {}),
        },
      };
    }, [
      seriesStructureKey, theme, isDateTime, logXAxis, logYAxis,
      xlabel, ylabel, showXAxis, showYAxis, showLegend,
      effectiveSyncKey, timeRange, chartId,
      handleHoverChange, isActiveChart, isZoomSourceChart,
      chartLineWidth, spanGaps,
      // NOTE: yRange is intentionally NOT a dependency — it gets a fresh
      // identity on every data refresh, and buildScalesConfig reads it live
      // via yRangeRef. Including it here recreated the chart every refresh.
      tooltipInterpolation, yZoom,
      // Recreate the uPlot chart when the caller changes the alignment-
      // padding value (e.g. they toggled "Steps on X" on a sibling
      // bars panel below). uPlot reads `padding` at init time, so this
      // is the only way to apply a new value.
      extraLeftPadding, extraRightPadding, yCategories, stepped,
    ]);

    // Chart lifecycle management (extracted hook)
    useChartLifecycle({
      isCategoricalY: !!yCategories,
      chartContainerRef, chartRef, chartInstanceRef,
      options, uplotData, uplotDataRef,
      processedLines, chartId, width, height,
      logXAxis, isDateTime, zoomGroup, theme,
      chartSyncContext, chartSyncContextRef,
      isProgrammaticScaleRef, userHasZoomedRef,
      userHasZoomedYRef, userYZoomRangeRef,
      lastAppliedGlobalRangeRef,
      zoomRangeTimerRef,
      onResetBoundsRef, onZoomRangeChangeRef,
      onYZoomRangeChangeRef, legendHiddenSeriesRef, legendHiddenKeyRef,
    });

    // Expose imperative handle
    useImperativeHandle(ref, () => ({
      getChart: () => chartRef.current,
      resetZoom: () => {
        if (chartRef.current) {
          try {
            isProgrammaticScaleRef.current = true;
            chartRef.current.setData(uplotDataRef.current);
          } finally {
            isProgrammaticScaleRef.current = false;
          }
        }
      },
    }), []);

    return (
      <div
        ref={containerRef}
        data-testid="line-chart-container"
        className={cn("p-1", className)}
        style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
        {...rest}
      >
        {title && <ChartTitle title={title} theme={theme} />}
        <div
          ref={chartContainerRef}
          data-testid="uplot-render-target"
          style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "visible" }}
        />
      </div>
    );
  }
);

LineChartUPlotInner.displayName = "LineChartUPlot";

const LineChartUPlot = React.memo(LineChartUPlotInner);

export default LineChartUPlot;
