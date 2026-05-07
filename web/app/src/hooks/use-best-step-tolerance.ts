import { useCallback, useEffect, useState } from "react";

/**
 * Per-project, per-browser "best step (with image)" tolerance — the K
 * window passed to runs.metricBestSteps for the (with image) pin
 * variants. Each metric row whose nearest image is more than K steps
 * away is dropped from the argmin/argmax search.
 *
 * Stored in localStorage under `bestStepTolerance:<projectName>` so
 * different projects with different log cadences each carry their own
 * value. Defaults to 20 when no value has been set or the stored value
 * is invalid.
 *
 * No backend persistence — one user tweaking K shouldn't reshape pins
 * for the rest of the team.
 */
const DEFAULT_TOLERANCE = 20;

function storageKey(projectName: string): string {
  return `bestStepTolerance:${projectName}`;
}

function readStored(projectName: string): number {
  try {
    const raw = localStorage.getItem(storageKey(projectName));
    if (raw == null) return DEFAULT_TOLERANCE;
    const n = parseInt(raw, 10);
    return Number.isNaN(n) || n < 0 ? DEFAULT_TOLERANCE : n;
  } catch {
    return DEFAULT_TOLERANCE;
  }
}

export function useBestStepTolerance(
  projectName: string,
): readonly [number, (next: number) => void] {
  const [value, setValue] = useState<number>(() => readStored(projectName));

  // Re-read when the user navigates between projects — the same hook
  // instance gets a new projectName prop without unmounting.
  useEffect(() => {
    setValue(readStored(projectName));
  }, [projectName]);

  const update = useCallback(
    (next: number) => {
      const clamped = Number.isFinite(next) && next >= 0 ? Math.floor(next) : DEFAULT_TOLERANCE;
      setValue(clamped);
      try {
        localStorage.setItem(storageKey(projectName), String(clamped));
      } catch {
        // localStorage may be unavailable (private mode, quota, etc.)
        // — we still keep the in-memory value for this session.
      }
    },
    [projectName],
  );

  return [value, update] as const;
}
