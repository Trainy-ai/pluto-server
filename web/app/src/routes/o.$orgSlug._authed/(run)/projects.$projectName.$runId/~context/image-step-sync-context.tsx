import React, {
  createContext,
  useContext,
  useCallback,
  useRef,
  useState,
  useEffect,
} from "react";

// ============================
// Types
// ============================

/** Distinguishes how a pin was created for visual styling */
export type PinSource = "local" | "cross-panel" | "best-step";

export interface PinInfo {
  step: number;
  source: PinSource;
  /**
   * Widget logNames where this pin should NOT apply, even though the run is
   * otherwise pinned across all panels. Used when a user unpins a cross-panel
   * or best-step pin from a single widget while keeping it active elsewhere.
   */
  excludedWidgets?: Set<string>;
  /**
   * For cross-panel pins: the widget logName where the pin was created.
   * The remembered `index` only applies when viewing that exact widget —
   * other widgets that receive the cross-panel pin use their own index
   * state (default 0).
   */
  originLogName?: string;
  /**
   * Remembered sample index at the time of pinning. Only meaningful for
   * multi-index logNames (wandb-style list-of-media logging). For
   * cross-panel pins this is scoped to `originLogName`; for other sources
   * (local / best-step) it's always scoped to the widget the pin is
   * attached to.
   */
  index?: number;
}

interface ImageStepSyncContextValue {
  /** Current synced step value (the shared step for all locked panels) */
  syncedStepValue: number | null;
  /** Whether sync is globally enabled (default: true) */
  isSyncEnabled: boolean;
  /** Toggle global sync on/off */
  setIsSyncEnabled: (enabled: boolean) => void;
  /** Broadcast a step change to all synced panels */
  broadcastStep: (stepValue: number, sourceId: string) => void;
  /** Register a callback to receive step broadcasts */
  registerListener: (id: string, callback: (stepValue: number) => void) => void;
  /** Unregister a listener */
  unregisterListener: (id: string) => void;
  /** Runs pinned at a specific step across all panels (runId → pin info) */
  pinnedRuns: Map<string, PinInfo>;
  /**
   * Per-widget pins keyed by `${runId}:${imageLogName}` → pin info.
   * Used for "best step per image widget" — each image widget gets its
   * own argmin/argmax step for the same metric.
   * Per-widget pins take precedence over the cross-panel `pinnedRuns` map.
   */
  pinnedRunsByWidget: Map<string, PinInfo>;
  /**
   * Pin a run at a step across all panels.
   * `opts.originLogName` + `opts.index` let the caller remember which image
   * sample was visible at pin-creation time — only meaningful when viewing
   * `originLogName`. Other widgets with this pin default to index 0.
   */
  pinRun: (
    runId: string,
    step: number,
    source?: PinSource,
    opts?: { originLogName?: string; index?: number },
  ) => void;
  /** Unpin a run completely — removes from all widgets (cross-panel + per-widget) */
  unpinRun: (runId: string) => void;
  /**
   * Unpin a run only from a specific widget. For cross-panel pins,
   * adds the widget's logName to the pin's excludedWidgets set.
   * For per-widget pins, removes the `runId:logName` entry.
   */
  unpinRunForWidget: (runId: string, logName: string) => void;
  /** Clear all cross-panel pins at once */
  unpinAllRuns: () => void;
}

// ============================
// Context
// ============================

const ImageStepSyncContext = createContext<ImageStepSyncContextValue | null>(
  null,
);

// ============================
// Provider
// ============================

interface ImageStepSyncProviderProps {
  children: React.ReactNode;
}

/**
 * Provider for synchronizing image step navigation across panels within a section.
 *
 * When sync is enabled (default), changing the step on any image panel broadcasts
 * the step value to all other panels. Each panel can opt out by unlocking itself.
 */
