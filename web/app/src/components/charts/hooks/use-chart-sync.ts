import { useEffect, useRef, useCallback } from "react";
import type ReactECharts from "echarts-for-react";
import type { ECharts } from "echarts";

interface ChartSyncHookResult {
  setChartRef: (index: number) => (ref: ReactECharts | null) => void;
}

// Debounce delay to batch multiple chart loads
const SYNC_DEBOUNCE_MS = 300;

/**
 * Hook to sync axisPointer (crosshair) across multiple charts.
 *
 * Unlike echarts.connect(), this only syncs the axisPointer position,
 * NOT tooltips or dataZoom. This allows:
 * - Crosshair to move in sync across charts
 * - Tooltip to only show on the hovered chart
 * - Each chart to zoom independently
 *
 * Cross-chart emphasis (highlight/downplay) is handled separately in line.tsx
 * via mouseover/mouseout handlers using window.__chartInstances.
 */
export const useChartSync = (
  groupId: string,
  loadedCharts?: number,
): ChartSyncHookResult => {
  const chartRefs = useRef<ReactECharts[]>([]);
  // Cache ECharts instances to avoid repeated getEchartsInstance() calls
  // which trigger forced reflows by accessing DOM properties
  const cachedInstancesRef = useRef<Map<number, ECharts>>(new Map());
  const pendingConnectRef = useRef<NodeJS.Timeout | null>(null);
  const pendingRAFRef = useRef<number | null>(null);
  const lastConnectedCountRef = useRef<number>(0);

  // Track axis pointer handlers for cleanup
  const axisPointerHandlersRef = useRef<Map<number, (params: any) => void>>(new Map());
  // Flag to prevent infinite dispatch loops
  const isSyncingRef = useRef(false);

  const setChartRef = useCallback(
    (index: number) => (ref: ReactECharts | null) => {
      if (ref) {
        chartRefs.current[index] = ref;
        // Defer instance access to requestAnimationFrame to batch DOM reads
        // and avoid forced reflows during render
        if (pendingRAFRef.current === null) {
          pendingRAFRef.current = requestAnimationFrame(() => {
            pendingRAFRef.current = null;
            // Batch all instance access in single frame
            chartRefs.current.forEach((chartRef, idx) => {
              if (chartRef && !cachedInstancesRef.current.has(idx)) {
                try {
                  const instance = chartRef.getEchartsInstance();
                  if (instance) {
                    cachedInstancesRef.current.set(idx, instance);
                  }
                } catch {
                  // Ignore errors from disposed charts
                }
              }
            });
          });
        }
      } else {
        // Cleanup handler for this chart
        const handler = axisPointerHandlersRef.current.get(index);
        const instance = cachedInstancesRef.current.get(index);
        if (handler && instance) {
          try {
            instance.off("updateAxisPointer", handler);
          } catch {
            // Ignore errors from disposed charts
          }
        }
        axisPointerHandlersRef.current.delete(index);
        delete chartRefs.current[index];
        cachedInstancesRef.current.delete(index);
      }
    },
    [groupId],
  );

  useEffect(() => {
    // Clear any pending connection to debounce
    if (pendingConnectRef.current) {
      clearTimeout(pendingConnectRef.current);
    }

    // Debounce the connection to batch multiple chart loads
    pendingConnectRef.current = setTimeout(() => {
      // Use requestAnimationFrame to batch DOM operations and avoid forced reflows
      requestAnimationFrame(() => {
        // Get instances from cache first, only call getEchartsInstance for uncached refs
        const instances: { idx: number; instance: ECharts }[] = [];

        chartRefs.current.forEach((ref, idx) => {
          if (!ref) return;

          // Try cached instance first
          let instance = cachedInstancesRef.current.get(idx);

          // If not cached or disposed, get fresh instance
          if (!instance || instance.isDisposed?.()) {
            try {
              instance = ref.getEchartsInstance();
              if (instance && !instance.isDisposed?.()) {
                cachedInstancesRef.current.set(idx, instance);
              }
            } catch {
              return;
            }
          }

          if (instance && !instance.isDisposed?.()) {
            instances.push({ idx, instance });
          }
        });

        // Only reconnect if chart count actually changed
        const currentCount = instances.length;
        if (currentCount === lastConnectedCountRef.current && currentCount > 0) {
          return; // No change, skip reconnection
        }

        if (instances.length > 0) {
          try {
            // Remove old handlers from all instances
            axisPointerHandlersRef.current.forEach((handler, idx) => {
              const instance = cachedInstancesRef.current.get(idx);
              if (instance && !instance.isDisposed?.()) {
                try {
                  instance.off("updateAxisPointer", handler);
                } catch {
                  // Ignore errors
                }
              }
            });
            axisPointerHandlersRef.current.clear();

            // Add axisPointer sync handlers to all instances
            instances.forEach(({ idx, instance }) => {
              const handler = (params: any) => {
                // Prevent infinite loops - don't re-dispatch if we're already syncing
                if (isSyncingRef.current) return;

                // Only sync if there's axis pointer data
                if (!params.axesInfo || params.axesInfo.length === 0) return;

                isSyncingRef.current = true;

                try {
                  // Dispatch to all other charts
                  instances.forEach(({ idx: otherIdx, instance: otherInstance }) => {
                    if (otherIdx === idx) return; // Skip self
                    if (otherInstance.isDisposed?.()) return;

                    try {
                      // Sync axisPointer position without showing tooltip
                      // The tooltip will only show on the hovered chart
                      otherInstance.dispatchAction({
                        type: "updateAxisPointer",
                        currTrigger: "leave", // This prevents tooltip from showing
                        x: params.axesInfo[0]?.value !== undefined ? undefined : params.event?.offsetX,
                        y: params.event?.offsetY,
                        // Pass the data value for axis alignment
                        seriesIndex: 0,
                        dataIndex: params.dataIndex,
                      });
                    } catch {
                      // Ignore errors from disposed charts
                    }
                  });
                } finally {
                  // Use setTimeout to reset flag after current event loop
                  setTimeout(() => {
                    isSyncingRef.current = false;
                  }, 0);
                }
              };

              axisPointerHandlersRef.current.set(idx, handler);
              instance.on("updateAxisPointer", handler);
            });

            lastConnectedCountRef.current = currentCount;
          } catch (e) {
            console.warn("Failed to setup chart sync", e);
          }
        }
      });
    }, SYNC_DEBOUNCE_MS);

    return () => {
      if (pendingConnectRef.current) {
        clearTimeout(pendingConnectRef.current);
      }
    };
  }, [groupId, loadedCharts]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cancel pending RAF
      if (pendingRAFRef.current !== null) {
        cancelAnimationFrame(pendingRAFRef.current);
        pendingRAFRef.current = null;
      }

      // Remove all handlers
      axisPointerHandlersRef.current.forEach((handler, idx) => {
        const instance = cachedInstancesRef.current.get(idx);
        if (instance && !instance.isDisposed?.()) {
          try {
            instance.off("updateAxisPointer", handler);
          } catch {
            // Ignore errors
          }
        }
      });
      axisPointerHandlersRef.current.clear();
      cachedInstancesRef.current.clear();
    };
  }, []);

  return { setChartRef };
};
