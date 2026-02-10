import { useState, useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "chart-line-width";
const DEFAULT_LINE_WIDTH = 1.5;

// Shared listeners for cross-component sync via useSyncExternalStore
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot(): number {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === null) return DEFAULT_LINE_WIDTH;
  const parsed = parseFloat(stored);
  return isNaN(parsed) ? DEFAULT_LINE_WIDTH : parsed;
}

function getServerSnapshot(): number {
  return DEFAULT_LINE_WIDTH;
}

export function useChartLineWidth() {
  const lineWidth = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setLineWidth = useCallback((value: number) => {
    localStorage.setItem(STORAGE_KEY, String(value));
    // Notify all subscribers
    listeners.forEach((l) => l());
  }, []);

  return { lineWidth, setLineWidth } as const;
}
