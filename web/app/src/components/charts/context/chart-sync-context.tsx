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

/**
 * Apply series highlight widths to a uPlot chart.
 * If value is provided and matches a series, highlights it and dims others.
 * If value is null or doesn't match any series, resets all to defaultWidth.
 * @param key - which series property to match against ('label' for cross-chart, '_seriesId' for table highlight)
 * @param defaultWidth - base line width (default 1.5)
 */
export function applySeriesHighlight(chart: uPlot, value: string | null, key: '_seriesId' | 'label' = 'label', defaultWidth = 1.5): void {
  const hasMatch = value && chart.series.some((s: any) => s[key] === value);

  if (hasMatch) {
    const highlightedWidth = defaultWidth * 1.6;
    const dimmedWidth = Math.max(0.3, defaultWidth * 0.2);
    for (let i = 1; i < chart.series.length; i++) {
      const match = (chart.series[i] as any)[key] === value;
      chart.series[i].width = match ? highlightedWidth : dimmedWidth;
    }
  } else {
    for (let i = 1; i < chart.series.length; i++) {
      chart.series[i].width = defaultWidth;
    }
  }
}

// ============================
// Types
// ============================

interface ChartSyncContextValue {
  // uPlot registration
  registerUPlot: (id: string, chart: uPlot) => void;
  unregisterUPlot: (id: string) => void;
  getUPlotInstances: () => Map<string, uPlot>;

  // Sync key for uPlot built-in cursor sync
  syncKey: string;

  // Cross-chart highlighting for uPlot (direct instance manipulation)
  highlightUPlotSeries: (sourceChartId: string, seriesLabel: string | null) => void;

  // Hover tracking - only the hovered chart should show tooltip
  hoveredChartId: string | null;
  hoveredChartIdRef: React.RefObject<string | null>; // Synchronous access for immediate checks
  setHoveredChart: (id: string | null) => void;

  // Cross-chart series highlighting for uPlot (tracked via state for subscriptions)
  highlightedSeriesName: string | null;
  setHighlightedSeriesName: (name: string | null) => void;

  // Zoom sync for uPlot - syncs X-axis scale across all charts
  syncXScale: (sourceChartId: string, xMin: number, xMax: number) => void;
  resetZoom: (sourceChartId: string) => void;

  // Global X-axis range computed from all selected runs (passed from parent)
  globalXRange: [number, number] | null;

  // Synced zoom range - when user zooms, this is set so newly mounted charts use same zoom
  // null means no active zoom (use globalXRange instead)
  syncedZoomRange: [number, number] | null;
  setSyncedZoomRange: (range: [number, number] | null) => void;

