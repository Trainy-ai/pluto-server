import React, {
  createContext,
  useContext,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type ReactECharts from "echarts-for-react";
import type { ECharts } from "echarts";
import type uPlot from "uplot";

// ============================
// Types
// ============================

interface ChartSyncContextValue {
  // ECharts registration
  registerEChart: (id: string, ref: ReactECharts) => void;
  unregisterEChart: (id: string) => void;
  getEChartInstances: () => Map<string, ECharts>;

  // uPlot registration
  registerUPlot: (id: string, chart: uPlot) => void;
  unregisterUPlot: (id: string) => void;
  getUPlotInstances: () => Map<string, uPlot>;

  // Sync key for uPlot built-in cursor sync
  syncKey: string;

  // Cross-chart highlighting for ECharts (replaces window.__chartInstances)
  highlightSeries: (sourceChartId: string, seriesName: string | null) => void;

  // Cross-chart highlighting for uPlot (direct instance manipulation)
  highlightUPlotSeries: (sourceChartId: string, seriesLabel: string | null) => void;

  // Hover tracking - only the hovered chart should show tooltip
  hoveredChartId: string | null;
  hoveredChartIdRef: React.RefObject<string | null>; // Synchronous access for immediate checks
  setHoveredChart: (id: string | null) => void;

  // Cross-chart series highlighting for uPlot (tracked via state for subscriptions)
  highlightedSeriesName: string | null;
  setHighlightedSeriesName: (name: string | null) => void;
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
}

/**
 * Provider for cross-chart synchronization.
 *
 * Wrap chart containers with this provider to enable:
 * - Cursor position sync across uPlot charts (via syncKey)
 * - Cross-chart series highlighting for ECharts
 * - Centralized chart instance registry (replaces window.__chartInstances)
 */
export function ChartSyncProvider({
  children,
  syncKey = "chart-sync-default",
}: ChartSyncProviderProps) {
  // Use refs for registries to avoid re-renders when charts register/unregister
  const echartsRefsRef = useRef(new Map<string, ReactECharts>());
  const echartsInstancesRef = useRef(new Map<string, ECharts>());
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

  // ECharts registration
  const registerEChart = useCallback((id: string, ref: ReactECharts) => {
    echartsRefsRef.current.set(id, ref);
    // Defer instance access to avoid forced reflows during render
    requestAnimationFrame(() => {
      try {
        const instance = ref.getEchartsInstance();
        if (instance && !instance.isDisposed?.()) {
          echartsInstancesRef.current.set(id, instance);
        }
      } catch {
        // Ignore errors from disposed charts
      }
    });
  }, []);

  const unregisterEChart = useCallback((id: string) => {
    echartsRefsRef.current.delete(id);
    echartsInstancesRef.current.delete(id);
  }, []);

  const getEChartInstances = useCallback(() => {
    // Return a copy to prevent external mutation
    return new Map(echartsInstancesRef.current);
  }, []);

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

  // Cross-chart highlighting for ECharts
  const highlightSeries = useCallback(
    (sourceChartId: string, seriesName: string | null) => {
      // Prevent infinite loops
      if (isHighlightingRef.current) return;

      isHighlightingRef.current = true;

      try {
        echartsInstancesRef.current.forEach((instance, id) => {
          if (id === sourceChartId) return; // Skip source chart
          if (instance.isDisposed?.()) return;

          try {
            if (seriesName === null) {
              // Downplay all series
              instance.dispatchAction({ type: "downplay" });
            } else {
              // Highlight specific series by name
              instance.dispatchAction({
                type: "highlight",
                seriesName,
              });
            }
          } catch {
            // Ignore errors from disposed charts
          }
        });
      } finally {
        // Reset flag after current event loop
        setTimeout(() => {
          isHighlightingRef.current = false;
        }, 0);
      }
    },
    []
  );

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

        if (seriesLabel === null) {
          // Reset all series to full alpha
          for (let i = 1; i < chart.series.length; i++) {
            const s = chart.series[i] as uPlot.Series & { _alpha?: number };
            s._alpha = 1;
            s.alpha = 1;
          }
          chart.redraw();
        } else {
          // Highlight matching series using alpha
          let hasMatch = false;
          for (let i = 1; i < chart.series.length; i++) {
            if (chart.series[i].label === seriesLabel) {
              hasMatch = true;
              break;
            }
          }

          // Only apply highlighting if this chart has the series
          if (hasMatch) {
            for (let i = 1; i < chart.series.length; i++) {
              const s = chart.series[i] as uPlot.Series & { _alpha?: number };
              const match = s.label === seriesLabel;
              s._alpha = match ? 1 : 0.15;
              s.alpha = match ? 1 : 0.15;
            }
            chart.redraw();
          }
          // If no match, don't change - chart shows different metrics
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
    if (id === null) {
      setHighlightedSeriesName(null);
    }
  }, []);

  // Callback for setting highlighted series name (stable reference)
  const setHighlightedSeries = useCallback((name: string | null) => {
    setHighlightedSeriesName(name);
  }, []);

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo<ChartSyncContextValue>(
    () => ({
      registerEChart,
      unregisterEChart,
      getEChartInstances,
      registerUPlot,
      unregisterUPlot,
      getUPlotInstances,
      syncKey,
      highlightSeries,
      highlightUPlotSeries,
      hoveredChartId,
      hoveredChartIdRef,
      setHoveredChart,
      highlightedSeriesName,
      setHighlightedSeriesName: setHighlightedSeries,
    }),
    [
      registerEChart,
      unregisterEChart,
      getEChartInstances,
      registerUPlot,
      unregisterUPlot,
      getUPlotInstances,
      syncKey,
      highlightSeries,
      highlightUPlotSeries,
      hoveredChartId,
      setHoveredChart,
      highlightedSeriesName,
      setHighlightedSeries,
    ]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      echartsRefsRef.current.clear();
      echartsInstancesRef.current.clear();
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
