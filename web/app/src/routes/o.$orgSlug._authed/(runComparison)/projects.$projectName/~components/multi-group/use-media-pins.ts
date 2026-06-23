import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useImageStepSyncContext,
  type PinInfo,
} from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~context/image-step-sync-context";

interface UseMediaPinsArgs {
  /** logName of this media widget — scopes per-widget and local pins. */
  logName: string;
  /** Runs currently in the comparison — used to prune stale local pins. */
  runs: { runId: string }[];
}

export interface MediaPinsApi {
  /** Whether the step-sync context (and thus cross-panel pinning) is available. */
  hasSyncContext: boolean;
  /**
   * Resolve the effective pin for a run, honoring precedence:
   * per-widget pin → cross-panel pin (unless this widget is excluded) → local pin.
   */
  getPinInfo: (runId: string) => PinInfo | null;
  /** Pin a run at a step. `scope` controls local-only vs. across-all-panels. */
  handlePin: (
    runId: string,
    step: number,
    currentIndex: number,
    scope: "local" | "all-panels",
  ) => void;
  /** Unpin a run from just this widget or across all widgets. */
  handleUnpin: (runId: string, scope: "this-widget" | "all-widgets") => void;
  /** Count of unique runs with at least one pin (local + per-widget + cross-panel). */
  pinnedRunCount: number;
  /** Clear every pin — cross-panel, per-widget, and local to this widget. */
  clearAllPins: () => void;
}

/**
 * Shared pinning logic for media comparison widgets (image / video / audio).
 *
 * Owns the per-widget `localPins` map and bridges to the shared
 * `ImageStepSyncContext` for cross-panel and best-step pins. Extracted so all
 * three media types pin identically — see `multi-group/image.tsx`,
 * `video.tsx`, and `audio.tsx`.
 */
export function useMediaPins({ logName, runs }: UseMediaPinsArgs): MediaPinsApi {
  const syncContext = useImageStepSyncContext();
  const hasSyncContext = syncContext !== null;
  const [localPins, setLocalPins] = useState<Map<string, PinInfo>>(new Map());

  // Clean up pins for runs that are no longer in the comparison
  const runIdSet = useMemo(() => new Set(runs.map((r) => r.runId)), [runs]);
  useEffect(() => {
    setLocalPins((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const runId of next.keys()) {
        if (!runIdSet.has(runId)) {
          next.delete(runId);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [runIdSet]);

  const getPinInfo = useCallback(
    (runId: string): PinInfo | null => {
      // Per-widget pins (most specific — keyed by runId:logName)
      const perWidget = syncContext?.pinnedRunsByWidget.get(`${runId}:${logName}`);
      if (perWidget) return perWidget;
      // Cross-panel pins (same step for all widgets) — unless this widget is
      // excluded (user unpinned just this one)
      const crossPanel = syncContext?.pinnedRuns.get(runId);
      if (crossPanel && !crossPanel.excludedWidgets?.has(logName)) {
        return crossPanel;
      }
      // Local (this panel only)
      const local = localPins.get(runId);
      if (local) return local;
      return null;
    },
    [syncContext?.pinnedRuns, syncContext?.pinnedRunsByWidget, localPins, logName],
  );

  const handlePin = useCallback(
    (
      runId: string,
      step: number,
      currentIndex: number,
      scope: "local" | "all-panels",
    ) => {
      if (scope === "all-panels" && syncContext) {
        // Cross-panel pin overrides everything (handled in context.pinRun).
        // Capture the currently-visible sample index so this widget remembers
        // it even across Charts ↔ Dashboards tab switches. Other widgets that
        // receive the same cross-panel pin fall back to their own index state.
        syncContext.pinRun(runId, step, "cross-panel", {
          originLogName: logName,
          index: currentIndex,
        });
        setLocalPins((prev) => {
          const next = new Map(prev);
          next.delete(runId);
          return next;
        });
      } else {
        // Local pin overrides any pre-existing cross-panel/per-widget pin
        // FOR THIS WIDGET ONLY (other widgets keep their pins).
        syncContext?.unpinRunForWidget(runId, logName);
        setLocalPins((prev) =>
          new Map(prev).set(runId, {
            step,
            source: "local",
            originLogName: logName,
            index: currentIndex,
          }),
        );
      }
    },
    [syncContext, logName],
  );

  const handleUnpin = useCallback(
    (runId: string, scope: "this-widget" | "all-widgets") => {
      if (scope === "all-widgets") {
        // Remove everywhere — cross-panel + per-widget + local
        syncContext?.unpinRun(runId);
        setLocalPins((prev) => {
          const next = new Map(prev);
          next.delete(runId);
          return next;
        });
      } else {
        // Remove only from this widget
        syncContext?.unpinRunForWidget(runId, logName);
        setLocalPins((prev) => {
          const next = new Map(prev);
          next.delete(runId);
          return next;
        });
      }
    },
    [syncContext, logName],
  );

  // Count unique runs that have at least one pin applied — not the raw sum
  // of all pin entries (per-widget pins otherwise inflate the count by N).
  const pinnedRunCount = useMemo(() => {
    const pinnedRunIds = new Set<string>();
    syncContext?.pinnedRuns.forEach((_, runId) => pinnedRunIds.add(runId));
    syncContext?.pinnedRunsByWidget.forEach((_, key) => {
      const runId = key.split(":")[0];
      if (runId) pinnedRunIds.add(runId);
    });
    localPins.forEach((_, runId) => pinnedRunIds.add(runId));
    return pinnedRunIds.size;
  }, [syncContext?.pinnedRuns, syncContext?.pinnedRunsByWidget, localPins]);

  const clearAllPins = useCallback(() => {
    syncContext?.unpinAllRuns();
    setLocalPins(new Map());
  }, [syncContext]);

  return {
    hasSyncContext,
    getPinInfo,
    handlePin,
    handleUnpin,
    pinnedRunCount,
    clearAllPins,
  };
}
