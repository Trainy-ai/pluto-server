import { useEffect, useRef, useCallback, useState } from "react";
import type ReactECharts from "echarts-for-react";
import * as echarts from "echarts";

interface ChartSyncHookResult {
  setChartRef: (index: number) => (ref: ReactECharts | null) => void;
}

export const useChartSync = (
  groupId: string,
  loadedCharts?: number,
): ChartSyncHookResult => {
  const chartRefs = useRef<ReactECharts[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const connectionsRef = useRef<string[]>([]);

  const setChartRef = useCallback(
    (index: number) => (ref: ReactECharts | null) => {
      if (ref) {
        chartRefs.current[index] = ref;
        const chart = ref.getEchartsInstance();
        if (chart) {
          chart.group = groupId;
        }
      } else {
        delete chartRefs.current[index];
      }
    },
    [groupId],
  );

  useEffect(() => {
    const instances = chartRefs.current
      .map((ref) => {
        try {
          return ref?.getEchartsInstance();
        } catch (e) {
          console.warn("Failed to get LineChart instance", e);
          return null;
        }
      })
      .filter(Boolean);

    if (instances.length > 0) {
      try {
        // Disconnect any existing connections
        connectionsRef.current.forEach((id) => {
          try {
            echarts.disconnect(id);
          } catch {} // Ignore disconnection errors
        });
        connectionsRef.current = [];

        // Set group and connect
        instances.forEach((chart) => {
          if (chart) chart.group = groupId;
        });

        echarts.connect(groupId);
        connectionsRef.current.push(groupId);

        if (!isConnected) {
          setIsConnected(true);
        }
      } catch (e) {
        console.warn("Failed to connect charts", e);
      }
    }

    return () => {
      try {
        connectionsRef.current.forEach((id) => {
          echarts.disconnect(id);
        });
        connectionsRef.current = [];
        setIsConnected(false);
      } catch (e) {
        console.warn("Failed to disconnect charts", e);
      }
    };
  }, [groupId, loadedCharts]); // Removed isConnected from dependencies

  return { setChartRef };
};