export function ImageStepSyncProvider({ children }: ImageStepSyncProviderProps) {
  const [isSyncEnabled, setIsSyncEnabled] = useState(true);
  const [syncedStepValue, setSyncedStepValue] = useState<number | null>(null);
  const [pinnedRuns, setPinnedRuns] = useState<Map<string, PinInfo>>(new Map());
  const [pinnedRunsByWidget, setPinnedRunsByWidget] = useState<Map<string, PinInfo>>(
    new Map(),
  );
  const listenersRef = useRef(new Map<string, (stepValue: number) => void>());

  const registerListener = useCallback(
    (id: string, callback: (stepValue: number) => void) => {
      listenersRef.current.set(id, callback);
    },
    [],
  );

  const unregisterListener = useCallback((id: string) => {
    listenersRef.current.delete(id);
  }, []);

  const broadcastStep = useCallback(
    (stepValue: number, sourceId: string) => {
      if (!isSyncEnabled) return;
      setSyncedStepValue(stepValue);
      listenersRef.current.forEach((callback, id) => {
        if (id !== sourceId) {
          callback(stepValue);
        }
      });
    },
    [isSyncEnabled],
  );

  const pinRun = useCallback(
    (
      runId: string,
      step: number,
      source: PinSource = "cross-panel",
      opts?: { originLogName?: string; index?: number },
    ) => {
    // Cross-panel pins override any existing per-widget or cross-panel state
    // for this run (including clearing excludedWidgets from prior pins).
    setPinnedRuns((prev) => {
      const next = new Map(prev);
      next.set(runId, {
        step,
        source,
        originLogName: opts?.originLogName,
        index: opts?.index,
      });
      return next;
    });
    setPinnedRunsByWidget((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const key of next.keys()) {
        if (key.startsWith(`${runId}:`)) {
          next.delete(key);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const unpinRun = useCallback((runId: string) => {
    setPinnedRuns((prev) => {
      const next = new Map(prev);
      next.delete(runId);
      return next;
    });
    setPinnedRunsByWidget((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const key of next.keys()) {
        if (key.startsWith(`${runId}:`)) {
          next.delete(key);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const unpinRunForWidget = useCallback((runId: string, logName: string) => {
    // Remove the per-widget entry if it exists
    setPinnedRunsByWidget((prev) => {
      const key = `${runId}:${logName}`;
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    // For cross-panel pins, add this widget to the excluded set
    setPinnedRuns((prev) => {
      const existing = prev.get(runId);
      if (!existing) return prev;
      const next = new Map(prev);
      next.set(runId, {
        ...existing,
        excludedWidgets: new Set([...(existing.excludedWidgets ?? []), logName]),
      });
      return next;
    });
  }, []);

  const unpinAllRuns = useCallback(() => {
    setPinnedRuns(new Map());
    setPinnedRunsByWidget(new Map());
  }, []);

  // Listen for DOM events to pin runs from outside the provider tree (e.g., runs table)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{
        pins?: Record<string, number>;
        pinsByWidget?: Record<string, number>;
      }>).detail;

      if (detail.pinsByWidget) {
        // Per-widget pins: keys are "runId:imageLogName"
        const widgetMap = new Map<string, PinInfo>();
        for (const [key, step] of Object.entries(detail.pinsByWidget)) {
          widgetMap.set(key, { step, source: "best-step" });
        }
        setPinnedRunsByWidget(widgetMap);
        // Clear per-run pins so the new per-widget ones fully replace
        setPinnedRuns(new Map());
      } else if (detail.pins) {
        // Per-run pins: keys are runId
        const pinMap = new Map<string, PinInfo>();
        for (const [runId, step] of Object.entries(detail.pins)) {
          pinMap.set(runId, { step, source: "best-step" });
        }
        setPinnedRuns(pinMap);
        // Clear per-widget pins so the new per-run ones fully replace
        setPinnedRunsByWidget(new Map());
      }
    };
    document.addEventListener("pin-runs-to-best-step", handler);
    return () => document.removeEventListener("pin-runs-to-best-step", handler);
  }, []);

  const contextValue = React.useMemo<ImageStepSyncContextValue>(
    () => ({
      syncedStepValue,
      isSyncEnabled,
      setIsSyncEnabled,
      broadcastStep,
      registerListener,
      unregisterListener,
      pinnedRuns,
      pinnedRunsByWidget,
      pinRun,
      unpinRun,
      unpinRunForWidget,
      unpinAllRuns,
    }),
    [
      syncedStepValue,
      isSyncEnabled,
      broadcastStep,
      registerListener,
      unregisterListener,
      pinnedRuns,
      pinnedRunsByWidget,
      pinRun,
      unpinRun,
      unpinRunForWidget,
      unpinAllRuns,
    ],
  );

  return (
    <ImageStepSyncContext.Provider value={contextValue}>
      {children}
    </ImageStepSyncContext.Provider>
  );
}

// ============================
// Hooks
// ============================

/**
 * Hook to access image step sync context.
 * Returns null if not within an ImageStepSyncProvider.
 */
export function useImageStepSyncContext(): ImageStepSyncContextValue | null {
  return useContext(ImageStepSyncContext);
}
