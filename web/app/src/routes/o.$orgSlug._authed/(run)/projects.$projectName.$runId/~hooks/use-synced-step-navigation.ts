import React, { useState, useEffect, useCallback, useId } from "react";
import { useStepNavigation } from "./use-step-navigation";
import { useImageStepSyncContext } from "../~context/image-step-sync-context";

interface StepData {
  step: number;
}

interface UseSyncedStepNavigationReturn {
  currentStepIndex: number;
  currentStepValue: number;
  availableSteps: number[];
  totalSteps: number;
  goToStepIndex: (index: number) => void;
  goToStepValue: (value: number) => number;
  nextStep: () => void;
  prevStep: () => void;
  hasMultipleSteps: () => boolean;
  isFirstStep: () => boolean;
  isLastStep: () => boolean;
  /** Whether this panel is synced to the group */
  isLocked: boolean;
  /** Toggle sync for this panel */
  setIsLocked: (locked: boolean) => void;
  /** Whether the sync context exists (provider is present) */
  hasSyncContext: boolean;
  /** Whether the global sync is enabled */
  isSyncEnabled: boolean;
  /** Toggle global sync */
  setIsSyncEnabled: (enabled: boolean) => void;
}

/**
 * Step navigation hook with optional cross-panel synchronization.
 *
 * When used inside an ImageStepSyncProvider and the panel is "locked":
 * - Step changes are broadcast to other locked panels in the same section
 * - Incoming step broadcasts are received and applied (snapped to nearest available step)
 *
 * When not locked (or no provider), behaves exactly like useStepNavigation.
 */
export function useSyncedStepNavigation<T extends StepData>(
  data: T[],
): UseSyncedStepNavigationReturn {
  const panelId = useId();
  const syncContext = useImageStepSyncContext();

  const nav = useStepNavigation(data);
  const [isLocked, setIsLocked] = useState(true);

  // Register listener for incoming step broadcasts
  useEffect(() => {
    if (!syncContext || !isLocked) return;

    const handleStepBroadcast = (stepValue: number) => {
      nav.goToStepValue(stepValue);
    };

    syncContext.registerListener(panelId, handleStepBroadcast);
    return () => {
      syncContext.unregisterListener(panelId);
    };
  }, [syncContext, isLocked, panelId, nav.goToStepValue]);

  // When data first becomes available, snap to the current synced step value (if any).
  // This handles the case where a panel mounts after other panels have already navigated.
  const hasSnappedRef = React.useRef(false);
  useEffect(() => {
    if (
      !hasSnappedRef.current &&
      syncContext?.isSyncEnabled &&
      isLocked &&
      syncContext.syncedStepValue !== null &&
      nav.availableSteps.length > 0
    ) {
      hasSnappedRef.current = true;
      nav.goToStepValue(syncContext.syncedStepValue);
    }
  }, [syncContext, isLocked, nav.availableSteps, nav.goToStepValue]);

  // Wrap navigation to broadcast when locked
  const goToStepIndex = useCallback(
    (index: number) => {
      const clampedIndex = Math.max(0, Math.min(nav.availableSteps.length - 1, index));
      nav.goToStepIndex(clampedIndex);
      if (syncContext?.isSyncEnabled && isLocked) {
        const stepValue = nav.availableSteps[clampedIndex];
        if (stepValue !== undefined) {
          syncContext.broadcastStep(stepValue, panelId);
        }
      }
    },
    [nav.goToStepIndex, nav.availableSteps, syncContext, isLocked, panelId],
  );

  const goToStepValue = useCallback(
    (value: number): number => {
      const actual = nav.goToStepValue(value);
      if (syncContext?.isSyncEnabled && isLocked) {
        syncContext.broadcastStep(actual, panelId);
      }
      return actual;
    },
    [nav.goToStepValue, syncContext, isLocked, panelId],
  );

  const nextStep = useCallback(() => {
    const nextIndex = Math.min(nav.availableSteps.length - 1, nav.currentStepIndex + 1);
    goToStepIndex(nextIndex);
  }, [nav.availableSteps.length, nav.currentStepIndex, goToStepIndex]);

  const prevStep = useCallback(() => {
    const prevIndex = Math.max(0, nav.currentStepIndex - 1);
    goToStepIndex(prevIndex);
  }, [nav.currentStepIndex, goToStepIndex]);

  return {
    currentStepIndex: nav.currentStepIndex,
    currentStepValue: nav.currentStepValue,
    availableSteps: nav.availableSteps,
    totalSteps: nav.totalSteps,
    goToStepIndex,
    goToStepValue,
    nextStep,
    prevStep,
    hasMultipleSteps: nav.hasMultipleSteps,
    isFirstStep: nav.isFirstStep,
    isLastStep: nav.isLastStep,
    isLocked,
    setIsLocked,
    hasSyncContext: syncContext !== null,
    isSyncEnabled: syncContext?.isSyncEnabled ?? false,
    setIsSyncEnabled: syncContext?.setIsSyncEnabled ?? (() => {}),
  };
}
