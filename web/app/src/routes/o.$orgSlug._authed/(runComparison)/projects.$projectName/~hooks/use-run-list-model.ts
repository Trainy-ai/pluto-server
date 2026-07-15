import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import { LocalCache } from "@/lib/db/local-cache";
import type { Run } from "../~queries/list-runs";
import {
  collectServerFilteredRunIds,
  computeInViewRunIds,
  dropPhantomSelectedRuns,
  mergeLoadedRuns,
  narrowUrlPrefetchedRuns,
  overlayVisibleRuns,
  parseUrlRunIds,
  resolveUrlRunIds,
  type RunListPage,
} from "../~lib/run-list-model";

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
function useCachedSelectedRunIds(
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

/**
 * Owns the assembly of the runs-table's run collections from their
 * sources: `runs.list` pages, the `?runs=` URL prefetch, and the
 * IndexedDB-cached selection prefetch (read directly via
 * `useCachedSelectedRunIds` above). All merge rules are pure functions
 * in `~lib/run-list-model.ts`; this hook only wires them to queries.
 *
 * Split from `useTableViewPartition` because selection state
 * (`useSelectedRuns`) is derived FROM this hook's output — the partition
 * runs after selection exists.
 */
export function useRunListAssembly(params: {
  organizationId: string;
  projectName: string;
  /** Raw `?runs=` URL param (comma-separated display IDs or SQIDs). */
  urlRunsParam: string | undefined;
  /** `useListRuns` infinite-query data (pages of `runs.list`). */
  pages: ReadonlyArray<RunListPage | null | undefined> | undefined;
}) {
  const { organizationId, projectName, urlRunsParam, pages } = params;

  // Parse comma-separated run IDs from URL into array (may be display IDs like "MMP-1" or SQIDs)
  const rawUrlRunIds = useMemo(() => parseUrlRunIds(urlRunsParam), [urlRunsParam]);

  // Pre-fetch runs specified in URL params (they may not be in the paginated results)
  // The getByIds endpoint resolves both display IDs (MMP-1) and SQIDs to actual runs
  const { data: prefetchedUrlRuns } = useQuery(
    trpc.runs.getByIds.queryOptions(
      {
        organizationId,
        projectName,
        runIds: rawUrlRunIds ?? [],
      },
      {
        enabled: !!rawUrlRunIds?.length,
        // Same rationale as `prefetchedSelectedRuns` below — when a deselect
        // shrinks the `?runs=` URL param, this query rekeys, blinks `data`
        // to undefined, and `allVisibleRuns` briefly loses its untrimmed
        // overlay.
        placeholderData: keepPreviousData,
      },
    ),
  );

  // Map URL run IDs to SQIDs for selection matching.
  // URL may contain display IDs (MMP-1) but useSelectedRuns matches on SQIDs.
  const urlRunIds = useMemo(
    () => resolveUrlRunIds(rawUrlRunIds, prefetchedUrlRuns?.runs as Run[] | undefined),
    [rawUrlRunIds, prefetchedUrlRuns],
  );

  // Narrowed to ids still present in the CURRENT `?runs=` param — see
  // narrowUrlPrefetchedRuns for why stale prefetch rows must not count
  // as loaded table rows.
  const urlPrefetchedRuns = useMemo(
    () => narrowUrlPrefetchedRuns(prefetchedUrlRuns?.runs as Run[] | undefined, rawUrlRunIds),
    [prefetchedUrlRuns, rawUrlRunIds],
  );

  // Flatten the pages to get all runs, deduplicating by ID.
  // Also merges pre-fetched URL runs that may not be in paginated results.
  const allLoadedRuns = useMemo(
    () => mergeLoadedRuns(pages, urlPrefetchedRuns),
    [pages, urlPrefetchedRuns],
  );

  // Pre-fetch selected runs' FULL data via runs.getByIds.
  //
  // runs.list trims its per-run flat blobs to only visibleColumns, which
  // means rows arriving from the table don't have every config /
  // systemMetadata key the side-by-side diff view needs. We resolve that
  // here: always fetch full blobs for every selected run via getByIds
  // (which is not trimmed), regardless of whether the run also happens
  // to be on the current table page. Side-by-side then reads from this
  // source for guaranteed completeness.
  const cachedSelectedRunIds = useCachedSelectedRunIds(organizationId, projectName);

  const { data: prefetchedSelectedRuns } = useQuery(
    trpc.runs.getByIds.queryOptions(
      {
        organizationId,
        projectName,
        runIds: cachedSelectedRunIds,
      },
      {
        enabled: cachedSelectedRunIds.length > 0,
        // Hold the previous (untrimmed `_flatConfig` / `_flatSystemMetadata`)
        // response while the new key refetches. Without this, deselecting any
        // run blanks `data` for ~300ms, which makes `allVisibleRuns` swap its
        // selected entries down to the trimmed `runs.list` shape. The
        // `selectedRunsWithColors` "keep fresh" effect in use-selected-runs
        // then downgrades stored selection objects too — and in grouped+DOS
        // mode, `extractRunGroupValue` reads null for the missing config key
        // and the bucket tree briefly renders an "(unset)" leaf where the
        // real value used to be. (Reproduced with grouping by Group +
        // batch_size and deselecting any group/leaf/run.)
        placeholderData: keepPreviousData,
      },
    ),
  );

  // Merge pre-fetched selected runs AND URL-specified runs into the loaded
  // runs array — precedence rules documented on overlayVisibleRuns.
  const allVisibleRuns = useMemo(
    () =>
      overlayVisibleRuns(
        allLoadedRuns,
        urlPrefetchedRuns,
        prefetchedSelectedRuns?.runs as Run[] | undefined,
      ),
    [allLoadedRuns, urlPrefetchedRuns, prefetchedSelectedRuns],
  );

  // What the server's filtered runs.list actually matched (undefined until
  // it lands — that distinction is load-bearing, see collectServerFilteredRunIds).
  const serverFilteredRunIds = useMemo(() => collectServerFilteredRunIds(pages), [pages]);

  return {
    urlRunIds,
    allLoadedRuns,
    cachedSelectedRunIds,
    prefetchedSelectedRuns: prefetchedSelectedRuns?.runs as Run[] | undefined,
    allVisibleRuns,
    serverFilteredRunIds,
  };
}

/**
 * Selection-aware partition of the assembled run list: which rows the
 * table actually shows (`tableRuns`, with stale-prefetch phantoms dropped)
 * and which run ids count as "in view" for the search "Other matches"
 * dropdown. Rules are pure functions in `~lib/run-list-model.ts`.
 */
export function useTableViewPartition(params: {
  /** Assembled + metric-enriched run list (allVisibleRuns downstream). */
  runs: Run[];
  allLoadedRuns: Run[];
  prefetchedSelectedRuns: Run[] | undefined;
  selectedRunsWithColors: Record<string, { run: Run; color: string }>;
  showOnlySelected: boolean;
  pinSelectedToTop: boolean;
}) {
  const {
    runs,
    allLoadedRuns,
    prefetchedSelectedRuns,
    selectedRunsWithColors,
    showOnlySelected,
    pinSelectedToTop,
  } = params;

  const tableRuns = useMemo(
    () =>
      dropPhantomSelectedRuns(
        runs,
        prefetchedSelectedRuns,
        new Set(Object.keys(selectedRunsWithColors)),
        new Set(allLoadedRuns.map((r) => r.id)),
      ),
    [runs, prefetchedSelectedRuns, selectedRunsWithColors, allLoadedRuns],
  );

  const inViewRunIds = useMemo(
    () =>
      computeInViewRunIds({
        showOnlySelected,
        pinSelectedToTop,
        tableRuns,
        selectedRunIds: Object.keys(selectedRunsWithColors),
      }),
    [showOnlySelected, pinSelectedToTop, tableRuns, selectedRunsWithColors],
  );

  return { tableRuns, inViewRunIds };
}