  // Table-driven series highlighting - when a run row is hovered in the runs table
  // Separate from chart-driven highlighting to avoid conflicts
  tableHighlightedSeries: string | null;
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
}: ChartSyncProviderProps) {
  // Use refs for registries to avoid re-renders when charts register/unregister
  const uplotInstancesRef = useRef(new Map<string, uPlot>());

  // Flag to prevent infinite highlight loops
  const isHighlightingRef = useRef(false);

  // Track which chart is currently being hovered (for tooltip display)
  // Only the hovered chart should show its tooltip; synced charts show only cursor line
  // Use BOTH ref (synchronous) and state (async) for proper React/event handling
  const hoveredChartIdRef = useRef<string | null>(null);
  const [hoveredChartId, setHoveredChartId] = useState<string | null>(null);

  // Track which series is highlighted across all charts (for uPlot cross-chart highlighting)
  const [highlightedSeriesName, setHighlightedSeriesName] = useState<string | null>(null);

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

  // Stable callback for setting syncedZoomRange
  // CRITICAL: Update ref FIRST (synchronous) so newly mounting charts can read immediately
  const setSyncedZoomRange = useCallback((range: [number, number] | null) => {
    syncedZoomRangeRef.current = range;  // Sync - immediate access for new charts
    setSyncedZoomRangeInternal(range);   // Async - for React re-renders
  }, []);

  // Table-highlighted series ref for synchronous access
  const tableHighlightedSeriesRef = useRef<string | null>(tableHighlightedSeriesProp);

  // Keep ref in sync with prop
  useEffect(() => {
    tableHighlightedSeriesRef.current = tableHighlightedSeriesProp;
  }, [tableHighlightedSeriesProp]);

  // Apply table highlight widths to all charts when the prop changes
  useEffect(() => {
    const label = tableHighlightedSeriesProp;

    // Only apply if no chart is actively being hovered
    if (hoveredChartIdRef.current !== null) return;

    const lw = getStoredLineWidth();
    uplotInstancesRef.current.forEach((chart) => {
      applySeriesHighlight(chart, label, '_seriesId', lw);
      chart.redraw(false);
    });
  }, [tableHighlightedSeriesProp]);

  // uPlot registration
  const registerUPlot = useCallback((id: string, chart: uPlot) => {
    uplotInstancesRef.current.set(id, chart);
  }, []);

  const unregisterUPlot = useCallback((id: string) => {
    uplotInstancesRef.current.delete(id);
  }, []);

  const getUPlotInstances = useCallback(() => {
    return new Map(uplotInstancesRef.current);
  }, []);

  // Track last highlighted series to avoid redundant redraws
  const lastHighlightedRef = useRef<{ sourceChartId: string; seriesLabel: string | null } | null>(null);

  // Cross-chart highlighting for uPlot - directly manipulates registered instances
  // This avoids React state timing issues by working imperatively
  const highlightUPlotSeries = useCallback(
    (sourceChartId: string, seriesLabel: string | null) => {
      // Skip if nothing changed (avoids constant redraws during cursor sync)
      const last = lastHighlightedRef.current;
      if (last && last.sourceChartId === sourceChartId && last.seriesLabel === seriesLabel) {
        return;
      }
      lastHighlightedRef.current = { sourceChartId, seriesLabel };

      uplotInstancesRef.current.forEach((chart, id) => {
        if (id === sourceChartId) return; // Skip source chart

        const lw = getStoredLineWidth();
        if (seriesLabel === null) {
          // Fall back to table highlight if active, otherwise reset to default
          const tableId = tableHighlightedSeriesRef.current;
          applySeriesHighlight(chart, tableId, '_seriesId', lw);
          chart.redraw(false);
        } else {
          // Only apply highlighting if this chart has the series
          const hasMatch = chart.series.some((s) => s.label === seriesLabel);
          if (hasMatch) {
            applySeriesHighlight(chart, seriesLabel, 'label', lw);
            chart.redraw(false);
          }
        }
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
      setHighlightedSeriesName(null);
    }
  }, []);

  // Callback for setting highlighted series name (stable reference)
  const setHighlightedSeries = useCallback((name: string | null) => {
    setHighlightedSeriesName(name);
  }, []);

  // Flag to prevent zoom sync infinite loops
  const isSyncingZoomRef = useRef(false);

  // Sync X-axis zoom across all uPlot charts
  const syncXScale = useCallback((sourceChartId: string, xMin: number, xMax: number) => {
    // Prevent infinite loops
    if (isSyncingZoomRef.current) return;
    isSyncingZoomRef.current = true;

    try {
      uplotInstancesRef.current.forEach((chart, id) => {
        if (id === sourceChartId) return; // Skip source chart

        try {
          // Set the X scale to match the source chart's zoom
          chart.setScale("x", { min: xMin, max: xMax });
        } catch {
          // Ignore errors from destroyed charts
        }
      });
    } finally {
      // Reset flag after current event loop
      setTimeout(() => {
        isSyncingZoomRef.current = false;
      }, 0);
    }
  }, []);

  // Reset zoom on all uPlot charts
  const resetZoom = useCallback((sourceChartId: string) => {
    // Prevent infinite loops
    if (isSyncingZoomRef.current) return;
    isSyncingZoomRef.current = true;

    try {
      uplotInstancesRef.current.forEach((chart, id) => {
        if (id === sourceChartId) return; // Skip source chart

        try {
          // Reset to auto scale by setting scale with no constraints
          const xData = chart.data[0] as number[];
          if (xData && xData.length > 0) {
            const xMin = Math.min(...xData);
            const xMax = Math.max(...xData);
            chart.setScale("x", { min: xMin, max: xMax });
          }
        } catch {
          // Ignore errors from destroyed charts
        }
      });
    } finally {
      setTimeout(() => {
        isSyncingZoomRef.current = false;
      }, 0);
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
      syncKey,
      highlightUPlotSeries,
      hoveredChartId,
      hoveredChartIdRef,
      setHoveredChart,
      highlightedSeriesName,
      setHighlightedSeriesName: setHighlightedSeries,
      syncXScale,
      resetZoom,
      globalXRange,
      syncedZoomRange,
      setSyncedZoomRange,
      tableHighlightedSeries: tableHighlightedSeriesProp,
    }),
    [
      registerUPlot,
      unregisterUPlot,
      getUPlotInstances,
      syncKey,
      highlightUPlotSeries,
      // hoveredChartId intentionally omitted - use hoveredChartIdRef instead
      setHoveredChart,
      highlightedSeriesName,
      setHighlightedSeries,
      syncXScale,
      resetZoom,
      globalXRange,
      syncedZoomRange,
      tableHighlightedSeriesProp,
    ]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      uplotInstancesRef.current.clear();
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
