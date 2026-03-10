import { useState, useEffect, useMemo } from "react";
import { LocalCache } from "@/lib/db/local-cache";
import type { Run } from "../~queries/list-runs";

type Color = string;
type RunId = string;

/**
 * Reuse the same IndexedDB database and store as useSelectedRuns.
 * This must match the db name, store name, and key format exactly.
 */
const runCacheDb = new LocalCache<{
  colors: Record<RunId, Color>;
  selectedRuns: Record<RunId, { run: Run; color: Color }>;
}>(
  "run-selection-db",
  "run-selections",
  10 * 1024 * 1024,
);

function getStorageKey(organizationId: string, projectName: string): string {
  return `run-selection-data:${organizationId}:${projectName}`;
}

/**
 * Reads cached selected run IDs from IndexedDB independently of the main
 * useSelectedRuns hook. This breaks the circular dependency:
 *
 *   allLoadedRuns → runs → useSelectedRuns → selectedRunsWithColors
 *                                                    ↑
 *                               (we need IDs here to fetch missing runs)
 *
 * By reading the cache directly, we can fire a getByIds query for selected
 * runs not in paginated results, then merge them into allLoadedRuns before
 * the enrichment pipeline runs.
 */
export function useCachedSelectedRunIds(
  organizationId: string,
  projectName: string,
): string[] {
  const storageKey = useMemo(
    () => getStorageKey(organizationId, projectName),
    [organizationId, projectName],
  );

  const [cachedIds, setCachedIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const cached = await runCacheDb.getData(storageKey);
        if (cancelled) return;
        if (cached?.data?.selectedRuns) {
          setCachedIds(Object.keys(cached.data.selectedRuns));
        } else {
          setCachedIds([]);
        }
      } catch {
        if (!cancelled) setCachedIds([]);
      }
    };

    setCachedIds([]);
    load();

    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  return cachedIds;
}
