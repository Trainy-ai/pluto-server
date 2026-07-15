import type { Run } from "../~queries/list-runs";

/**
 * Pure merge/partition rules for the runs-table's layered run collections.
 *
 * The table's notion of "which runs exist / which are visible" is assembled
 * from several sources that update on different schedules:
 *
 *   server pages (runs.list)  → trimmed rows for the current filter/sort/page
 *   ?runs= URL prefetch       → untrimmed rows for URL-selected runs
 *   IndexedDB-cached selection prefetch → untrimmed rows for selected runs
 *   live selection state      → what the user has checked right now
 *
 * Every rule for combining them lives here as a pure function so the
 * invariants are unit-testable and there is exactly one place to change
 * them. The hooks in `~hooks/use-run-list-model.ts` wire these to queries.
 */

/** Minimal structural shape of a `runs.list` infinite-query page. */
export interface RunListPage {
  runs?: Run[] | null;
}

/**
 * Parse the comma-separated `?runs=` URL param (entries may be display IDs
 * like "MMP-1" or SQIDs). Returns undefined when the param is absent/empty.
 */
export function parseUrlRunIds(urlRunsParam: string | undefined): string[] | undefined {
  if (!urlRunsParam) return undefined;
  const ids = urlRunsParam.split(",").map((id) => id.trim()).filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

/**
 * Map URL run IDs to SQIDs for selection matching.
 * URL may contain display IDs (MMP-1) but useSelectedRuns matches on SQIDs.
 * Passes the raw ids through until the prefetch resolves.
 */
export function resolveUrlRunIds(
  rawUrlRunIds: string[] | undefined,
  prefetchedRuns: Run[] | undefined,
): string[] | undefined {
  if (!rawUrlRunIds?.length) return undefined;
  if (!prefetchedRuns?.length) return rawUrlRunIds; // pass through until resolved
  // Build display-ID → SQID mapping from prefetched runs
  const displayIdToSqid = new Map<string, string>();
  for (const run of prefetchedRuns) {
    // Map SQID to itself (for when URL already contains SQIDs)
    displayIdToSqid.set(run.id, run.id);
    // Map display ID (e.g., "MMP-179") to SQID
    if (run.number != null && run.project?.runPrefix) {
      displayIdToSqid.set(`${run.project.runPrefix}-${run.number}`, run.id);
    }
  }
  const resolved = rawUrlRunIds
    .map((id) => displayIdToSqid.get(id))
    .filter((id): id is string => id != null);
  return resolved.length > 0 ? resolved : undefined;
}

/**
 * URL-prefetched runs narrowed to ids still present in the CURRENT
 * `?runs=` param. The prefetch query holds its last response after the
 * param shrinks or empties (keepPreviousData + the query disabling on an
 * empty param), which is wanted for the untrimmed-blob overlay — but a
 * run that left the URL selection must stop counting as a loaded table
 * row. Stale entries otherwise linger in `allLoadedRuns`/`inViewRunIds`,
 * and the search "Other matches" dropdown locks them as "In table" even
 * though the table no longer renders them (auto-select 5 → deselect all →
 * filter + search reproduces this).
 */
export function narrowUrlPrefetchedRuns(
  prefetchedRuns: Run[] | undefined,
  rawUrlRunIds: string[] | undefined,
): Run[] {
  if (!prefetchedRuns?.length || !rawUrlRunIds?.length) return [];
  // URL entries may be SQIDs or display IDs (e.g. "MMP-179") — accept both.
  const wanted = new Set(rawUrlRunIds);
  return prefetchedRuns.filter((run) => {
    if (wanted.has(run.id)) return true;
    if (run.number != null && run.project?.runPrefix) {
      return wanted.has(`${run.project.runPrefix}-${run.number}`);
    }
    return false;
  });
}

/**
 * Flatten the pages to get all runs, deduplicating by ID.
 * Also merges pre-fetched URL runs that may not be in paginated results —
 * without that merge, runs specified via ?runs= that aren't on the current
 * page can't be found by buildSelectionFromUrlParams, causing the URL
 * selection to silently fail and fall back to default auto-select.
 */
export function mergeLoadedRuns(
  pages: ReadonlyArray<RunListPage | null | undefined> | undefined,
  urlPrefetchedRuns: Run[],
): Run[] {
  if (!pages) return [];

  const allRuns = pages.flatMap((page) => {
    if (!page) return [];
    return page.runs || [];
  });

  // Deduplicate by run ID
  const uniqueRuns = new Map<string, Run>();
  allRuns.forEach((run) => {
    if (run.id && !uniqueRuns.has(run.id)) {
      uniqueRuns.set(run.id, run);
    }
  });

  // Merge pre-fetched URL runs (may not be in paginated results)
  for (const run of urlPrefetchedRuns) {
    if (run.id && !uniqueRuns.has(run.id)) {
      uniqueRuns.set(run.id, run);
    }
  }

  return Array.from(uniqueRuns.values());
}

/**
 * Merge pre-fetched selected runs AND URL-specified runs into the loaded
 * runs array.
 *
 * Precedence (highest first):
 *   prefetchedSelectedRuns  (full `_flatConfig` / `_flatSystemMetadata` blobs)
 *   urlPrefetchedRuns       (also full blobs — from getByIds, narrowed to the
 *                            current ?runs= param so departed runs can't
 *                            re-enter as ghost rows)
 *   allLoadedRuns           (from runs.list; blobs trimmed to visibleColumns)
 *
 * Selected runs must use the prefetched (untrimmed) version so downstream
 * consumers — notably the side-by-side diff view — see every config and
 * systemMetadata key, not just the runs-table columns. A plain "add if
 * missing" merge would silently drop to the trimmed version whenever the
 * selected run happened to also be on the current table page.
 */
export function overlayVisibleRuns(
  allLoadedRuns: Run[],
  urlPrefetchedRuns: Run[],
  prefetchedSelectedRuns: Run[] | undefined,
): Run[] {
  const byId = new Map<string, Run>();
  // Seed with trimmed rows first...
  for (const r of allLoadedRuns) byId.set(r.id, r);
  // ...then overwrite with untrimmed rows where they exist.
  for (const r of urlPrefetchedRuns) byId.set(r.id, r);
  for (const r of prefetchedSelectedRuns ?? []) byId.set(r.id, r);
  return byId.size === allLoadedRuns.length
    ? allLoadedRuns.map((r) => byId.get(r.id) ?? r)
    : Array.from(byId.values());
}

/**
 * IDs the server's filtered `runs.list` actually returned for the
 * current filter. Used by data-table to draw the "Selected runs below"
 * divider between filter-matched rows and sticky-appended selected-
 * but-not-matched rows. Built from pages so it grows naturally as more
 * pages are fetched.
 *
 * Returns `undefined` — NOT an empty Set — while `runs.list` hasn't
 * landed yet. That signal distinction is load-bearing downstream:
 * `intersectWithServerFilter(runs, undefined)` short-circuits to
 * `runs`, whereas an empty Set means "server matched nothing" and
 * filters everything out. Without this, flat mode with an active
 * filter chip flashes to zero rows on first load — even though
 * `runs` (= allVisibleRuns) already has URL-prefetched selection
 * runs — because the intersect kicks in before `pages` is
 * populated. See Cursor Bugbot review on PR #524.
 */
export function collectServerFilteredRunIds(
  pages: ReadonlyArray<RunListPage | null | undefined> | undefined,
): Set<string> | undefined {
  if (!pages) return undefined;
  const ids = new Set<string>();
  for (const p of pages) {
    if (!p) continue;
    for (const r of p.runs ?? []) if (r.id) ids.add(r.id);
  }
  return ids;
}

/**
 * Filter out true phantom runs from prefetchedSelectedRuns.
 * useCachedSelectedRunIds reads from IndexedDB once on mount and doesn't
 * update within the session, so prefetchedSelectedRuns can contain runs
 * that aren't on the current runs.list page AND aren't selected anymore
 * (e.g. cached from a prior session). Those are phantoms and would render
 * as ghost rows. But a run that's also on the current page must NOT be
 * filtered: when the user deselects a URL-linked run, it stays in
 * prefetchedSelectedRuns (the getByIds cache doesn't refetch instantly)
 * but it's still a legitimate row on page 1 of runs.list — dropping it
 * makes the row vanish from the table the moment you uncheck it.
 */
export function dropPhantomSelectedRuns(
  runs: Run[],
  prefetchedSelectedRuns: Run[] | undefined,
  selectedRunIds: ReadonlySet<string>,
  loadedPageRunIds: ReadonlySet<string>,
): Run[] {
  if (!prefetchedSelectedRuns?.length) return runs;
  const prefetchedIds = new Set(prefetchedSelectedRuns.map((r) => r.id));
  return runs.filter((r) => {
    // Not from the prefetched-selected set → always a real row.
    if (!prefetchedIds.has(r.id)) return true;
    // Currently selected → keep (user wants it visible).
    if (selectedRunIds.has(r.id)) return true;
    // On the current runs.list page → keep (it's a real table row, the
    // prefetch just happened to overlap).
    if (loadedPageRunIds.has(r.id)) return true;
    // Otherwise: phantom from a stale IndexedDB cache; drop it.
    return false;
  });
}

/**
 * Which run IDs are actually rendered in the table right now. The set
 * depends on whether "Display only selected" is on:
 * - on  → table renders only selected runs (mergeSelectedRuns)
 * - off → table renders tableRuns (server fetch) plus any selected runs
 *         sticky-appended via ensureSelectedRunsIncluded
 * Used to partition "Other matches" hits into in-view vs out-of-view.
 *
 * When pin-selected-to-top is on, the user's perception of "in view"
 * is the pinned (= selected) block at the top — the unpinned rows
 * below are just a paginated slice the user is searching through.
 * Treat them as out-of-view so the dropdown surfaces non-selected
 * search matches the same way Display-Only-Selected does.
 */
export function computeInViewRunIds(params: {
  showOnlySelected: boolean;
  pinSelectedToTop: boolean;
  tableRuns: Run[];
  selectedRunIds: ReadonlyArray<string>;
}): Set<string> {
  const { showOnlySelected, pinSelectedToTop, tableRuns, selectedRunIds } = params;
  const ids = new Set<string>();
  if (showOnlySelected || pinSelectedToTop) {
    for (const id of selectedRunIds) ids.add(id);
  } else {
    for (const r of tableRuns) ids.add(r.id);
    for (const id of selectedRunIds) ids.add(id);
  }
  return ids;
}
