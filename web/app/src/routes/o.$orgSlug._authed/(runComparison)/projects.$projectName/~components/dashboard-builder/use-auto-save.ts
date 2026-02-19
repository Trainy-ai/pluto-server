import { useEffect, useCallback, useState } from "react";
import type { DashboardViewConfig } from "../../~types/dashboard-types";

function draftKey(viewId: string): string {
  return `dashboard-draft:${viewId}`;
}

interface UseDraftSaveOptions {
  config: DashboardViewConfig;
  viewId: string;
  isEditing: boolean;
  hasChanges: boolean;
}

interface UseDraftSaveResult {
  /** A draft exists in localStorage for this view */
  hasDraft: boolean;
  /** Restore the draft config from localStorage */
  restoreDraft: () => DashboardViewConfig | null;
  /** Clear the draft (call after successful server save) */
  clearDraft: () => void;
}

/**
 * Persists dashboard edits to localStorage as a draft.
 * This protects against accidental data loss (tab close, navigation, crash)
 * without immediately writing destructive changes to the server.
 */
export function useDraftSave({
  config,
  viewId,
  isEditing,
  hasChanges,
}: UseDraftSaveOptions): UseDraftSaveResult {
  const key = draftKey(viewId);

  // Initialized to false; the useEffect below sets the real value on mount / view change
  const [hasDraft, setHasDraft] = useState(false);

  // Re-check when viewId changes
  useEffect(() => {
    try {
      setHasDraft(localStorage.getItem(key) !== null);
    } catch {
      setHasDraft(false);
    }
  }, [key]);

  // Write draft to localStorage whenever config changes during editing
  useEffect(() => {
    if (!isEditing || !hasChanges) {
      return;
    }

    try {
      localStorage.setItem(key, JSON.stringify(config));
      setHasDraft(true);
    } catch {
      // localStorage full or unavailable — silent fallback
    }
  }, [key, config, isEditing, hasChanges]);

  const restoreDraft = useCallback((): DashboardViewConfig | null => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw) as DashboardViewConfig;
    } catch {
      return null;
    }
  }, [key]);

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
    setHasDraft(false);
  }, [key]);

  return { hasDraft, restoreDraft, clearDraft };
}
