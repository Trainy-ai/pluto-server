import { useCallback, useState } from "react";

function readBoolFromStorage(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeBoolToStorage(key: string, value: boolean): void {
  try {
    if (value) {
      localStorage.setItem(key, "true");
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // localStorage unavailable
  }
}

/**
 * State hook that persists a boolean to localStorage under `key`.
 * Returns `[value, setValue]` matching the useState shape.
 * `setValue` writes through to storage on every call.
 */
export function useLocalStorageBool(key: string): [boolean, (value: boolean) => void] {
  const [value, setValueRaw] = useState(() => readBoolFromStorage(key));
  const setValue = useCallback(
    (next: boolean) => {
      setValueRaw(next);
      writeBoolToStorage(key, next);
    },
    [key],
  );
  return [value, setValue];
}
