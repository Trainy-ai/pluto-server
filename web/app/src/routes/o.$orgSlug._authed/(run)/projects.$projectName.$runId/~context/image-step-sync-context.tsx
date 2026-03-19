import React, {
  createContext,
  useContext,
  useCallback,
  useRef,
  useState,
} from "react";

// ============================
// Types
// ============================

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

  const contextValue = React.useMemo<ImageStepSyncContextValue>(
    () => ({
      syncedStepValue,
      isSyncEnabled,
      setIsSyncEnabled,
      broadcastStep,
      registerListener,
      unregisterListener,
    }),
    [
      syncedStepValue,
      isSyncEnabled,
      broadcastStep,
      registerListener,
      unregisterListener,
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
