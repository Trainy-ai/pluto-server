import { useState, useEffect } from "react";
import { getLastRefreshTime, setLastRefreshTime } from "@/lib/db/refresh-time";

interface UseRefreshTimeProps {
  runId: string;
  onRefresh?: () => Promise<void>;
  defaultAutoRefresh?: boolean;
  refreshInterval?: number;
}

export function useRefreshTime({
  runId,
  onRefresh,
  defaultAutoRefresh = false,
  refreshInterval = 5000,
}: UseRefreshTimeProps) {
  const [lastRefreshTime, setLastRefreshTimeState] = useState<Date | null>(
    null,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Load initial refresh time
  useEffect(() => {
    const loadInitialRefreshTime = async () => {
      const time = await getLastRefreshTime(runId);
      if (time) {
        setLastRefreshTimeState(time);
      }
    };
    loadInitialRefreshTime();
  }, [runId]);

  // Handle refresh
  const handleRefresh = async () => {
    if (isRefreshing) return;

    setIsRefreshing(true);
    try {
      if (onRefresh) {
        await onRefresh();
      }
      const now = new Date();
      setLastRefreshTimeState(now);
      await setLastRefreshTime(runId, now);
    } catch (error) {
      console.error("Error refreshing data:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Auto refresh effect
  useEffect(() => {
    if (!defaultAutoRefresh) return;

    handleRefresh();
    const interval = setInterval(handleRefresh, refreshInterval);

    return () => clearInterval(interval);
  }, [defaultAutoRefresh, refreshInterval]);

  return {
    lastRefreshTime,
    isRefreshing,
    handleRefresh,
  };
}
