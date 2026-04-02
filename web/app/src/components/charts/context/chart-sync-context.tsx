import React, {
  createContext,
  useContext,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type uPlot from "uplot";

// ============================
// Helpers
// ============================

/** Read current chart line width from localStorage (for imperative use outside React) */
function getStoredLineWidth(): number {
  const stored = localStorage.getItem("chart-line-width");
  if (stored === null) return 1.5;
  const parsed = parseFloat(stored);
  return isNaN(parsed) ? 1.5 : parsed;
}

function seriesKeyMatches(seriesValue: string | undefined, target: string, key: string): boolean {
  if (!seriesValue) return false;
  if (seriesValue === target) return true;
  if (key === '_seriesId' && seriesValue.startsWith(target + ':')) return true;
  return false;
}

/**
 * Apply series highlight widths to a uPlot chart.
 * Only changes line widths — stroke colors are handled by the dynamic stroke function
 * in series-config.ts which reads the run ID from (chart as any)._crossHighlightRunId.
 */
export function applySeriesHighlight(chart: uPlot, value: string | null, key: '_seriesId' | 'label' = 'label', defaultWidth = 1.5): void {
  const hasMatch = value && chart.series.some((s: any) => seriesKeyMatches(s[key], value, key));

  if (hasMatch) {
    const highlightedWidth = Math.max(1, defaultWidth * 1.25);
    const dimmedWidth = Math.max(0.4, defaultWidth * 0.85);
    for (let i = 1; i < chart.series.length; i++) {
      const s = chart.series[i];
      const match = seriesKeyMatches((s as any)[key], value, key);
      s.width = match ? highlightedWidth : dimmedWidth;
    }
  } else {
    for (let i = 1; i < chart.series.length; i++) {
      const s = chart.series[i];
      s.width = (s as any)._baseWidth ?? defaultWidth;
    }
  }
}

// ============================
// Helpers – cross-axis interpolation
// ============================

/** Binary-search interpolation between two parallel sorted arrays */
export function interpolate(xs: number[], ys: number[], x: number): number {
  if (xs.length === 0) return x;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + t * (ys[hi] - ys[lo]);
}

// ============================
// Types
// ============================

interface ChartSyncContextValue {
  // uPlot registration
  registerUPlot: (id: string, chart: uPlot) => void;
  unregisterUPlot: (id: string) => void;
  getUPlotInstances: () => Map<string, uPlot>;

  // Per-chart reset callbacks (restore original data + auto-scale)
  registerResetCallback: (id: string, callback: () => void) => void;
  unregisterResetCallback: (id: string) => void;

  // Per-chart zoom callbacks (apply zoom with isProgrammaticScaleRef guard)
  // zoomGroup groups charts by x-axis type so only compatible charts sync zoom
  registerZoomCallback: (id: string, callback: (xMin: number, xMax: number) => void, zoomGroup?: string) => void;
  unregisterZoomCallback: (id: string) => void;

  // Sync key for uPlot built-in cursor sync
  syncKey: string;

  // Cross-chart highlighting for uPlot (direct instance manipulation)
  // Accepts a run ID (not a label) — matches series by _seriesId prefix
  highlightUPlotSeries: (sourceChartId: string, runId: string | null) => void;

  // Hover tracking - only the hovered chart should show tooltip
  hoveredChartId: string | null;
  hoveredChartIdRef: React.RefObject<string | null>; // Synchronous access for immediate checks
  setHoveredChart: (id: string | null) => void;

  // Cross-chart series highlighting for uPlot (refs to avoid re-renders on hover)
  highlightedSeriesNameRef: React.RefObject<string | null>;
  setHighlightedSeriesName: (name: string | null) => void;

  // Cross-chart run ID — the run ID of the hovered series, used for prefix matching
  highlightedRunIdRef: React.RefObject<string | null>;
  setHighlightedRunId: (runId: string | null) => void;

  // Zoom sync for uPlot - syncs X-axis scale across all charts
  syncXScale: (sourceChartId: string, xMin: number, xMax: number) => void;
  resetZoom: (sourceChartId: string) => void;

  // Global X-axis range computed from all selected runs (passed from parent)
  globalXRange: [number, number] | null;

  // Synced zoom range - when user zooms, this is set so newly mounted charts use same zoom
  // null means no active zoom (use globalXRange instead)
  // zoomGroup indicates which x-axis type the zoom applies to (ref to avoid re-renders)
  syncedZoomRange: [number, number] | null;
  syncedZoomGroupRef: React.RefObject<string | null>;
  setSyncedZoomRange: (range: [number, number] | null, zoomGroup?: string) => void;

  // Table-driven series highlighting - when a run row is hovered in the runs table
  // Separate from chart-driven highlighting to avoid conflicts
  tableHighlightedSeries: string | null;
  /** Ref to current table-highlighted series — updated imperatively by DOM event, read by chart draw hooks */
  tableHighlightedSeriesRef: React.RefObject<string | null>;

  // Ref to check if syncXScale is currently propagating (prevents target charts from broadcasting)
  isSyncingZoomRef: React.RefObject<boolean>;

  // Hidden run IDs — set imperatively via DOM event, read by charts on creation
  hiddenRunIdsRef: React.RefObject<Set<string>>;

  // Step↔time mapping for cross-axis zoom sync.
  // When set, zooming a step chart translates the range to relative time and vice versa.
  stepTimeMappingRef: React.RefObject<{ steps: number[]; relTimeSecs: number[] } | null>;
  setStepTimeMapping: (steps: number[], relTimeSecs: number[]) => void;

  // Cross-group zoom range — the translated range for the opposite zoom group.
  // Used by newly mounted charts to apply zoom from the translated group.
  // sourceStepRange preserves the original step bounds from a Step→RelTime translation
  // so that refetch can skip the lossy time→step roundtrip.
  crossGroupZoomRef: React.RefObject<{ group: string; range: [number, number]; sourceStepRange?: [number, number] } | null>;

  /** Experiment run ID lookup: maps runId → all runIds in the same experiment.
   *  Set by the page when in experiments mode. Used for group highlighting. */
  experimentRunIdsMapRef: React.RefObject<Map<string, string[]> | null>;
}

// ============================
// Context
// ============================

const ChartSyncContext = createContext<ChartSyncContextValue | null>(null);

// ============================
// Provider
// ============================

interface ChartSyncProviderProps {
  children: React.ReactNode;
  /** Unique key for this sync group. Charts with the same key will sync together. */
  syncKey?: string;
  /** Global X-axis range for all charts. Computed from server before charts render. */
  initialGlobalXRange?: [number, number] | null;
  /** Series name to highlight from the runs table (external to chart hover system) */
  tableHighlightedSeries?: string | null;
  /** Experiment run ID lookup for group highlighting. Maps runId → all runIds in same experiment. */
  experimentRunIdsMap?: Map<string, string[]> | null;
}

/**
 * Provider for cross-chart synchronization.
 *
 * Wrap chart containers with this provider to enable:
 * - Cursor position sync across uPlot charts (via syncKey)
 * - Cross-chart series highlighting
 * - Global X-axis range synchronization
 * - Centralized chart instance registry
 */
export function ChartSyncProvider({
  children,
  syncKey = "chart-sync-default",
  initialGlobalXRange = null,
  tableHighlightedSeries: tableHighlightedSeriesProp = null,
  experimentRunIdsMap: experimentRunIdsMapProp = null,
}: ChartSyncProviderProps) {
  // Use refs for registries to avoid re-renders when charts register/unregister
  const uplotInstancesRef = useRef(new Map<string, uPlot>());
  // Per-chart reset callbacks — each chart registers a function that restores its original data
  const resetCallbacksRef = useRef(new Map<string, () => void>());
  // Per-chart zoom callbacks — each chart registers a function that applies zoom with its own isProgrammaticScaleRef guard
  // zoomGroup tags callbacks by x-axis type so only compatible charts sync zoom
  const zoomCallbacksRef = useRef(new Map<string, { callback: (xMin: number, xMax: number) => void; zoomGroup: string }>());

  // Track which chart is currently being hovered (for tooltip display)
  // Only the hovered chart should show its tooltip; synced charts show only cursor line
  // Use BOTH ref (synchronous) and state (async) for proper React/event handling
  const hoveredChartIdRef = useRef<string | null>(null);
  const [hoveredChartId, setHoveredChartId] = useState<string | null>(null);

  // Experiment run ID lookup: maps a single runId → all runIds in the same experiment.
  // Set by the page component when in experiments mode. Used by highlightUPlotSeries
  // to expand a single hovered run to the full experiment for group highlighting.
  const experimentRunIdsMapRef = useRef<Map<string, string[]> | null>(experimentRunIdsMapProp);
  experimentRunIdsMapRef.current = experimentRunIdsMapProp;

  // Track which series is highlighted across all charts (for uPlot cross-chart highlighting)
  // Refs instead of state — only read synchronously by tooltip/stroke code, never triggers re-renders.
  // Using state here caused the entire chart tree to re-render on every hover.
  const highlightedSeriesNameRef = useRef<string | null>(null);

  // Track which run ID is highlighted across charts (for prefix matching on multi-metric charts)
  const highlightedRunIdRef = useRef<string | null>(null);

  // Global X-axis range from prop (computed from server before charts render)
  // Use ref for stable reference that doesn't cause re-renders when updated
  const globalXRangeRef = useRef<[number, number] | null>(initialGlobalXRange);

  // Track the LAST DEFINED range separately - used to detect actual value changes
  // This prevents clearing zoom when range goes undefined → same value
  const lastDefinedRangeRef = useRef<[number, number] | null>(initialGlobalXRange);

  // Track the range as state too, but only update when actually changed
  // This allows charts to subscribe to changes without full context re-render
  const [globalXRange, setGlobalXRange] = useState<[number, number] | null>(initialGlobalXRange);

  // Update both ref and state when prop changes
  useEffect(() => {
    const newRange = initialGlobalXRange;
    const currentRange = globalXRangeRef.current;

    // Only update if actually changed (compare values, not references)
    const hasChanged = !newRange !== !currentRange ||
      (newRange && currentRange && (newRange[0] !== currentRange[0] || newRange[1] !== currentRange[1]));

    if (hasChanged) {
      globalXRangeRef.current = newRange;
      setGlobalXRange(newRange);

      // Update last defined range tracker
      if (newRange) {
        lastDefinedRangeRef.current = newRange;
      }

      // IMPORTANT: Do NOT automatically clear syncedZoomRange when global range changes.
      // The user's zoom should be preserved as long as it overlaps with the new data range.
      // Individual charts will validate their zoom in their setScale effect.
      // This prevents losing zoom when:
      // - Runs are selected/deselected (but data range overlaps)
      // - Page scrolls cause re-renders
      // - Queries refetch with same/similar data
    }
  }, [initialGlobalXRange]);

  // Synced zoom range - persists user zoom across virtualized chart unmount/remount
  // When user zooms on any chart, this is set so newly mounted charts use the same zoom
  const [syncedZoomRange, setSyncedZoomRangeInternal] = useState<[number, number] | null>(null);
  // Zoom group stored as ref — only read synchronously by zoom logic, never triggers re-renders.
  // Using state here would cause the entire chart tree to re-render on every zoom.
  const syncedZoomGroupRef = useRef<string | null>(null);

  // Stable callback for setting syncedZoomRange (with zoom group for x-axis type filtering)
  // CRITICAL: Update ref FIRST (synchronous) so newly mounting charts can read immediately
  const setSyncedZoomRange = useCallback((range: [number, number] | null, zoomGroup?: string) => {
    syncedZoomRangeRef.current = range;  // Sync - immediate access for new charts
    setSyncedZoomRangeInternal(range);   // Async - for React re-renders
    syncedZoomGroupRef.current = range ? (zoomGroup ?? "default") : null;
    // Clear cross-group zoom when zoom is reset — prevents stale translated
    // ranges from leaking when switching between axis modes.
    if (!range) {
      crossGroupZoomRef.current = null;
    }
  }, []);

  // Table-highlighted series ref for synchronous access
  const tableHighlightedSeriesRef = useRef<string | null>(tableHighlightedSeriesProp);

  // Keep ref in sync with prop (if still passed)
  useEffect(() => {
    tableHighlightedSeriesRef.current = tableHighlightedSeriesProp;
  }, [tableHighlightedSeriesProp]);

  // Hidden run IDs — stored imperatively, read by charts on creation to apply show/hide
  const hiddenRunIdsRef = useRef<Set<string>>(new Set());

  // Listen for run visibility changes (dispatched from index.tsx when hiddenRunIds changes).
  // Imperatively toggles uPlot series visibility via setSeries() — no chart recreation.
  useEffect(() => {
    function handleVisibilityChange(e: Event) {
      const hiddenIds = (e as CustomEvent).detail as Set<string>;
      hiddenRunIdsRef.current = hiddenIds;

      uplotInstancesRef.current.forEach((chart) => {
        chart.batch(() => {
          for (let i = 1; i < chart.series.length; i++) {
            const seriesId = (chart.series[i] as any)?._seriesId as string | undefined;
            if (!seriesId) continue;
            const runId = seriesId.includes(':') ? seriesId.split(':')[0] : seriesId;
            const shouldShow = !hiddenIds.has(runId);
            if (chart.series[i].show !== shouldShow) {
              chart.setSeries(i, { show: shouldShow });
            }
          }
        });
      });
    }
    document.addEventListener('run-visibility-change', handleVisibilityChange);
    return () => document.removeEventListener('run-visibility-change', handleVisibilityChange);
  }, []);

  // Listen for DOM-based hover events from the runs table.
  // The runs table dispatches "run-table-hover" CustomEvents to avoid React state
  // changes that would remount table cell components (closing open popovers).
  useEffect(() => {
    function handleRunTableHover(e: Event) {
      const detail = (e as CustomEvent).detail as string | string[] | null;
      // Normalize to single ID for backward compatibility
      const primaryRunId = Array.isArray(detail) ? detail[0] ?? null : detail;
      const allRunIds = Array.isArray(detail) ? detail : (detail ? [detail] : []);
      tableHighlightedSeriesRef.current = primaryRunId;

      // Only apply if no chart is actively being hovered
      if (hoveredChartIdRef.current !== null) return;

      const lw = getStoredLineWidth();
      uplotInstancesRef.current.forEach((chart) => {
        (chart as any)._tableHighlightRunId = primaryRunId;
        (chart as any)._tableHighlightRunIds = allRunIds;

        if (allRunIds.length === 0) {
          // Clear highlight
          applySeriesHighlight(chart, null, '_seriesId', lw);
        } else {
          // Highlight all matching run IDs (experiments mode sends multiple)
          const highlightedWidth = Math.max(1, lw * 1.25);
          const dimmedWidth = Math.max(0.4, lw * 0.85);
          const hasAnyMatch = allRunIds.some((id) =>
            chart.series.some((s: any) => seriesKeyMatches(s._seriesId, id, '_seriesId')),
          );
          if (hasAnyMatch) {
            for (let i = 1; i < chart.series.length; i++) {
              const s = chart.series[i];
              const match = allRunIds.some((id) => seriesKeyMatches((s as any)._seriesId, id, '_seriesId'));
              s.width = match ? highlightedWidth : dimmedWidth;
            }
          } else {
            for (let i = 1; i < chart.series.length; i++) {
              chart.series[i].width = (chart.series[i] as any)._baseWidth ?? lw;
            }
          }
        }
        chart.redraw(false);

        const container = chart.root?.closest('[data-testid="line-chart-container"]');
        if (container) {
          const hasMatch = allRunIds.some((id) =>
            chart.series.some((s: any) => seriesKeyMatches(s._seriesId, id, '_seriesId')),
          );
          if (hasMatch) {
            container.setAttribute('data-table-highlighted-run', primaryRunId!);
          } else {
            container.removeAttribute('data-table-highlighted-run');
          }
        }
      });
    }
    document.addEventListener("run-table-hover", handleRunTableHover);
    return () => document.removeEventListener("run-table-hover", handleRunTableHover);
  }, []);

  // uPlot registration
  const registerUPlot = useCallback((id: string, chart: uPlot) => {
    uplotInstancesRef.current.set(id, chart);
    // In experiments mode, attach the experiment lookup map for group highlighting.
    // The cursor hook reads this to expand a hovered run to all experiment runs.
    if (experimentRunIdsMapRef.current) {
      (chart as any)._experimentRunIdsMap = experimentRunIdsMapRef.current;
    }
  }, []);

  const unregisterUPlot = useCallback((id: string) => {
    uplotInstancesRef.current.delete(id);
    resetCallbacksRef.current.delete(id);
    zoomCallbacksRef.current.delete(id);
  }, []);

  // Per-chart reset callback registration
  const registerResetCallback = useCallback((id: string, callback: () => void) => {
    resetCallbacksRef.current.set(id, callback);
  }, []);

  const unregisterResetCallback = useCallback((id: string) => {
    resetCallbacksRef.current.delete(id);
  }, []);

  // Per-chart zoom callback registration (with optional zoom group for x-axis type filtering)
  const registerZoomCallback = useCallback((id: string, callback: (xMin: number, xMax: number) => void, zoomGroup = "default") => {
    zoomCallbacksRef.current.set(id, { callback, zoomGroup });
  }, []);

  const unregisterZoomCallback = useCallback((id: string) => {
    zoomCallbacksRef.current.delete(id);
  }, []);

  const getUPlotInstances = useCallback(() => {
    return new Map(uplotInstancesRef.current);
  }, []);

  // Track last highlighted series to avoid redundant redraws
  const lastHighlightedRef = useRef<{ sourceChartId: string; runId: string | null } | null>(null);

  // rAF throttle refs for highlight coalescing
  const pendingHighlightRef = useRef<{ sourceChartId: string; runId: string | null } | null>(null);
  const highlightRafRef = useRef<number | null>(null);

  // Cross-chart highlighting for uPlot - directly manipulates registered instances
  // This avoids React state timing issues by working imperatively
  // Uses requestAnimationFrame to coalesce multiple calls per frame (e.g. 60fps mouse moves with 20+ charts)
  // Accepts a run ID and matches by _seriesId prefix — works for both single-metric and multi-metric charts
  const highlightUPlotSeries = useCallback(
    (sourceChartId: string, runId: string | null) => {
      // Store the latest args — only the most recent call per frame matters
      pendingHighlightRef.current = { sourceChartId, runId };

      // If a rAF is already scheduled, the pending ref will be picked up — no need to schedule another
      if (highlightRafRef.current !== null) return;

      highlightRafRef.current = requestAnimationFrame(() => {
        highlightRafRef.current = null;
        const pending = pendingHighlightRef.current;
        if (!pending) return;
        pendingHighlightRef.current = null;

        const { sourceChartId: srcId, runId: id } = pending;

        // Skip if nothing changed (avoids constant redraws during cursor sync)
        const last = lastHighlightedRef.current;
        if (last && last.sourceChartId === srcId && last.runId === id) {
          return;
        }
        lastHighlightedRef.current = { sourceChartId: srcId, runId: id };

        // In experiments mode, expand a single run ID to all runs in the experiment
        const expMap = experimentRunIdsMapRef.current;
        const allExpRunIds = id && expMap ? (expMap.get(id) ?? [id]) : (id ? [id] : []);

        // Notify the runs table which run is being hovered in the chart
        // Send all experiment run IDs so the table can highlight the experiment row
        document.dispatchEvent(new CustomEvent("chart-hover-run", {
          detail: allExpRunIds.length > 1 ? allExpRunIds : id,
        }));

        uplotInstancesRef.current.forEach((chart, chartMapId) => {
          if (chartMapId === srcId) return; // Skip source chart

          const lw = getStoredLineWidth();

          // Store run IDs on chart instance for the stroke function
          (chart as any)._crossHighlightRunId = id;
          (chart as any)._crossHighlightRunIds = allExpRunIds.length > 0 ? allExpRunIds : null;

          if (id !== null) {
            // Clear local focus on target charts so cross-chart highlight takes priority
            // in the stroke function's 3-tier priority system
            (chart as any)._lastFocusedSeriesIdx = null;
          } else {
            // Highlight clearing — remove instance override so stroke function
            // falls back to the component ref for future local focus detection
            delete (chart as any)._lastFocusedSeriesIdx;
          }

          if (id === null) {
            // Fall back to table highlight if active, otherwise reset to default
            const tableId = tableHighlightedSeriesRef.current;
            applySeriesHighlight(chart, tableId, '_seriesId', lw);
          } else if (allExpRunIds.length > 1) {
            // Experiment mode: highlight all runs in the experiment
            const highlightedWidth = Math.max(1, lw * 1.25);
            const dimmedWidth = Math.max(0.4, lw * 0.85);
            const hasAnyMatch = allExpRunIds.some((rid) =>
              chart.series.some((s: any) => seriesKeyMatches(s._seriesId, rid, '_seriesId')),
            );
            if (hasAnyMatch) {
              for (let i = 1; i < chart.series.length; i++) {
                const s = chart.series[i];
                const match = allExpRunIds.some((rid) => seriesKeyMatches((s as any)._seriesId, rid, '_seriesId'));
                s.width = match ? highlightedWidth : dimmedWidth;
              }
            } else {
              for (let i = 1; i < chart.series.length; i++) {
                chart.series[i].width = (chart.series[i] as any)._baseWidth ?? lw;
              }
            }
          } else {
            // Single run highlight
            applySeriesHighlight(chart, id, '_seriesId', lw);
          }
          // Redraw without rebuildPaths to preserve Y-axis zoom
          chart.redraw(false);
        });
      });
    },
    []
  );

  // Callback for setting hovered chart (stable reference)
  // Also clears highlighted series when no chart is hovered
  // CRITICAL: Updates ref FIRST (synchronous) then state (async)
  // This allows isActiveChart checks to work immediately during cursor sync events
  const setHoveredChart = useCallback((id: string | null) => {
    hoveredChartIdRef.current = id; // SYNC - immediate, for cursor sync checks
    setHoveredChartId(id);          // ASYNC - for React re-renders
    // Clear highlighted series when mouse leaves all charts
    // Table highlight (if active) will take over via the stroke function's 3rd priority tier
    if (id === null) {
      highlightedSeriesNameRef.current = null;
      highlightedRunIdRef.current = null;
      // Clear the runs table highlight when mouse leaves the chart
      document.dispatchEvent(new CustomEvent("chart-hover-run", { detail: null }));
    }
  }, []);

  // Callback for setting highlighted series name (stable reference)
  const setHighlightedSeries = useCallback((name: string | null) => {
    highlightedSeriesNameRef.current = name;
  }, []);

  // Callback for setting highlighted run ID (stable reference)
  const setHighlightedRunId = useCallback((runId: string | null) => {
    highlightedRunIdRef.current = runId;
  }, []);

  // Step↔time mapping for cross-axis zoom sync.
  // Used in both single-run and multi-run/dashboard views when widgets use
  // different x-axis types (Step vs Relative Time).
  const stepTimeMappingRef = useRef<{ steps: number[]; relTimeSecs: number[] } | null>(null);

  const setStepTimeMapping = useCallback((steps: number[], relTimeSecs: number[]) => {
    stepTimeMappingRef.current = { steps, relTimeSecs };
  }, []);

  // Cross-group zoom range — stores translated range for the opposite zoom group
  // Used so newly mounted charts in the translated group can pick up the zoom
  const crossGroupZoomRef = useRef<{ group: string; range: [number, number]; sourceStepRange?: [number, number] } | null>(null);

  // Flag to prevent zoom sync infinite loops
  const isSyncingZoomRef = useRef(false);

  // Sync X-axis zoom across uPlot charts.
  // Same-group charts get the range directly. Cross-group charts (step ↔ relative time)
  // get a translated range via the step↔time mapping (single-run view only).
  const syncXScale = useCallback((sourceChartId: string, xMin: number, xMax: number) => {
    // Prevent infinite loops
    if (isSyncingZoomRef.current) return;
    isSyncingZoomRef.current = true;

    try {
      const sourceEntry = zoomCallbacksRef.current.get(sourceChartId);
      const sourceGroup = sourceEntry?.zoomGroup ?? "default";
      const mapping = stepTimeMappingRef.current;

      zoomCallbacksRef.current.forEach((entry, id) => {
        if (id === sourceChartId) return;

        if (entry.zoomGroup === sourceGroup) {
          // Same group: apply range directly
          try { entry.callback(xMin, xMax); } catch { /* destroyed chart */ }
          return;
        }

        // Cross-group translation via step↔time mapping
        if (!mapping) return;
        let translatedMin: number | null = null;
        let translatedMax: number | null = null;

        if (sourceGroup === "step" && entry.zoomGroup === "relative-time") {
          translatedMin = interpolate(mapping.steps, mapping.relTimeSecs, xMin);
          translatedMax = interpolate(mapping.steps, mapping.relTimeSecs, xMax);
        } else if (sourceGroup === "relative-time" && entry.zoomGroup === "step") {
          translatedMin = interpolate(mapping.relTimeSecs, mapping.steps, xMin);
          translatedMax = interpolate(mapping.relTimeSecs, mapping.steps, xMax);
        }

        if (translatedMin !== null && translatedMax !== null) {
          try { entry.callback(translatedMin, translatedMax); } catch { /* destroyed chart */ }
        }
      });

      // Also store translated range for the cross-group so newly mounted charts pick it up
      if (mapping) {
        if (sourceGroup === "step") {
          const relMin = interpolate(mapping.steps, mapping.relTimeSecs, xMin);
          const relMax = interpolate(mapping.steps, mapping.relTimeSecs, xMax);
          setSyncedZoomRange([xMin, xMax], "step");
          // Store original step bounds so refetch skips lossy time→step roundtrip
          crossGroupZoomRef.current = { group: "relative-time", range: [relMin, relMax], sourceStepRange: [xMin, xMax] };
        } else if (sourceGroup === "relative-time") {
          const stepMin = interpolate(mapping.relTimeSecs, mapping.steps, xMin);
          const stepMax = interpolate(mapping.relTimeSecs, mapping.steps, xMax);
          setSyncedZoomRange([xMin, xMax], "relative-time");
          crossGroupZoomRef.current = { group: "step", range: [stepMin, stepMax] };
        }
      }
    } finally {
      isSyncingZoomRef.current = false;
    }
  }, [setSyncedZoomRange]);

  // Reset zoom on all uPlot charts (all groups when cross-axis sync is active).
  // Each chart's reset callback is self-contained: it restores data, resets X scale,
  // and clears zoom state. No additional scale manipulation is needed here.
  const resetZoom = useCallback((sourceChartId: string) => {
    // Prevent infinite loops
    if (isSyncingZoomRef.current) return;
    isSyncingZoomRef.current = true;

    try {
      // Reset ALL charts (all groups) — when step↔time mapping exists, zoom
      // crosses axis types, so reset must also cross axis types.
      resetCallbacksRef.current.forEach((callback, id) => {
        if (id === sourceChartId) return; // Skip source chart
        try {
          callback();
        } catch {
          // Ignore errors from destroyed charts
        }
      });

      // Clear cross-group zoom state
      crossGroupZoomRef.current = null;
    } finally {
      isSyncingZoomRef.current = false;
    }
  }, []);

  // Refs for synchronous access to state values in event handlers
  // This avoids stale closure issues and allows immediate reads
  const syncedZoomRangeRef = useRef<[number, number] | null>(null);
  const globalXRangeStateRef = useRef<[number, number] | null>(globalXRange);

  // Keep refs in sync with state
  useEffect(() => {
    syncedZoomRangeRef.current = syncedZoomRange;
  }, [syncedZoomRange]);

  useEffect(() => {
    globalXRangeStateRef.current = globalXRange;
  }, [globalXRange]);

  // Memoize context value to prevent unnecessary re-renders
  // OPTIMIZATION: State values that change frequently (syncedZoomRange, globalXRange)
  // are also exposed via refs for synchronous access. This way, consumers that only
  // need synchronous access can use refs without causing re-renders.
  const contextValue = useMemo<ChartSyncContextValue>(
    () => ({
      registerUPlot,
      unregisterUPlot,
      getUPlotInstances,
      registerResetCallback,
      unregisterResetCallback,
      registerZoomCallback,
      unregisterZoomCallback,
      syncKey,
      highlightUPlotSeries,
      hoveredChartId,
      hoveredChartIdRef,
      setHoveredChart,
      highlightedSeriesNameRef,
      setHighlightedSeriesName: setHighlightedSeries,
      highlightedRunIdRef,
      setHighlightedRunId,
      syncXScale,
      resetZoom,
      globalXRange,
      syncedZoomRange,
      syncedZoomGroupRef,
      setSyncedZoomRange,
      // tableHighlightedSeries is now handled imperatively via DOM events
      // to avoid re-rendering the entire component tree on hover
      tableHighlightedSeries: null,
      tableHighlightedSeriesRef,
      isSyncingZoomRef,
      hiddenRunIdsRef,
      stepTimeMappingRef,
      setStepTimeMapping,
      crossGroupZoomRef,
      experimentRunIdsMapRef,
    }),
    [
      registerUPlot,
      unregisterUPlot,
      getUPlotInstances,
      registerResetCallback,
      unregisterResetCallback,
      registerZoomCallback,
      unregisterZoomCallback,
      syncKey,
      highlightUPlotSeries,
      // hoveredChartId intentionally omitted - use hoveredChartIdRef instead
      setHoveredChart,
      // highlightedSeriesNameRef intentionally omitted - stable ref, never changes
      // highlightedRunIdRef intentionally omitted - stable ref, never changes
      syncXScale,
      resetZoom,
      globalXRange,
      syncedZoomRange,
      // syncedZoomGroupRef intentionally omitted - stable ref, never changes
      // isSyncingZoomRef intentionally omitted - stable ref, never changes
    ]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      uplotInstancesRef.current.clear();
      resetCallbacksRef.current.clear();
      zoomCallbacksRef.current.clear();
      // Cancel any pending highlight rAF to avoid post-unmount work
      if (highlightRafRef.current !== null) {
        cancelAnimationFrame(highlightRafRef.current);
        highlightRafRef.current = null;
      }
    };
  }, []);

  return (
    <ChartSyncContext.Provider value={contextValue}>
      {children}
    </ChartSyncContext.Provider>
  );
}

// ============================
// Hook
// ============================

/**
 * Hook to access the chart sync context.
 * Returns null if not within a ChartSyncProvider.
 */
export function useChartSyncContext(): ChartSyncContextValue | null {
  return useContext(ChartSyncContext);
}

/**
 * Hook that throws if not within a ChartSyncProvider.
 * Use this when chart sync is required.
 */
export function useRequiredChartSyncContext(): ChartSyncContextValue {
  const context = useContext(ChartSyncContext);
  if (!context) {
    throw new Error(
      "useRequiredChartSyncContext must be used within a ChartSyncProvider"
    );
  }
  return context;
}
