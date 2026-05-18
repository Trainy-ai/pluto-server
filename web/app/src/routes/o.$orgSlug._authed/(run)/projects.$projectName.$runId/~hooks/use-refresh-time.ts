import { useState, useEffect } from "react";
import { getLastRefreshTime, setLastRefreshTime } from "@/lib/db/refresh-time";

interface UseRefreshTimeProps {
  runId: string;
  onRefresh?: () => Promise<void>;
}

/**
 * Tracks the "last refreshed at" timestamp for a run page and exposes a
 * `handleRefresh` callback the page hands to its `<RefreshButton>`.
 *
 * Auto-refresh polling is owned by `<RefreshButton>` itself — it has its
 * own interval that reads the user-chosen cadence from
 * `localStorage[storageKey]`, defers ticks while a popup or pinned chart
 * tooltip is open, and pauses while the tab is hidden. This hook used
 * to schedule its own redundant interval that bypassed all of that
 * (pinned tooltips vanished on every tick during RUNNING-run polling);
 * that timer was removed.
 */
export function useRefreshTime({
  runId,
  onRefresh,
}: UseRefreshTimeProps) {
  const [lastRefreshTime, setLastRefreshTimeState] = useState<Date | null>(
    null,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const loadInitialRefreshTime = async () => {
      const time = await getLastRefreshTime(runId);
      if (time) setLastRefreshTimeState(time);
    };
    loadInitialRefreshTime();
  }, [runId]);

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      if (onRefresh) await onRefresh();
      const now = new Date();
      setLastRefreshTimeState(now);
      await setLastRefreshTime(runId, now);
    } catch (error) {
      console.error("Error refreshing data:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  return {
    lastRefreshTime,
    isRefreshing,
    handleRefresh,
  };
}
