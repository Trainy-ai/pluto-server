import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "fps-monitor-enabled";

const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "1";
}

function getServerSnapshot(): boolean {
  return false;
}

export function useFpsMonitorEnabled() {
  const enabled = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const setEnabled = useCallback((value: boolean) => {
    localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    listeners.forEach((l) => l());
  }, []);

  return { enabled, setEnabled } as const;
}
