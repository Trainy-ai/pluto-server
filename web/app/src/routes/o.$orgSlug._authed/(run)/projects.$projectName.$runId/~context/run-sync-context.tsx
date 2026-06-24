import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

// Parallel to ImageStepSyncContext but for the RUN axis. Widgets
// that show one run at a time (multi-run histograms, future media
// widgets) can opt into cross-widget run sync — scrubbing the run
// slider in one widget broadcasts the runId, and every other widget
// that has both (a) the same runId in its run list AND (b) is
// "locked" snaps to that run.
//
// Separate from step sync because the two axes are independent:
// you can sync step but not run, or vice versa.

interface RunSyncContextValue {
  isSyncEnabled: boolean;
  setIsSyncEnabled: (enabled: boolean) => void;
  broadcastRun: (runId: string, sourceId: string) => void;
  registerListener: (id: string, callback: (runId: string) => void) => void;
  unregisterListener: (id: string) => void;
  // Current synced runId — used by panels mounting after a broadcast
  // already happened so they snap into place on mount.
  syncedRunId: string | null;
}

const RunSyncContext = createContext<RunSyncContextValue | null>(null);

export function RunSyncProvider({ children }: { children: React.ReactNode }) {
  const [isSyncEnabled, setIsSyncEnabled] = useState(true);
  const [syncedRunId, setSyncedRunId] = useState<string | null>(null);
  const listenersRef = useRef(
    new Map<string, (runId: string) => void>(),
  );

  const registerListener = useCallback(
    (id: string, callback: (runId: string) => void) => {
      listenersRef.current.set(id, callback);
    },
    [],
  );

  const unregisterListener = useCallback((id: string) => {
    listenersRef.current.delete(id);
  }, []);

  const broadcastRun = useCallback(
    (runId: string, sourceId: string) => {
      if (!isSyncEnabled) return;
      setSyncedRunId(runId);
      listenersRef.current.forEach((cb, id) => {
        if (id !== sourceId) cb(runId);
      });
    },
    [isSyncEnabled],
  );

  const contextValue = React.useMemo<RunSyncContextValue>(
    () => ({
      isSyncEnabled,
      setIsSyncEnabled,
      broadcastRun,
      registerListener,
      unregisterListener,
      syncedRunId,
    }),
    [
      isSyncEnabled,
      broadcastRun,
      registerListener,
      unregisterListener,
      syncedRunId,
    ],
  );

  return (
    <RunSyncContext.Provider value={contextValue}>
      {children}
    </RunSyncContext.Provider>
  );
}

export function useRunSyncContext(): RunSyncContextValue | null {
  return useContext(RunSyncContext);
}

interface UseSyncedRunNavigationArgs {
  // Stable list of run identifiers (e.g. SQID display IDs or numeric
  // run IDs as strings) the widget cycles through. The hook tracks
  // currentRunIdx into this list and broadcasts whichever runId
  // corresponds to the user-selected index when locked.
  runIds: string[];
}

interface UseSyncedRunNavigationReturn {
  runIdx: number;
  setRunIdx: (idx: number) => void;
  isLocked: boolean;
  setIsLocked: (locked: boolean) => void;
  hasSyncContext: boolean;
}

// Mirrors useSyncedStepNavigation's shape but for runs.
//
// When locked + a context exists:
//   - changes to runIdx broadcast the matching runId to other panels
//   - incoming broadcasts snap to the matching index when present in
//     this widget's runIds, otherwise the widget stays put (we never
//     leave a widget showing a run it doesn't have)
export function useSyncedRunNavigation({
  runIds,
}: UseSyncedRunNavigationArgs): UseSyncedRunNavigationReturn {
  const panelId = useId();
  const syncContext = useRunSyncContext();

  const [runIdx, setRunIdxState] = useState(0);
  const [isLocked, setIsLocked] = useState(true);

  // Keep runIdx in range as runIds change.
  useEffect(() => {
    if (runIdx >= runIds.length && runIds.length > 0) {
      setRunIdxState(runIds.length - 1);
    }
  }, [runIdx, runIds.length]);

  // Listen for incoming broadcasts while locked.
  useEffect(() => {
    if (!syncContext || !isLocked) return;
    const handle = (runId: string) => {
      const i = runIds.indexOf(runId);
      if (i >= 0) setRunIdxState(i);
    };
    syncContext.registerListener(panelId, handle);
    return () => syncContext.unregisterListener(panelId);
  }, [syncContext, isLocked, panelId, runIds]);

  // When mounting (or runIds changing), snap to the already-synced
  // runId if any.
  const hasSnappedRef = useRef(false);
  useEffect(() => {
    if (
      !hasSnappedRef.current &&
      isLocked &&
      syncContext?.syncedRunId &&
      runIds.length > 0
    ) {
      const i = runIds.indexOf(syncContext.syncedRunId);
      if (i >= 0) {
        setRunIdxState(i);
        hasSnappedRef.current = true;
      }
    }
  }, [runIds, isLocked, syncContext?.syncedRunId]);

  const setRunIdx = useCallback(
    (idx: number) => {
      setRunIdxState(idx);
      if (isLocked && syncContext) {
        const runId = runIds[idx];
        if (runId) syncContext.broadcastRun(runId, panelId);
      }
    },
    [isLocked, syncContext, runIds, panelId],
  );

  return {
    runIdx,
    setRunIdx,
    isLocked,
    setIsLocked,
    hasSyncContext: syncContext !== null,
  };
}
