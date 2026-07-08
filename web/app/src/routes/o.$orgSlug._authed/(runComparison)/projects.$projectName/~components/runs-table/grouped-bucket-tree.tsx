import { Fragment, useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronRight, ChevronDown, ChevronLeft, Loader2, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { TableRow, TableCell } from "@/components/ui/table";
import { groupFieldLabel } from "./group-by-utils";
import { effectiveLeafRunTotal } from "./leaf-run-total";
import { RunRow } from "./components/run-row";
import { computeRowSelection } from "./selection-utils";
import { bucketColorFor } from "./bucket-color";
import {
  BucketSelectionProvider,
  useBucketSelectionSignal,
  isBucketCovered,
  type BucketSelectionSignal,
} from "@/hooks/use-bucket-selection-context";
import { computeRunGroupTrail } from "@/lib/compute-run-group-key";
import type { Run } from "../../~queries/list-runs";
import { useMetricSummaries } from "../../~queries/metric-summaries";

/** Stable empty array so BucketRuns' `useMetricSummaries` call keeps
 *  its identity across renders when the caller doesn't supply specs.
 *  Passing a fresh `[]` would rekey the hook's `metrics` input every
 *  render and re-run its wipe/refetch logic pointlessly. */
const EMPTY_METRIC_SPECS: Array<{ logName: string; aggregation: "MIN" | "MAX" | "AVG" | "LAST" | "VARIANCE" }> = [];

/** How many bucket values / runs we ask the server for per page. */
const PAGE_SIZE = 10;

type RunStatus = "RUNNING" | "COMPLETED" | "FAILED" | "TERMINATED" | "CANCELLED";

interface BaseFilters {
  search?: string;
  tags?: string[];
  status?: RunStatus[];
  dateFilters?: any[];
  fieldFilters?: any[];
  metricFilters?: any[];
  systemFilters?: any[];
}

interface GroupedBucketTreeProps {
  organizationId: string;
  organizationSlug: string;
  projectName: string;
  groupBy: string[];
  /** Expanded bucket trails (`pathKey(filters)`). Lifted at the page
   *  level so saved views can persist this. */
  expanded: string[];
  onExpandedChange: (next: string[]) => void;
  baseFilters: BaseFilters;
  colSpan: number;
  /** TanStack column defs from the parent table — passed verbatim so
   *  bucket-run rows reuse the user's full column config (visibility eye,
   *  name, tags, notes, custom config/metric columns, …). */
  columns: ColumnDef<Run, any>[];
  /** Ordered column ids (same source of truth as the flat table). */
  columnOrder: string[];
  /** Sticky-column offsets keyed by column id. */
  pinnedColumnMap: Record<string, { left: number; isLast: boolean }>;
  /** Lifted at the parent so selection toggled inside any bucket
   *  propagates to the top-level color/visibility state. */
  selectedRunsWithColors: Record<string, { run: Run; color: string }>;
  hiddenRunIds: Set<string>;
  tableBodyRef: React.RefObject<HTMLTableSectionElement | null>;
  /** Push a per-run color override into the page's color state so
   *  charts auto-pick up the bucket color. Mirrors what the manual
   *  color picker on the name column does. */
  onColorChange: (runId: string, color: string) => void;
  /** Fan-out target for the bucket-header eye + X actions. Same
   *  shape as the per-run handler in columns.tsx: takes a third
   *  optional `runFallback` so adding runs that aren't in the flat
   *  page (the case when bulk-selecting a collapsed bucket) actually
   *  lands in `selectedRunsWithColors` instead of silently no-opping
   *  (see use-selected-runs.ts:571-572). */
  onSelectionChange: (
    runId: string,
    isSelected: boolean,
    runFallback?: Run,
  ) => void;
  /** Bulk hidden-state setter — fanned out by the bucket-eye toggle
   *  so the group hide is just N per-run hides under the hood. This
   *  lets a single child run override the group's hidden state
   *  (clicking its eye unhides it without freeing every sibling). */
  onSetRunsHidden: (runIds: string[], hidden: boolean) => void;
  /** Pixels added to the first column's width by the grouped colgroup.
   *  Forwarded to each run row so it can push the eye/selection chip
   *  to the right end of the widened cell. */
  runFirstCellPaddingLeft?: number;
  /** Root-level (depth=0) pagination, driven by the table footer.
   *  When provided, the top-level bucket query uses
   *  `limit = rootPageSize`, `offset = rootPageIndex * rootPageSize`
   *  and the per-level "Show N more" affordance is hidden for that
   *  level only — nested levels keep progressive disclosure since
   *  they're inside an expanded parent. Leaving these undefined
   *  falls back to the pre-Phase-10-D behaviour (local PAGE_SIZE
   *  with a "Show N more" button at every depth). */
  rootPageSize?: number;
  rootPageIndex?: number;
  /** Fired whenever the root query's `hasMore` flips, so the footer
   *  can disable Next at the last page. */
  onRootHasMoreChange?: (hasMore: boolean) => void;
  /** Surface the REAL total distinct group count at root — i.e. the
   *  count of unique bucket values across the entire project (after
   *  toolbar filter / search). Different from onRootTotalCountChange
   *  below, which fires a value tuned for the footer's
   *  `ceil(total / pageSize)` math (inflated to `pages * pageSize`
   *  under Pin so the footer renders the right page count when each
   *  page only shows `pageSize - pinnedSize` new unselected groups).
   *  Used by the toolbar's "X of Y groups selected" label. */
  onRootRealTotalCountChange?: (total: number) => void;
  /** Fired whenever the root query's `totalCount` changes (total
   *  distinct top-level buckets matching the filter set, including
   *  the `(unset)` bucket where applicable). Lets the footer render
   *  wandb-style `1 / N` instead of just `Page N`. */
  onRootTotalCountChange?: (total: number) => void;
  /** Fired whenever the visible root-level buckets change. Lets the
   *  visibility-options popover render "Select all on page (N) (M
   *  runs)" buttons and iterate the bucket filter paths to call
   *  selectAllInBucket / deselectBucket without re-fetching anything.
   *  `subgroupCount` is the immediate next-level distinct-value count
   *  for this bucket (only present when groupBy has 2+ levels — the
   *  server's distinctGroupValues subgroupsByValue field). At
   *  groupBy.length === 2 the immediate next IS the leaf, so the
   *  toolbar can render "(N groups) (X leaf groups) (M runs)". */
  onVisibleRootBucketsChange?: (
    buckets: Array<{
      value: string | null;
      count: number;
      subgroupCount?: number;
      pathFilters: { field: string; value: string | null }[];
    }>,
  ) => void;
  /** When true, every level of the bucket tree filters its visible
   *  buckets and leaf runs to "selected-containing" only — i.e. any
   *  row that has a colored eye icon stays; the rest disappear. The
   *  selected-containing decision uses `selectedAncestorPaths` to
   *  avoid touching the server. Leaf-run rendering switches to a
   *  client-side slice of `selectedRunsWithColors` so it doesn't
   *  paginate against runs we've decided not to show. */
  showOnlySelected?: boolean;
  /** When true, every level reorders its buckets / leaf runs so
   *  selected-containing items come first. The outer (root) level
   *  additionally implements the flat-table overflow semantics — when
   *  the number of selected-containing top-level buckets exceeds
   *  pageSize, all of them appear on page 1 (no further pages of
   *  unselected buckets), mirroring how flat-mode Pin-selected-to-top
   *  with selectedCount ≥ pageSize collapses to "1 / 1". Nested
   *  levels and leaf runs reorder within their existing inline
   *  paginator without overflow. */
  pinSelectedToTop?: boolean;
  /** Per-depth Map from encoded ancestor path → count of selected
   *  runs at that path. See computeSelectedAncestorPaths. Used by:
   *   - DOS: drives the derived bucket list when the server's
   *     paginated page doesn't include the selected-containing values
   *     (the selected-name buckets in a `groupBy=name` view almost
   *     always sit on a later server page, sorted by count desc).
   *   - Pin: O(1) membership check (`.has(path)`) to decide which
   *     buckets float to the top, and `.get(path)` for the synthetic
   *     bucket count when we render a pinned bucket that's not on
   *     the server's current page.
   *  Empty array when groupBy is empty or there are no selections. */
  selectedAncestorPaths?: Array<Map<string, number>>;
  /** Selected run IDs as a Set, so leaf-run reordering / filtering
   *  can decide membership in O(1). Built once in the parent
   *  (use-data-table-state.ts) from selectedRunsWithColors. */
  selectedRunIds?: Set<string>;
  /** Threaded into `distinctGroupValues` so every bucket level orders
   *  by the aggregate of the sort column over its descendant runs
   *  (W&B parity). Unset → buckets fall back to count-desc. The
   *  backend picks the aggregator from `sortSource`/`sortDataType`
   *  (number/metric → AVG, date → AVG(epoch), text → MIN). */
  sortField?: string;
  sortSource?: "system" | "config" | "systemMetadata" | "metric";
  sortDirection?: "asc" | "desc";
  sortAggregation?: "MIN" | "MAX" | "AVG" | "LAST" | "VARIANCE";
  /** Per-column aggregates to compute per bucket. Powers the W&B-style
   *  group-row values shown to the right of the sticky label. Text
   *  columns come back as null slots and the frontend renders them
   *  blank. Preserved end-to-end so `aggregates[i]` lines up with
   *  entry `i` here. */
  aggregateColumns?: Array<{
    source: "system" | "config" | "systemMetadata" | "metric";
    field: string;
    aggregation?: "MIN" | "MAX" | "AVG" | "LAST" | "VARIANCE";
    dataType?: "text" | "number" | "date" | "option";
  }>;
  /** TanStack column-id → `{ idx, kind }`. `idx` is the slot in each
   *  bucket row's `aggregates` array; `kind` picks the formatter
   *  (number, date, or blank). Built once in data-table.tsx parallel
   *  to `aggregateColumns`. */
  aggregateColIdIndex?: Map<string, { idx: number; kind: "number" | "date" | "blank" }>;
  /** Metric columns currently visible. Threaded to `BucketRuns` so
   *  leaf-run rows can fire their own metric-summaries fetch and
   *  actually display metric values instead of "-". Flat-mode wires
   *  the equivalent up for `allVisibleRuns` in index.tsx. */
  metricColumnSpecs?: Array<{ logName: string; aggregation: "MIN" | "MAX" | "AVG" | "LAST" | "VARIANCE" }>;
}

interface GroupFilter {
  field: string;
  value: string | null;
}

function pathKey(filters: GroupFilter[]): string {
  return JSON.stringify(filters);
}

export function GroupedBucketTree(props: GroupedBucketTreeProps) {
  // Materialize the array form into a Set for O(1) `has` during
  // recursion. Re-runs whenever the parent's array changes.
  const expandedSet = useMemo(() => new Set(props.expanded), [props.expanded]);
  const onExpandedChange = props.onExpandedChange;
  const toggleExpanded = useCallback(
    (key: string) => {
      const next = new Set(expandedSet);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      onExpandedChange(Array.from(next));
    },
    [expandedSet, onExpandedChange],
  );

  // Compute the leaf pathKeys of every currently-selected run by
  // running each run's `(name|status|tags|_flatConfig|...)` through
  // the same logic the backend uses for grouping. We split into TWO
  // sets: `selected` (any selected run) and `visible` (selected AND
  // not in `hiddenRunIds`). Bucket headers read both via context to
  // render the 3-state eye correctly — including the cascade where a
  // parent of an all-per-run-hidden leaf shows the closed Eye.
  //
  // We also build a per-run leaf-pathKey index so the bucket-header
  // X handler can fan out a deselect to every descendant run in O(N).
  const {
    selectedRunsWithColors,
    hiddenRunIds,
    groupBy,
    onSelectionChange,
    onSetRunsHidden,
    organizationId,
    projectName,
    baseFilters,
  } = props;
  const onSelectionChangeRef = useRef(onSelectionChange);
  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);
  const onSetRunsHiddenRef = useRef(onSetRunsHidden);
  useEffect(() => {
    onSetRunsHiddenRef.current = onSetRunsHidden;
  }, [onSetRunsHidden]);
  // Imperative fetch for "select all in bucket" — uses the React
  // Query cache so a subsequent `useQuery` for the same bucket
  // doesn't re-hit the network.
  const queryClient = useQueryClient();
  const bucketSelectionSignal = useMemo<BucketSelectionSignal>(() => {
    if (groupBy.length === 0) {
      return {
        selected: new Set(),
        visible: new Set(),
        deselectBucket: () => {},
        selectAllInBucket: async () => {},
        setBucketHidden: () => {},
      };
    }
    // Pre-build the FULL covering sets — for each selected run, we
    // walk its trail and insert EVERY ancestor pathKey (depth 1 → N)
    // into the set. After this, every `BucketHeaderRow.render()` can
    // do `selected.has(myPathKey)` in O(1) instead of an O(N) prefix
    // scan. With M buckets and N selected runs, this collapses
    // 2 * M * N string comparisons per render into 2 * M map lookups
    // — the bucket-tree's eye icons all flip in a single paint.
    const selected = new Set<string>();
    const visible = new Set<string>();
    // Parallel `[runId, leafPathKey]` array, walked by deselectBucket
    // / setBucketHidden on CLICK only (rare, so the O(N) scan there
    // stays). Render-hot paths use the precomputed sets above.
    const runsByLeafKey: Array<{ runId: string; leafKey: string }> = [];
    for (const entry of Object.values(selectedRunsWithColors)) {
      const trail = computeRunGroupTrail(entry.run, groupBy);
      const leafKey = JSON.stringify(trail);
      const isVisible = !hiddenRunIds.has(entry.run.id);
      runsByLeafKey.push({ runId: entry.run.id, leafKey });
      // Insert every ancestor pathKey (depth 1 … trail.length) so a
      // BucketHeaderRow at any depth can hit with a direct `has`.
      for (let depth = 1; depth <= trail.length; depth++) {
        const ancestorKey = JSON.stringify(trail.slice(0, depth));
        selected.add(ancestorKey);
        if (isVisible) visible.add(ancestorKey);
      }
    }
    const deselectBucket = (bucketPathKey: string) => {
      const prefix = bucketPathKey.endsWith("]")
        ? bucketPathKey.slice(0, -1) + ","
        : null;
      for (const { runId, leafKey } of runsByLeafKey) {
        const isMatch =
          leafKey === bucketPathKey ||
          (prefix != null && leafKey.startsWith(prefix));
        if (isMatch) {
          onSelectionChangeRef.current(runId, false);
        }
      }
    };
    const selectAllInBucket = async (
      bucketFilters: Array<{ field: string; value: string | null }>,
    ) => {
      // runs.list caps `limit` at 200 per page, so paginate until
      // we exhaust the bucket. Outer cap of 10 pages = 2000 runs;
      // larger buckets would benefit from a dedicated bulk-ids proc
      // but realistic comparison sizes stay well under this.
      const PER_PAGE = 200;
      const MAX_PAGES = 10;
      try {
        for (let page = 0; page < MAX_PAGES; page++) {
          const result = (await queryClient.fetchQuery({
            ...trpc.runs.list.queryOptions({
              organizationId,
              projectName,
              groupFilters: bucketFilters,
              ...baseFilters,
              limit: PER_PAGE,
              offset: page * PER_PAGE,
            }),
          })) as { runs: Run[]; hasMore?: boolean } | undefined;
          if (!result?.runs?.length) return;
          for (const r of result.runs) {
            // Pass the run object as the 3rd arg — handleRunSelection
            // silently no-ops if the run isn't in `currentRuns` and
            // no fallback is supplied (use-selected-runs.ts:571-572).
            // Bucket runs typically aren't in the flat page slice.
            onSelectionChangeRef.current(r.id, true, r);
          }
          if (!result.hasMore || result.runs.length < PER_PAGE) return;
        }
      } catch (err) {
        console.error(
          "[grouped-bucket-tree] selectAllInBucket failed:",
          err,
        );
      }
    };
    const setBucketHidden = (bucketPathKey: string, hidden: boolean) => {
      const prefix = bucketPathKey.endsWith("]")
        ? bucketPathKey.slice(0, -1) + ","
        : null;
      const matching: string[] = [];
      for (const { runId, leafKey } of runsByLeafKey) {
        const isMatch =
          leafKey === bucketPathKey ||
          (prefix != null && leafKey.startsWith(prefix));
        if (isMatch) matching.push(runId);
      }
      onSetRunsHiddenRef.current(matching, hidden);
    };
    return {
      selected,
      visible,
      deselectBucket,
      selectAllInBucket,
      setBucketHidden,
    };
  }, [
    selectedRunsWithColors,
    hiddenRunIds,
    groupBy,
    queryClient,
    organizationId,
    projectName,
    baseFilters,
  ]);

  return (
    <BucketSelectionProvider value={bucketSelectionSignal}>
      <BucketLevel
        {...props}
        depth={0}
        parentFilters={[]}
        expanded={expandedSet}
        toggleExpanded={toggleExpanded}
      />
    </BucketSelectionProvider>
  );
}

/** Internal: BucketLevel takes the materialized Set form. The Tree
 *  component wraps the array <-> Set conversion at the root and feeds
 *  the Set down through recursion. */
interface BucketLevelProps extends Omit<GroupedBucketTreeProps, "expanded" | "onExpandedChange"> {
  depth: number;
  parentFilters: GroupFilter[];
  expanded: Set<string>;
  toggleExpanded: (key: string) => void;
}

function BucketLevel({
  depth,
  parentFilters,
  groupBy,
  organizationId,
  baseFilters,
  colSpan,
  expanded,
  toggleExpanded,
  rootPageSize,
  rootPageIndex,
  onRootHasMoreChange,
  onRootTotalCountChange,
  onRootRealTotalCountChange,
  onVisibleRootBucketsChange,
  showOnlySelected,
  pinSelectedToTop,
  selectedAncestorPaths,
  sortField,
  sortSource,
  sortDirection,
  sortAggregation,
  aggregateColumns,
  aggregateColIdIndex,
  ...rest
}: BucketLevelProps) {
  const field = groupBy[depth];
  // Footer-driven pagination only applies at the root level. Nested
  // levels (depth > 0) own their own flip-style page index with a
  // wandb-equivalent hard cap of `PAGE_SIZE` (10) per page — the
  // "01-10 of N" inline paginator below the expanded subgroup list.
  const footerPaginated = depth === 0 && rootPageSize != null;
  const [nestedPageIndex, setNestedPageIndex] = useState(0);
  // When DOS or Pin is on, fetch the entire bucket list (returnAll)
  // and do the slicing client-side. This serves two needs at once:
  // - Bucket counts stay stable. Previously the pinned-section count
  //   bounced between the bucket's real size and `selectedCount`
  //   depending on whether that bucket value happened to land on
  //   the server's current page. With returnAll, every pinned value
  //   is present in `rawValues` and its server count is always
  //   available.
  // - Root pagination math becomes deterministic. The footer's
  //   "X / N" stops oscillating between renders because the totals
  //   are derived from a stable full list, not from the per-page
  //   server slice.
  // Nested levels reorder-once-then-paginate; root keeps flat-mode
  // sticky pin (pinned shown on every page) with effective page size
  // = pageSize - pinnedCount, mirroring data-table.tsx pin.
  // Filter is the ceiling in grouped mode. DOS and PSTT both operate
  // WITHIN the filter — selection ∩ filter, not the union. Diverges
  // from flat-mode's "selection outranks filter" grammar on purpose;
  // grouped users found the appended non-matching section confusing.
  const useReturnAll = showOnlySelected || pinSelectedToTop;
  const clientPaginateNested = !footerPaginated && useReturnAll;
  const effectiveLimit = footerPaginated ? rootPageSize! : PAGE_SIZE;
  const effectiveOffset = footerPaginated
    ? (rootPageIndex ?? 0) * rootPageSize!
    : nestedPageIndex * PAGE_SIZE;

  // When there's another grouping level beneath this one, ask the
  // backend to ALSO break down by `subgroupField` in the same response.
  // Folds the per-parent-row "(K subgroups)" probe queries into this
  // single round trip — saves N HTTP calls + N SQL invocations on every
  // bucket-tree render with 2+ levels of grouping.
  const subgroupField: string | undefined = groupBy[depth + 1];
  const queryOptions = trpc.runs.distinctGroupValues.queryOptions({
    organizationId,
    projectName: rest.projectName,
    field,
    parentFilters,
    ...baseFilters,
    // When client-paginating, ask the server for the entire bucket
    // list at once (skips MAX_LIMIT). MUST omit `offset` entirely —
    // including it bakes nestedPageIndex into the React Query key,
    // so clicking Next triggers a refetch, data goes stale, the
    // clamp effect sees a momentarily empty list and snaps pageIndex
    // back to 0 (the bug the user reported with "click Next, flicker,
    // stays on page 1"). Leaf BucketRuns avoids this by forcing
    // offset:0 below — same pattern here.
    ...(useReturnAll
      ? { returnAll: true as const }
      : { limit: effectiveLimit, offset: effectiveOffset }),
    subgroupField,
    // W&B parity: order buckets by an aggregate of the sort column
    // over their descendant runs (AVG for numeric/metric, MIN for
    // text, AVG(epoch) for dates). Unset → backend falls back to
    // count-desc, value-asc.
    sortField,
    sortSource,
    sortDirection,
    sortAggregation,
    aggregateColumns,
  });
  const { data, isLoading } = useQuery(queryOptions);

  // Surface the currently-visible root bucket list (value + count +
  // single-step filter path) so the visibility-options popover can
  // render "Select all on page (N) (M runs)" without re-fetching.
  // Only the root level is paginated by the data-table footer; nested
  // levels have their own inline paginator and aren't reflected here.
  useEffect(() => {
    if (!footerPaginated || !onVisibleRootBucketsChange) return;
    // subgroupsByValue is Record<bucketValue, GroupValueRow[]> — the
    // length of each array is the next-level distinct-value count for
    // that bucket. Not a flat number map.
    const subgroupsByValue = (data as { subgroupsByValue?: Record<string, unknown[]> } | undefined)?.subgroupsByValue;
    const buckets = (data?.values ?? []).map((b) => ({
      value: b.value,
      count: b.count,
      subgroupCount: subgroupsByValue?.[b.value ?? ""]?.length,
      pathFilters: [{ field, value: b.value }],
    }));
    onVisibleRootBucketsChange(buckets);
  }, [footerPaginated, onVisibleRootBucketsChange, data, field]);

  // Apply DOS filter and Pin reordering on top of the raw server
  // values. Hooks must come before the isLoading early-return to obey
  // the rules of hooks across render cycles.
  const parentValues = useMemo(() => parentFilters.map((f) => f.value), [parentFilters]);

  // Selected-containing bucket *values* at this depth, restricted to
  // ones whose parent path matches our current trail. Derived from
  // selectedAncestorPaths so we don't have to wait for a server
  // fetch — these are what DOS shows and what Pin floats to the top.
  // Each entry carries the path's selected-run count so we can render
  // synthetic buckets (those not present in `rawValues`) with a
  // non-zero count without an extra query.
  const selectedBucketsAtDepth = useMemo<Array<{ value: string | null; selectedCount: number }>>(() => {
    const map = selectedAncestorPaths?.[depth];
    if (!map || map.size === 0) return [];
    const parentEncoded = JSON.stringify(parentValues);
    const out: Array<{ value: string | null; selectedCount: number }> = [];
    for (const [encodedPath, count] of map) {
      // Cheap prefix check: the encoded path must begin with the
      // parent's encoded prefix (minus the closing `]`). Avoids
      // re-parsing every path; works because JSON arrays serialize
      // their elements in order.
      const prefix = parentEncoded.slice(0, -1) + (parentValues.length > 0 ? "," : "");
      if (!encodedPath.startsWith(prefix)) continue;
      try {
        const parsed = JSON.parse(encodedPath) as Array<string | null>;
        if (parsed.length !== depth + 1) continue;
        out.push({ value: parsed[depth], selectedCount: count });
      } catch { /* ignore malformed */ }
    }
    // Stable order: keep insertion order from the selection so the
    // user's most-recently-selected runs influence the rendered order.
    return out;
  }, [selectedAncestorPaths, depth, parentValues]);

  const selectedValuesSet = useMemo(
    () => new Set(selectedBucketsAtDepth.map((b) => b.value)),
    [selectedBucketsAtDepth],
  );

  const rawValues = useMemo(() => data?.values ?? [], [data?.values]);

  // Build the DOS bucket list once — we slice it for the current page
  // below. Counts prefer the server's `count` (whole bucket size) when
  // a derived value happens to land on the current server page,
  // otherwise fall back to the selected-only count.
  // DOS bucket list — `selectedBucketsAtDepth` already excludes
  // search-non-matching paths when DOS + search is on (data-table
  // hands us `dosSearchFilteredAncestorPaths` in that case), so we
  // don't need a separate reorder for the DOS case.
  const derivedDOSBuckets = useMemo<
    Array<{ value: string | null; count: number; aggregates?: Array<number | null> }> | null
  >(() => {
    if (!showOnlySelected) return null;
    const byValue = new Map<string | null, number>();
    // Also carry aggregates from the server response so pinned/DOS
    // buckets can still render their group-row column values.
    const aggByValue = new Map<string | null, Array<number | null> | undefined>();
    for (const b of rawValues) {
      byValue.set(b.value, b.count);
      aggByValue.set(b.value, b.aggregates);
    }
    // Filter is the ceiling: only surface selected buckets that ALSO
    // appear in the server's rawValues. Without a toolbar filter,
    // rawValues (returnAll) covers every bucket in the project and
    // `byValue.has` is true for the whole selection — no-op. With a
    // filter, selected-non-matching buckets simply don't render under
    // DOS. Cleaner than the flat-mode "append below a divider" grammar.
    return selectedBucketsAtDepth
      .filter((b) => byValue.has(b.value))
      .map((b) => {
        const out: { value: string | null; count: number; aggregates?: Array<number | null> } = {
          value: b.value,
          count: byValue.get(b.value) ?? b.selectedCount,
        };
        const agg = aggByValue.get(b.value);
        if (agg) out.aggregates = agg;
        return out;
      });
  }, [showOnlySelected, rawValues, selectedBucketsAtDepth]);

  // Any toolbar filter chip active. Drives the pin-divider copy so
  // under filter+PSTT it reads `Unselected runs below that match the
  // active filter` instead of the bare `Unselected runs below`.
  const filterChipActive = !!(
    (baseFilters.tags?.length ?? 0) > 0 ||
    (baseFilters.status?.length ?? 0) > 0 ||
    (baseFilters.dateFilters?.length ?? 0) > 0 ||
    (baseFilters.fieldFilters?.length ?? 0) > 0 ||
    (baseFilters.metricFilters?.length ?? 0) > 0 ||
    (baseFilters.systemFilters?.length ?? 0) > 0
  );
  const rawValuesSet = useMemo(
    () => new Set(rawValues.map((b) => b.value)),
    [rawValues],
  );
  const derivedPinnedBuckets = useMemo<
    Array<{ value: string | null; count: number; aggregates?: Array<number | null> }> | null
  >(() => {
    if (!pinSelectedToTop || showOnlySelected) return null;
    // Same filter-as-ceiling rule as DOS: only pin selected buckets
    // that ALSO appear in the server's rawValues (filter-matching /
    // no-filter). Selected-non-matching stay hidden — the existing
    // `UNSELECTED RUNS BELOW` divider then correctly separates
    // pinned selected-matching from unpinned unselected-matching.
    const buckets = selectedBucketsAtDepth
      .filter((b) => rawValuesSet.has(b.value))
      .map((b) => {
        const fromServer = rawValues.find((r) => r.value === b.value);
        // Carry aggregates from the server when available so pinned
        // rows render their group-row column values.
        const out: { value: string | null; count: number; aggregates?: Array<number | null> } = {
          value: b.value,
          count: fromServer?.count ?? b.selectedCount,
        };
        if (fromServer?.aggregates) out.aggregates = fromServer.aggregates;
        return out;
      });
    return buckets;
  }, [pinSelectedToTop, showOnlySelected, rawValues, selectedBucketsAtDepth, rawValuesSet]);

  // Full ordered list when client-paginating a nested level. Drives
  // both the slice we render and the inline-paginator's total count.
  const nestedOrderedFull = useMemo(() => {
    if (!clientPaginateNested) return null;
    if (derivedDOSBuckets) return derivedDOSBuckets;
    if (derivedPinnedBuckets) {
      const rest = rawValues.filter((b) => !selectedValuesSet.has(b.value));
      return derivedPinnedBuckets.concat(rest);
    }
    return rawValues;
  }, [clientPaginateNested, derivedDOSBuckets, derivedPinnedBuckets, rawValues, selectedValuesSet]);

  // Clamp the nested pageIndex when (de)selecting shrinks the
  // re-ordered list below the current page's start. Same role as the
  // matching effect in BucketRuns.
  useEffect(() => {
    if (!nestedOrderedFull) return;
    const maxPage = Math.max(0, Math.ceil(nestedOrderedFull.length / PAGE_SIZE) - 1);
    if (nestedPageIndex > maxPage) setNestedPageIndex(maxPage);
  }, [nestedOrderedFull, nestedPageIndex]);

  const values = useMemo(() => {
    // Nested + (DOS or Pin): the FULL ordered list lives in
    // nestedOrderedFull; the inline paginator selects the page
    // slice — no sticky-pin across pages, no growing slice, no
    // flicker when (de)selecting (the user can see their selection
    // settle into wherever the reorder put it).
    if (nestedOrderedFull) {
      const start = nestedPageIndex * PAGE_SIZE;
      return nestedOrderedFull.slice(start, start + PAGE_SIZE);
    }
    if (derivedDOSBuckets) {
      // Outer (depth=0) with DOS — the footer paginates by `pageSize`.
      // When Pin is also on and the selection overflows pageSize, the
      // footer collapses to "1 / 1" (see rootTotalCount); render every
      // selected bucket so the page actually shows what the footer
      // promises.
      const limit = rootPageSize ?? PAGE_SIZE;
      if (pinSelectedToTop && derivedDOSBuckets.length >= limit) {
        return derivedDOSBuckets;
      }
      const offset = (rootPageIndex ?? 0) * limit;
      return derivedDOSBuckets.slice(offset, offset + limit);
    }
    if (derivedPinnedBuckets) {
      // Outer with Pin — sticky pinned at top of every page,
      // mirroring flat-mode pin-to-top. Server returned the entire
      // bucket universe (returnAll), so we can compute the unselected
      // section client-side and slice it by effectivePageSize, which
      // is what flat-mode does (pageSize - pinnedCount per page).
      const pinned = derivedPinnedBuckets;
      const pinnedSize = pinned.length;
      const pageSize = rootPageSize ?? PAGE_SIZE;
      // Overflow: pinned alone fills (or overflows) the page →
      // collapse to "1 / 1" with no unselected visible.
      if (pinnedSize >= pageSize) return pinned;
      const allUnselected = rawValues.filter((b) => !selectedValuesSet.has(b.value));
      const effectivePageSize = Math.max(1, pageSize - pinnedSize);
      const startUnselected = (rootPageIndex ?? 0) * effectivePageSize;
      return pinned.concat(allUnselected.slice(startUnselected, startUnselected + effectivePageSize));
    }
    return rawValues;
  }, [
    nestedOrderedFull,
    derivedDOSBuckets,
    derivedPinnedBuckets,
    pinSelectedToTop,
    rawValues,
    selectedValuesSet,
    rootPageSize,
    rootPageIndex,
    nestedPageIndex,
  ]);

  // Effective totalCount / hasMore for the data-table footer. When
  // DOS or Pin is active at the root level we override the server's
  // raw counts:
  //   DOS  → totalCount = derived list length (only selected-containing
  //          buckets are paginated). hasMore is just the slice check.
  //   Pin overflow (pinned >= pageSize) → totalCount = pinned length,
  //          hasMore = false ("1 / 1" footer mirroring flat-mode pin).
  //   Pin non-overflow → totalCount stays close to the server total
  //          plus pinned values that aren't already in the server's
  //          current-page slice (orientation cue only — pagination
  //          stays driven by the server).
  // Footer totalCount / hasMore at the root level. When DOS or Pin is
  // on we override the server's raw counts so the "X / N" indicator
  // matches what the user actually sees:
  //   DOS  → totalCount = derived list length. Footer paginates by
  //          pageSize through that list.
  //   Pin overflow (pinnedSize >= pageSize) → totalCount = pinnedSize,
  //          hasMore = false ("1 / 1" mirroring flat-mode pin).
  //   Pin non-overflow → totalCount is set so that
  //          ceil(totalCount / pageSize) = pages of unselected,
  //          because each page shows the sticky pinned section plus
  //          one slice of unselected (effectivePageSize wide). This
  //          matches data-table.tsx's split between the pinned and
  //          unpinned tables.
  const rootTotalCount = useMemo(() => {
    if (!footerPaginated) return data?.totalCount ?? 0;
    const pageSize = rootPageSize ?? PAGE_SIZE;
    // Pin overflow → 1 / 1. The footer divides totalCount by pageSize
    // to derive the page count, so when the pinned (or DOS-when-pin-is-
    // on) selection fills or exceeds the page-size budget there's no
    // room left for unpinned/unselected slices and paging through is
    // pointless. Return pageSize so `ceil(pageSize / pageSize) = 1` —
    // matches the flat-mode pin-overflow collapse in table-pagination.
    if (derivedDOSBuckets) {
      const dosSize = derivedDOSBuckets.length;
      if (pinSelectedToTop && dosSize >= pageSize) return pageSize;
      return dosSize;
    }
    if (!derivedPinnedBuckets) return data?.totalCount ?? 0;
    const pinnedSize = derivedPinnedBuckets.length;
    if (pinnedSize >= pageSize) return pageSize;
    const allUnselected = rawValues.filter((b) => !selectedValuesSet.has(b.value));
    const effectivePageSize = Math.max(1, pageSize - pinnedSize);
    const pages = Math.max(1, Math.ceil(allUnselected.length / effectivePageSize));
    return pages * pageSize;
  }, [
    footerPaginated,
    data?.totalCount,
    derivedDOSBuckets,
    derivedPinnedBuckets,
    pinSelectedToTop,
    rootPageSize,
    rawValues,
    selectedValuesSet,
  ]);
  const rootHasMore = useMemo(() => {
    if (!footerPaginated) return data?.hasMore ?? false;
    const pageSize = rootPageSize ?? PAGE_SIZE;
    if (derivedDOSBuckets) {
      if (pinSelectedToTop && derivedDOSBuckets.length >= pageSize) return false;
      const offset = (rootPageIndex ?? 0) * pageSize;
      return offset + pageSize < derivedDOSBuckets.length;
    }
    if (!derivedPinnedBuckets) return data?.hasMore ?? false;
    const pinnedSize = derivedPinnedBuckets.length;
    if (pinnedSize >= pageSize) return false;
    const allUnselected = rawValues.filter((b) => !selectedValuesSet.has(b.value));
    const effectivePageSize = Math.max(1, pageSize - pinnedSize);
    const startUnselected = ((rootPageIndex ?? 0) + 1) * effectivePageSize;
    return startUnselected < allUnselected.length;
  }, [
    footerPaginated,
    data?.hasMore,
    derivedDOSBuckets,
    derivedPinnedBuckets,
    pinSelectedToTop,
    rootPageSize,
    rootPageIndex,
    rawValues,
    selectedValuesSet,
  ]);
  useEffect(() => {
    if (footerPaginated && onRootHasMoreChange) onRootHasMoreChange(rootHasMore);
  }, [footerPaginated, onRootHasMoreChange, rootHasMore]);
  useEffect(() => {
    if (footerPaginated && onRootTotalCountChange) onRootTotalCountChange(rootTotalCount);
  }, [footerPaginated, onRootTotalCountChange, rootTotalCount]);
  useEffect(() => {
    // Real distinct group count, straight off the server's response.
    // Independent of DOS/Pin so the toolbar's "X of Y groups
    // selected" counter is correct regardless of which visibility
    // mode the user is in.
    if (footerPaginated && onRootRealTotalCountChange && data) {
      onRootRealTotalCountChange(data.totalCount);
    }
  }, [footerPaginated, onRootRealTotalCountChange, data]);

  if (isLoading) {
    return (
      <TableRow>
        <TableCell colSpan={colSpan} className="py-4 text-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-3 w-3 animate-spin" />
          Loading {groupFieldLabel(field)} buckets…
        </TableCell>
      </TableRow>
    );
  }
  if (values.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={colSpan} className="py-4 px-0 text-sm text-muted-foreground">
          {/* Sticky wrapper pinned to the scroll container's left edge
              with width = viewport width (--tbl-visible-w, published
              by data-table.tsx). Keeps the message centered in the
              VISIBLE viewport instead of the full scrolled table
              width — otherwise it lands off-screen right whenever the
              user scrolls the horizontal columns. */}
          <div
            className="sticky left-0 text-center"
            style={{ width: "var(--tbl-visible-w, 100%)" }}
          >
            {showOnlySelected
              ? `No selected runs in any ${groupFieldLabel(field)} bucket.`
              : `No buckets for ${groupFieldLabel(field)} in this filter set.`}
          </div>
        </TableCell>
      </TableRow>
    );
  }

  // Pinned/unpinned divider — only at the OUTER (root) level, matching
  // flat-mode pin-to-top which has a single "Unselected runs below"
  // divider between the pinned table and the unpinned table. Nested
  // levels and leaf runs reorder selected-first but don't draw a
  // divider. Suppressed under DOS (no unpinned section) and under
  // Pin overflow (no unpinned section).
  const pinnedCountAtThisLevel = derivedPinnedBuckets?.length ?? 0;
  const showPinDivider =
    depth === 0 &&
    !showOnlySelected &&
    pinnedCountAtThisLevel > 0 &&
    values.length > pinnedCountAtThisLevel;

  return (
    <>
      {values.map((bucket, idx) => {
        const ourFilters: GroupFilter[] = [
          ...parentFilters,
          { field, value: bucket.value },
        ];
        const key = pathKey(ourFilters);
        const isExpanded = expanded.has(key);
        const isLeaf = depth === groupBy.length - 1;
        const showDividerAfter = showPinDivider && idx === pinnedCountAtThisLevel - 1;
        return (
          <Fragment key={key}>
            <BucketHeaderRow
              depth={depth}
              groupByLength={groupBy.length}
              field={field}
              value={bucket.value}
              count={bucket.count}
              // Per-column aggregates for W&B-style values on group
              // rows. Undefined when nothing was requested → header
              // renders the plain single-cell label as before.
              aggregates={bucket.aggregates}
              aggregateColIdIndex={aggregateColIdIndex}
              tableColumns={rest.columns}
              columnOrder={rest.columnOrder}
              pinnedColumnMap={rest.pinnedColumnMap}
              isExpanded={isExpanded}
              colSpan={colSpan}
              pathKey={key}
              bucketFilters={ourFilters}
              // Color belongs to the LEAF level only — that's the
              // bucket whose runs share the swatch's color. Parents
              // are just navigation containers.
              color={isLeaf ? bucketColorFor(key) : undefined}
              // Non-leaf parents probe the next grouping level for a
              // subgroup count, surfaced as wandb's `(K subgroups)
              // (N runs)` badges in the header. When the parent's
              // distinctGroupValues response already includes
              // `subgroupsByValue` (which happens whenever a next
              // grouping level exists), pass it through as
              // `precomputedSubgroups` so BucketHeaderRow skips its
              // own probe entirely.
              subgroupField={isLeaf ? undefined : groupBy[depth + 1]}
              subgroupParentFilters={isLeaf ? undefined : ourFilters}
              subgroupBaseFilters={isLeaf ? undefined : baseFilters}
              subgroupOrganizationId={isLeaf ? undefined : organizationId}
              subgroupProjectName={isLeaf ? undefined : rest.projectName}
              precomputedSubgroups={
                isLeaf
                  ? undefined
                  : data?.subgroupsByValue?.[bucket.value ?? ""]
              }
              onToggle={() => toggleExpanded(key)}
              // Hover dispatch:
              //   - Leaf buckets dispatch their own pathKey (1:1 to a
              //     chart series).
              //   - Parent buckets ONE level above leaf (depth ===
              //     groupBy.length - 2) use their probe-fetched
              //     children to dispatch every descendant pathKey at
              //     once — chart-sync supports string[] payloads.
              //   - Higher-depth parents dispatch nothing for v1
              //     (would need cascading probes, deferred).
              hoverDispatch={
                isLeaf
                  ? { kind: "leaf", pathKey: key }
                  : depth === groupBy.length - 2
                    ? { kind: "parent-of-leaf", parentTrail: ourFilters, leafField: groupBy[depth + 1] }
                    : undefined
              }
            />
            {isExpanded && (
              isLeaf ? (
                <BucketRuns
                  filters={ourFilters}
                  baseFilters={baseFilters}
                  organizationId={organizationId}
                  colSpan={colSpan}
                  columns={rest.columns}
                  columnOrder={rest.columnOrder}
                  pinnedColumnMap={rest.pinnedColumnMap}
                  selectedRunsWithColors={rest.selectedRunsWithColors}
                  hiddenRunIds={rest.hiddenRunIds}
                  tableBodyRef={rest.tableBodyRef}
                  projectName={rest.projectName}
                  bucketColor={bucketColorFor(key)}
                  onColorChange={rest.onColorChange}
                  showOnlySelected={showOnlySelected}
                  pinSelectedToTop={pinSelectedToTop}
                  runFirstCellPaddingLeft={rest.runFirstCellPaddingLeft}
                  metricColumnSpecs={rest.metricColumnSpecs}
                  sortField={sortField}
                  sortSource={sortSource}
                  sortDirection={sortDirection}
                  sortAggregation={sortAggregation}
                />
              ) : (
                <BucketLevel
                  {...rest}
                  organizationId={organizationId}
                  baseFilters={baseFilters}
                  colSpan={colSpan}
                  depth={depth + 1}
                  parentFilters={ourFilters}
                  groupBy={groupBy}
                  expanded={expanded}
                  toggleExpanded={toggleExpanded}
                  organizationSlug={rest.organizationSlug}
                  // These were destructured out of `...rest` in the
                  // parent so they need to be re-attached here, else
                  // nested levels lose the DOS/Pin/sort context.
                  showOnlySelected={showOnlySelected}
                  pinSelectedToTop={pinSelectedToTop}
                  selectedAncestorPaths={selectedAncestorPaths}
                  sortField={sortField}
                  sortSource={sortSource}
                  sortDirection={sortDirection}
                  sortAggregation={sortAggregation}
                  aggregateColumns={aggregateColumns}
                  aggregateColIdIndex={aggregateColIdIndex}
                />
              )
            )}
            {showDividerAfter && (
              <TableRow className="hover:bg-transparent" data-testid="pin-divider">
                <TableCell
                  colSpan={colSpan}
                  // Outer cell carries the row-spanning background /
                  // border so the divider band reads across the whole
                  // scrolled row. Sticky inner div centers the LABEL
                  // in the visible viewport (see empty-state comment
                  // above for the --tbl-visible-w mechanism).
                  className="bg-primary/15 border-y-2 border-primary/60 py-1 px-0"
                >
                  <div
                    className="sticky left-0 text-center text-[11px] font-semibold uppercase tracking-wider text-primary"
                    style={{ width: "var(--tbl-visible-w, 100%)" }}
                  >
                    {filterChipActive
                      ? "Unselected runs below that match the active filter"
                      : "Unselected runs below"}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </Fragment>
        );
      })}
      {!footerPaginated && (() => {
        // When client-paginating (DOS/Pin at a nested level), the
        // inline paginator counts the re-ordered list so it stays
        // in sync with what the user actually sees.
        const inlineTotal = nestedOrderedFull?.length ?? data?.totalCount ?? 0;
        if (inlineTotal <= PAGE_SIZE) return null;
        return (
          <TableRow>
            <TableCell colSpan={colSpan} className="py-1">
              <InlinePager
                pageIndex={nestedPageIndex}
                pageSize={PAGE_SIZE}
                totalCount={inlineTotal}
                depth={depth}
                onPageChange={setNestedPageIndex}
                testId={`bucket-pager-d${depth}`}
              />
            </TableCell>
          </TableRow>
        );
      })()}
    </>
  );
}

type HoverDispatch =
  | { kind: "leaf"; pathKey: string }
  | { kind: "parent-of-leaf"; parentTrail: GroupFilter[]; leafField: string };

function BucketHeaderRow({
  depth,
  groupByLength,
  field,
  value,
  count,
  aggregates,
  aggregateColIdIndex,
  tableColumns,
  columnOrder,
  pinnedColumnMap,
  isExpanded,
  colSpan,
  color,
  subgroupField,
  subgroupParentFilters,
  subgroupBaseFilters,
  subgroupOrganizationId,
  subgroupProjectName,
  precomputedSubgroups,
  onToggle,
  hoverDispatch,
  pathKey: bucketPathKey,
  bucketFilters,
}: {
  depth: number;
  groupByLength: number;
  field: string;
  value: string | null;
  count: number;
  /** Per-column aggregates for this bucket (parallel to the
   *  aggregateColumns request the parent fired). Undefined → no
   *  aggregates were requested; the row renders as the legacy
   *  full-width label cell. */
  aggregates?: Array<number | null>;
  aggregateColIdIndex?: Map<string, { idx: number; kind: "number" | "date" | "blank" }>;
  /** Full ColumnDef array — retained for the run-row path but no
   *  longer used to drive bucket-header cell rendering. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tableColumns: ColumnDef<Run, any>[];
  /** TanStack column-id order in the current VISUAL layout (pinned
   *  prefix moves user-pinned columns up front). Iterate this — NOT
   *  the raw ColumnDef array — so aggregate cells land under the
   *  correct headers after the user pins/unpins a column. */
  columnOrder: string[];
  pinnedColumnMap: Record<string, { left: number; isLast: boolean }>;
  isExpanded: boolean;
  colSpan: number;
  /** This bucket's pathKey (JSON-stringified `[{field, value}, …]`
   *  trail). Used by the eye-icon toggle: hiding this bucket also
   *  hides every descendant via prefix match in `isPathHidden`. */
  pathKey: string;
  /** Same trail in array form. Used by `selectAllInBucket` (when the
   *  user clicks the eye on a deselected bucket) to fetch every
   *  descendant run via `runs.list` and add them to the selection.
   *  Equivalent to `JSON.parse(pathKey)` but pre-built. */
  bucketFilters: GroupFilter[];
  /** Determines what `_seriesId`(s) to dispatch on mouseenter so
   *  charts highlight the matching line(s). Undefined → no dispatch
   *  (deeper parents in v1). */
  hoverDispatch?: HoverDispatch;
  /** Provided only for the deepest (leaf) bucket — its runs share
   *  this color. Parents render no swatch. */
  color?: string;
  /** When this is a non-leaf parent bucket, the next grouping field
   *  + the trail to this bucket. The component probes the server to
   *  surface a subgroup count alongside the run count. */
  subgroupField?: string;
  subgroupParentFilters?: GroupFilter[];
  subgroupBaseFilters?: BaseFilters;
  subgroupOrganizationId?: string;
  subgroupProjectName?: string;
  /** Subgroup breakdown precomputed by the parent's distinctGroupValues
   *  response (the new `subgroupsByValue` field). When provided, the
   *  per-row probe `useQuery` is skipped entirely — N probes folded
   *  into the parent's single round trip. */
  precomputedSubgroups?: { value: string | null; count: number }[];
  onToggle: () => void;
}) {
  // Probe child bucket values for non-leaf parents. `returnAll: true`
  // skips the server's MAX_LIMIT cap and pages — we get every
  // descendant in one fetch — which serves two purposes:
  //   1. Render the `(N subgroups)` badge from the authoritative
  //      `totalCount` field (no `10+` truncation).
  //   2. Build the full descendant pathKey list for parent hover
  //      dispatch so EVERY child chart series highlights, not just
  //      the first page.
  // The probe is SKIPPED when `precomputedSubgroups` is provided —
  // that means the parent's distinctGroupValues response already
  // folded the breakdown in (the common case for 2+ level grouping).
  // The probe only fires now for the rare backend-skipped shapes
  // (e.g. tag-prefix under tag-prefix) where the fold can't run.
  const usePrecomputed = precomputedSubgroups !== undefined;
  const probeEnabled =
    !usePrecomputed && !!subgroupField && !!subgroupOrganizationId && !!subgroupProjectName;
  const probeOptions = trpc.runs.distinctGroupValues.queryOptions(
    probeEnabled
      ? {
          organizationId: subgroupOrganizationId!,
          projectName: subgroupProjectName!,
          field: subgroupField!,
          parentFilters: subgroupParentFilters,
          ...subgroupBaseFilters,
          returnAll: true,
        }
      : {
          // Disabled placeholder — required arguments still need
          // valid values for the query-key derivation to succeed.
          organizationId: "",
          projectName: "",
          field: "",
        },
  );
  const subgroupProbe = useQuery({
    ...probeOptions,
    enabled: probeEnabled,
  });
  // Source of truth for subgroup info — precomputed when available,
  // probe response otherwise.
  const subgroupValues: { value: string | null; count: number }[] | null =
    usePrecomputed
      ? precomputedSubgroups!
      : (subgroupProbe.data?.values ?? null);
  const subgroupCountLabel = usePrecomputed
    ? `${precomputedSubgroups!.length}`
    : !probeEnabled
      ? null
      : subgroupProbe.isLoading
        ? "…"
        : (() => {
            // Prefer `totalCount` (authoritative, includes (unset)) over
            // the legacy `values.length + hasMore` heuristic.
            const total = subgroupProbe.data?.totalCount;
            if (total !== undefined) return `${total}`;
            const n = subgroupProbe.data?.values.length ?? 0;
            const more = subgroupProbe.data?.hasMore ?? false;
            return more ? `${n}+` : `${n}`;
          })();

  // Hover dispatch handlers. For parent-of-leaf rows we synthesise
  // the descendant pathKeys from the probe data fetched above —
  // when probe data isn't ready yet, we no-op rather than block.
  const handleMouseEnter = () => {
    if (!hoverDispatch) return;
    if (hoverDispatch.kind === "leaf") {
      document.dispatchEvent(
        new CustomEvent("run-table-hover", { detail: hoverDispatch.pathKey }),
      );
      return;
    }
    // parent-of-leaf: each subgroup value becomes a leaf pathKey when
    // appended to the parent trail. Uses precomputed subgroups (from
    // the parent's distinctGroupValues fold) when available, falls
    // back to the probe response otherwise.
    const dispatchValues = subgroupValues ?? [];
    const leafKeys = dispatchValues.map((v: { value: string | null }) =>
      JSON.stringify([
        ...hoverDispatch.parentTrail,
        { field: hoverDispatch.leafField, value: v.value },
      ]),
    );
    if (leafKeys.length === 0) return;
    document.dispatchEvent(
      new CustomEvent("run-table-hover", { detail: leafKeys }),
    );
  };
  const handleMouseLeave = () => {
    if (!hoverDispatch) return;
    document.dispatchEvent(
      new CustomEvent("run-table-hover", { detail: null }),
    );
  };
  // Per-run eye style: 3 states, mirroring the run-row eye in
  // columns.tsx. Both signals are derived client-side from
  // `selectedRunsWithColors` + `hiddenRunIds` via the bucket-tree
  // root and pulled from context here:
  //   - `isSelected`         — any descendant run in selection
  //   - `hasVisibleChartLine` — any descendant run selected AND not
  //                             in `hiddenRunIds` (i.e. the chart is
  //                             drawing a line for it)
  // `isHidden` (no separate state — just derived): the bucket is
  // hidden iff it has selected runs but none of them are visible.
  // Clicking the eye fans out to every descendant's per-run hidden
  // state, so a single child can later override the group by
  // clicking its own eye.
  const {
    selected: selectedLeafKeys,
    visible: visibleLeafKeys,
    deselectBucket,
    selectAllInBucket,
    setBucketHidden,
  } = useBucketSelectionSignal();
  const isSelected = isBucketCovered(bucketPathKey, selectedLeafKeys);
  const hasVisibleChartLine = isBucketCovered(bucketPathKey, visibleLeafKeys);
  const isHidden = isSelected && !hasVisibleChartLine;
  // Label always spans the BASE pinned area (select + status + name)
  // — 3 columns — so user-pinned columns can still render their own
  // aggregate value. Falls back to the legacy single-colSpan cell
  // when no aggregates were requested — callers that didn't opt in
  // see zero change.
  const hasAggregates = aggregates !== undefined && aggregateColIdIndex !== undefined;
  const BASE_PINNED_LABEL_COLS = 3;
  // Start the label at the base pinned area (select + status + name), then
  // extend it across every following column that ISN'T a metric-aggregate
  // column (Id, Name overflow, Notes, Tags, …). Group rows carry no value in
  // those columns, so letting the label span them stops the "Group: … N runs"
  // text from being clipped at the Name edge. Stop at the first aggregate
  // (metric) column so it still renders its own value cell, aligned with the
  // run rows below.
  let labelSpan = 0;
  if (hasAggregates) {
    labelSpan = Math.min(BASE_PINNED_LABEL_COLS, columnOrder.length);
    while (
      labelSpan < columnOrder.length &&
      !aggregateColIdIndex?.has(columnOrder[labelSpan])
    ) {
      labelSpan++;
    }
  }
  // Per-column background color the user set via the column-header
  // menu. Threaded through the ColumnDef's `meta.backgroundColor`
  // field (see data-table.tsx `renderHeaderCell` for the flat-table
  // path). Same field, same key — we just look it up per aggregate
  // cell so group / subgroup / leaf-group rows tint alongside the
  // data rows below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const colBgById = new Map<string, string>();
  for (const c of tableColumns) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bg = (c.meta as any)?.backgroundColor as string | undefined;
    if (bg && c.id) colBgById.set(c.id, bg);
  }
  return (
    <TableRow
      className="group/bucket"
      data-testid={`bucket-header-d${depth}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Whole-row click target. `p-0` + sticky inner wrapper keeps the
          label pinned at the left edge while the row scrolls
          horizontally; the cell-level `group-hover/bucket:bg-muted/30`
          tints the entire bar uniformly on hover instead of only the
          inner button. */}
      <TableCell
        colSpan={hasAggregates ? labelSpan : colSpan}
        onClick={onToggle}
        aria-expanded={isExpanded}
        className={cn(
          "cursor-pointer p-0 text-sm",
          // Sticky cell needs an OPAQUE background layer so scrolling
          // aggregate cells don't bleed through the 15% muted tint.
          // When aggregates are on we build that via inline style
          // below; when off we can rely on the plain translucent
          // classes because the cell spans the whole row and nothing
          // scrolls behind it.
          !hasAggregates && "bg-muted/15 group-hover/bucket:bg-muted/30",
          isHidden && "opacity-50",
          // When aggregates are on, this cell is only as wide as the
          // pinned prefix (colSpan=pinnedCount, ~324px) — the row
          // scrolls horizontally past it. Make the cell itself sticky
          // so the label stays visible while the aggregate cells to
          // the right scroll under it. `overflow-hidden` keeps deep-
          // nested labels (big paddingLeft indent + "N subgroups /
          // leaf groups / M runs" trailer) from spilling past the
          // pinned area into the aggregate columns.
          hasAggregates && "sticky left-0 z-10 overflow-hidden",
        )}
        style={hasAggregates ? {
          // Muted tint layered over the opaque background — same trick
          // renderHeaderCell in data-table.tsx uses to keep sticky
          // pinned header cells from becoming transparent.
          background: "linear-gradient(hsl(var(--muted) / 0.15), hsl(var(--muted) / 0.15)), hsl(var(--background))",
        } : undefined}
      >
        <div
          // Match RunRow's `px-2 py-2` cell padding so bucket-header
          // rows render at the same vertical height as run rows.
          // `gap-4` matches the X badge's `-right-4` offset so the
          // badge ends exactly where the chevron starts — no overlap
          // when hovered, no chevron-as-leftover-X confusion when not.
          //
          // The `sticky left-0` on the inner div was the original
          // trick when this cell spanned the whole row: it kept the
          // label glued to the viewport left while the row scrolled
          // horizontally. With `hasAggregates` we hoist sticky to the
          // TableCell itself (so the cell/label pair scrolls as one),
          // and the inner div reverts to plain flow.
          className={cn(
            "items-center px-2 py-2",
            // Layout mode:
            //   - Flat / no-aggregates: keep the original inline-flex
            //     that could grow up to viewport width, since the cell
            //     spans the whole row anyway.
            //   - Aggregates on: switch to flex + min-w-0 so the
            //     shrinkable text children (see `truncate` below on
            //     the value span) actually shrink instead of pushing
            //     the whole row past the cell boundary.
            hasAggregates ? "flex min-w-0 gap-2" : "inline-flex max-w-[100vw] gap-4 sticky left-0",
          )}
          style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
        >
          {/* Eye toggle — clicking stops propagation so the row's
              expand-on-click doesn't also fire. Hides this bucket
              (and via prefix match every descendant) from the
              grouped chart.

              Three render states (cascade visualisation):
              - Open eye  → bucket is visible (not in hidden set, no
                hidden ancestor either)
              - Closed eye → bucket is explicitly hidden, OR its
                effective hidden state comes from an ancestor being
                hidden. Either way the chart isn't aggregating it.
              The click target itself always toggles THIS bucket's
              pathKey; we don't try to unhide ancestors from a
              cascaded child (clicking a cascaded child currently
              adds it to the hidden set too — no-op for the chart
              but harmless visual feedback). */}
          {/* Eye + X wrapper — `w-6` (24px) middle ground: wider than
              the 16px eye so the X badge (at `-right-3`) lands JUST
              past the eye instead of overlapping it, but narrower
              than the run-row's 40px cell so the X stays close
              instead of floating off to the right. */}
          <div className="flex shrink-0 items-center gap-1.5">
            {/* Selection checkbox — checking selects every run in this bucket
                (plots them + marks them for bulk actions), unchecking deselects
                them. Mirrors the per-run checkbox in columns.tsx so grouped and
                flat rows share one selection grammar. */}
            {/* Wrapped in Tooltip exactly like the per-run CheckboxCell in
                columns.tsx — matches main's checkbox design pixel-for-pixel
                (the TooltipTrigger's `asChild` is what gives the run/group
                checkboxes their shared look). */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Checkbox
                  checked={isSelected}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isSelected) {
                      deselectBucket(bucketPathKey);
                    } else {
                      // Fire-and-forget; the bucket-selection signal fetches
                      // the bucket's runs and writes the per-run selections.
                      selectAllInBucket(bucketFilters);
                    }
                  }}
                  aria-label={
                    isSelected
                      ? "Deselect all runs in group"
                      : "Select all runs in group"
                  }
                  data-testid={`bucket-checkbox-d${depth}`}
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {isSelected
                  ? "Deselect all runs in group"
                  : "Select all runs in group"}
              </TooltipContent>
            </Tooltip>
            {/* Eye — pure chart-visibility toggle, shown only once the group is
                selected (an unselected group has nothing to show/hide). Matches
                the per-run eye in columns.tsx: bright when visible, muted with a
                colour dot when hidden. Toggling fans out per-run hides so a
                single child can later override the group via its own eye. */}
            {isSelected && (
              <button
                type="button"
                className={cn(
                  // No padding + 16px icon (matches the per-run eye) so it
                  // never exceeds the 16px checkbox — the group row keeps the
                  // same height whether or not the selected-only eye shows.
                  // `inline-flex items-center` centres the icon so the hidden
                  // EyeOff lines up with the visible Eye (see columns.tsx).
                  "relative inline-flex shrink-0 items-center justify-center",
                  hasVisibleChartLine
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                data-testid={`bucket-visibility-toggle-d${depth}`}
                aria-label={hasVisibleChartLine ? "Hide group" : "Show group"}
                title={hasVisibleChartLine ? "Hide group" : "Show group"}
                onClick={(e) => {
                  e.stopPropagation();
                  setBucketHidden(bucketPathKey, hasVisibleChartLine);
                }}
              >
                {/* Match the per-run eye in columns.tsx exactly (main's design):
                    EyeOff + a top-right colour dot wrapped in an inline-flex
                    span. Leaf buckets carry the chart line's colour; parent
                    buckets have none, so (like main) they show no dot. */}
                {hasVisibleChartLine ? (
                  <Eye className="h-4 w-4" />
                ) : (
                  <span className="relative inline-flex">
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                    {color && (
                      <span
                        className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-background"
                        style={{ backgroundColor: color }}
                      />
                    )}
                  </span>
                )}
              </button>
            )}
          </div>
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          {/* Color swatch only on leaf buckets — parents are containers
              and don't carry a color (matches W&B's behaviour). */}
          {color && (
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
              aria-hidden
            />
          )}
          <span className="shrink-0 font-medium text-muted-foreground">
            {groupFieldLabel(field)}:
          </span>
          <span
            className={cn(
              "min-w-0 truncate font-mono text-xs",
              value === null && "italic text-muted-foreground",
              // Mute the bucket VALUE ("8" in "batch_size: 8") when
              // the group has no selected runs — same idea as the
              // run-row text muting. Field label + count badge are
              // already `text-muted-foreground` so the whole row
              // reads uniformly gray for deselected groups.
              !isSelected && "text-muted-foreground",
            )}
          >
            {value === null ? "(unset)" : value}
          </span>
          {subgroupCountLabel != null && (
            <span className="ml-2 shrink-0 text-xs text-muted-foreground">
              {/* Inner-row count noun depends on whether the next level
                  is the leaf or a true subgroup. Per the vocab rules in
                  .github/GROUPING_V2_PR_NOTES.md:
                    depth+2 === groupByLength → next level is the leaf
                                                → "leaf group(s)"
                    depth+2 <  groupByLength → next level is an
                                               intermediate
                                               → "subgroup(s)"
                  "subgroups" only ever appears with groupByLength ≥ 3. */}
              {subgroupCountLabel}
              {" "}
              {depth + 2 === groupByLength
                ? subgroupCountLabel === "1" ? "leaf group" : "leaf groups"
                : subgroupCountLabel === "1" ? "subgroup" : "subgroups"}
            </span>
          )}
          <span className="ml-2 shrink-0 text-xs text-muted-foreground">
            {count.toLocaleString()} {count === 1 ? "run" : "runs"}
          </span>
        </div>
      </TableCell>
      {hasAggregates && columnOrder.slice(labelSpan).map((colId) => {
        const aggInfo = aggregateColIdIndex?.get(colId);
        const rawVal = aggInfo && aggregates ? aggregates[aggInfo.idx] : null;
        const pinInfo = pinnedColumnMap[colId];
        const colBg = colBgById.get(colId);
        // Background composition mirrors data-table.tsx `renderHeaderCell`
        // and run-row.tsx:
        //   pinned  : linear-gradient(<tint>, <tint>), <opaque bg>
        //             so scrolled content doesn't bleed through and
        //             the user-set color tints the cell.
        //   flowing : plain rgba tint if colBg set, else the muted
        //             15% surface used by every group row.
        let bgStyle: React.CSSProperties;
        if (pinInfo) {
          const tint = colBg
            ? `${colBg}10`
            : "hsl(var(--muted) / 0.15)";
          bgStyle = {
            background: `linear-gradient(${tint}, ${tint}), hsl(var(--background))`,
            left: pinInfo.left,
            ...(pinInfo.isLast && { borderRight: '2px solid hsl(var(--border))' }),
          };
        } else if (colBg) {
          bgStyle = { backgroundColor: `${colBg}10` };
        } else {
          bgStyle = {};
        }
        return (
          <TableCell
            key={colId}
            onClick={onToggle}
            className={cn(
              "cursor-pointer px-2 py-2 text-sm text-muted-foreground",
              isHidden && "opacity-50",
              pinInfo
                ? "sticky z-[9] group-hover/bucket:brightness-110"
                : !colBg && "bg-muted/15 group-hover/bucket:bg-muted/30",
            )}
            style={bgStyle}
          >
            {rawVal != null && aggInfo ? formatBucketAggregate(rawVal, aggInfo.kind) : null}
          </TableCell>
        );
      })}
    </TableRow>
  );
}

/** Number → `137.75`; date epoch seconds → relative time (`3d ago`).
 *  Text/status/tags columns (kind="blank") always render as an empty
 *  string per W&B parity. */
function formatBucketAggregate(value: number, kind: "number" | "date" | "blank"): string {
  if (kind === "blank" || !isFinite(value)) return "";
  if (kind === "date") {
    const now = Date.now() / 1000;
    const delta = now - value;
    if (delta < 60) return "just now";
    if (delta < 3600) return `${Math.round(delta / 60)}m ago`;
    if (delta < 86400) return `${Math.round(delta / 3600)}h ago`;
    if (delta < 86400 * 30) return `${Math.round(delta / 86400)}d ago`;
    if (delta < 86400 * 365) return `${Math.round(delta / (86400 * 30))}mo ago`;
    return `${Math.round(delta / (86400 * 365))}y ago`;
  }
  const abs = Math.abs(value);
  if (abs >= 1e6 || (abs > 0 && abs < 1e-3)) return value.toExponential(2);
  return value.toFixed(2).replace(/\.?0+$/, "");
}

interface BucketRunsProps {
  filters: GroupFilter[];
  baseFilters: BaseFilters;
  organizationId: string;
  projectName: string;
  colSpan: number;
  columns: ColumnDef<Run, any>[];
  columnOrder: string[];
  pinnedColumnMap: Record<string, { left: number; isLast: boolean }>;
  selectedRunsWithColors: Record<string, { run: Run; color: string }>;
  hiddenRunIds: Set<string>;
  tableBodyRef: React.RefObject<HTMLTableSectionElement | null>;
  bucketColor: string;
  onColorChange: (runId: string, color: string) => void;
  runFirstCellPaddingLeft?: number;
  /** When true, only selected runs render — non-selected leaf rows
   *  are filtered out client-side after the server fetch. The
   *  inline-paginator's "01-10 of N" indicator is recomputed off
   *  the filtered count so the user doesn't see ghost pages. */
  showOnlySelected?: boolean;
  /** When true, selected runs sort to the top of the visible page
   *  slice (within-page reorder; no overflow at the leaf level). */
  pinSelectedToTop?: boolean;
  /** Metric columns the user has visible. `BucketRuns` fires its own
   *  `useMetricSummaries` fetch keyed by (bucket runs × these specs) —
   *  without this the metric cells for leaf runs render as "-" even
   *  when ClickHouse has data. The flat-table path in index.tsx
   *  already does this for `allVisibleRuns`; the bucket tree needs to
   *  do the equivalent for its own runs. */
  metricColumnSpecs?: Array<{ logName: string; aggregation: "MIN" | "MAX" | "AVG" | "LAST" | "VARIANCE" }>;
  /** Active sort — threaded so leaf runs INSIDE a bucket sort by the same
   *  column/direction as the buckets themselves (W&B parity). Omitted → the
   *  runs.list fetch falls back to createdAt DESC. A metric sort routes
   *  runs.list through metricSortQuery (ClickHouse), scoped by `filters`. */
  sortField?: string;
  sortSource?: "system" | "config" | "systemMetadata" | "metric";
  sortDirection?: "asc" | "desc";
  sortAggregation?: "MIN" | "MAX" | "AVG" | "LAST" | "VARIANCE";
}

/** Leaf-level bucket: fetch the runs that fall in this bucket and render
 *  them through the standard `<RunRow>` (full column config + sticky
 *  pinning + selection eye). Each bucket gets its own mini TanStack
 *  table whose `rowSelection` is derived from the parent's
 *  selectedRunsWithColors — so selecting a row anywhere in the tree
 *  flows through the same toggle path as the flat table. */
function BucketRuns({
  filters,
  baseFilters,
  organizationId,
  projectName,
  colSpan,
  columns,
  columnOrder,
  pinnedColumnMap,
  selectedRunsWithColors,
  hiddenRunIds,
  tableBodyRef,
  bucketColor,
  onColorChange,
  runFirstCellPaddingLeft,
  showOnlySelected,
  pinSelectedToTop,
  metricColumnSpecs,
  sortField,
  sortSource,
  sortDirection,
  sortAggregation,
}: BucketRunsProps) {
  // Leaf-runs flip pagination (Phase 10-D): wandb caps inside-leaf
  // runs at 10 per page and shows `01-10 of N` with prev/next. We
  // mirror that exactly — the cap is hardcoded PAGE_SIZE (10), the
  // pageIndex is local per-leaf, and the total comes from the
  // existing `runs.count` proc (no backend change needed; runs.list
  // already supports limit+offset).
  const [runsPageIndex, setRunsPageIndex] = useState(0);
  // When DOS or Pin is on at leaf level, fetch the entire bucket so
  // we can reorder selected-first across the whole list and then
  // paginate normally with the inline 10/page paginator. 200 matches
  // runs.list's hard cap (list-runs.ts:120-ish); buckets larger than
  // that fall back to the per-page reorder.
  const clientPaginateLeaf = pinSelectedToTop || showOnlySelected;
  const queryOptions = trpc.runs.list.queryOptions({
    organizationId,
    projectName,
    groupFilters: filters,
    ...baseFilters,
    // Sort the leaf runs by the active column/direction — same as the buckets.
    // For a metric sort this scopes metricSortQuery to `filters` (this bucket),
    // and offset paging works (metricSortQuery supports offset).
    sortField,
    sortSource,
    sortDirection,
    sortAggregation,
    limit: clientPaginateLeaf ? 200 : PAGE_SIZE,
    offset: clientPaginateLeaf ? 0 : runsPageIndex * PAGE_SIZE,
  });
  const { data, isLoading } = useQuery(queryOptions);
  // Parallel count so we know the total before users start paginating.
  const countQuery = useQuery(
    trpc.runs.count.queryOptions({
      organizationId,
      projectName,
      groupFilters: filters,
      ...baseFilters,
    }),
  );
  // runs.count returns a plain number, not a wrapper object.
  const totalRuns = (countQuery.data as number | undefined) ?? 0;

  const rawRuns: Run[] = useMemo(() => (data as any)?.runs ?? [], [data]);

  // Full ordered list when client-paginating. DOS gives selected-only;
  // Pin gives selected-first followed by unselected. The inline pager
  // walks this same list so a (de)select doesn't flicker the visible
  // page back and forth — the user just watches the row move to its
  // new position.
  const orderedRuns: Run[] | null = useMemo(() => {
    if (!clientPaginateLeaf) return null;
    if (showOnlySelected) return rawRuns.filter((r) => !!selectedRunsWithColors[r.id]);
    const pinned: Run[] = [];
    const others: Run[] = [];
    for (const r of rawRuns) {
      if (selectedRunsWithColors[r.id]) pinned.push(r);
      else others.push(r);
    }
    return pinned.concat(others);
  }, [clientPaginateLeaf, rawRuns, showOnlySelected, selectedRunsWithColors]);

  // Client-side slice for the current page. When not client-paginating,
  // rawRuns IS the page (server already sliced).
  const rawPageRuns: Run[] = useMemo(() => {
    if (orderedRuns) {
      const start = runsPageIndex * PAGE_SIZE;
      return orderedRuns.slice(start, start + PAGE_SIZE);
    }
    return rawRuns;
  }, [orderedRuns, rawRuns, runsPageIndex]);


  // Metric column values live on `run.metricSummaries` — columns-utils
  // reads them out for RunRow's metric cells. In flat mode index.tsx
  // wires this up via `useMetricSummaries(allVisibleRuns…)`; here we
  // fire the equivalent fetch for THIS bucket's runs so leaf-run
  // metric cells actually show numbers instead of "-". Skipped
  // entirely when there are no metric columns (0 runIds → hook
  // stays disabled → no query).
  const pageRunIds = useMemo(() => rawPageRuns.map((r) => r.id), [rawPageRuns]);
  const metricSpecsSafe = metricColumnSpecs ?? EMPTY_METRIC_SPECS;
  const { data: metricSummariesData, loadedRunIds: metricLoadedRunIds } =
    useMetricSummaries(organizationId, projectName, pageRunIds, metricSpecsSafe);
  const runs: Run[] = useMemo(() => {
    if (metricSpecsSafe.length === 0) return rawPageRuns;
    const summaries = metricSummariesData?.summaries ?? {};
    return rawPageRuns.map((r) => {
      const runSummaries = summaries[r.id];
      const isLoading = !metricLoadedRunIds.has(r.id);
      if (runSummaries == null && !isLoading) return r;
      return {
        ...r,
        metricSummaries: runSummaries,
        _metricsLoading: isLoading,
      } as Run & { metricSummaries?: Record<string, number>; _metricsLoading?: boolean };
    });
  }, [rawPageRuns, metricSummariesData, metricLoadedRunIds, metricSpecsSafe.length]);

  // Effective total for the inline paginator. Both client-paginate modes
  // (Pin / DOS) load at most 200 runs and reorder them client-side, so the
  // paginator caps at the loaded window — else Pin renders phantom empty pages
  // past the 200th run in a >200-run bucket (see effectiveLeafRunTotal / B8).
  const effectiveTotalRuns = useMemo(
    () => effectiveLeafRunTotal(orderedRuns, totalRuns),
    [orderedRuns, totalRuns],
  );

  // Clamp the local pageIndex when (de)selecting drops the effective
  // total below the current page's start. Without this, the user
  // would land on an empty inline page after a single deselect
  // dropped DOS's total from 11 to 9 while runsPageIndex was 1.
  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(effectiveTotalRuns / PAGE_SIZE) - 1);
    if (runsPageIndex > maxPage) setRunsPageIndex(maxPage);
  }, [effectiveTotalRuns, runsPageIndex]);

  // Push the bucket color through the page-level color state for every
  // run in this bucket that's ALREADY in the selection. Re-fires only
  // when the runs list or the bucket color changes, and skips runs
  // whose current page-level color is already the bucket color (avoids
  // an infinite re-render bounce through selectedRunsWithColors →
  // runs list).
  //
  // The `entry` guard is load-bearing: without it, `current` is
  // `undefined` for deselected runs, `undefined !== bucketColor`
  // passes, and `onColorChange` re-adds the run to the selection.
  // That bug manifested as "deselect a run on page 1, paginate, come
  // back to page 1, deselected runs are silently re-selected."
  const onColorChangeRef = useRef(onColorChange);
  useEffect(() => {
    onColorChangeRef.current = onColorChange;
  }, [onColorChange]);
  // Push the bucket's color onto every currently-selected leaf run.
  // Reads `selectedRunsWithColors` DIRECTLY (not through a ref) and
  // depends on it so the effect actually re-fires when the user
  // selects a run that's already in this bucket's visible page.
  // Previously we held a ref + effect keeping it in sync and read
  // `.current` here — but `runs` doesn't depend on
  // `selectedRunsWithColors`, so a newly-selected run in the same
  // bucket kept its default random color and the color dot in the
  // table diverged from the chart line. The `entry.color !==
  // bucketColor` guard below prevents an infinite loop: once
  // onColorChange has run for every selected run in this bucket
  // and updated their colors to bucketColor, the guard falls
  // through on the next fire and nothing happens.
  useEffect(() => {
    for (const r of runs) {
      const entry = selectedRunsWithColors[r.id];
      // Only push the colour for runs already in the selection.
      // Deselected runs MUST stay deselected, even on page-change
      // re-render of this bucket.
      if (entry && entry.color !== bucketColor) {
        onColorChangeRef.current(r.id, bucketColor);
      }
    }
  }, [runs, bucketColor, selectedRunsWithColors]);

  // Derived row-selection state — keeps the eye/visibility toggle in
  // each bucket honest about which runs the user has selected from
  // anywhere in the table.
  const rowSelection = useMemo(
    () => computeRowSelection(runs, selectedRunsWithColors),
    [runs, selectedRunsWithColors],
  );

  const table = useReactTable({
    data: runs,
    columns,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    state: {
      rowSelection,
      columnOrder,
    },
    enableRowSelection: true,
  });

  if (isLoading) {
    return (
      <TableRow>
        <TableCell colSpan={colSpan} className="py-3 text-center text-xs text-muted-foreground">
          <Loader2 className="mr-2 inline h-3 w-3 animate-spin" />
          Loading runs…
        </TableCell>
      </TableRow>
    );
  }

  if (runs.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={colSpan} className="py-3 text-center text-xs text-muted-foreground">
          No runs in this bucket.
        </TableCell>
      </TableRow>
    );
  }

  return (
    <>
      {table.getRowModel().rows.map((row) => (
        <RunRow
          key={row.id}
          row={row}
          pinnedColumnMap={pinnedColumnMap}
          tableBodyRef={tableBodyRef}
          isHidden={hiddenRunIds.has(row.original.id)}
          firstCellPaddingLeft={runFirstCellPaddingLeft}
        />
      ))}
      {effectiveTotalRuns > PAGE_SIZE && (
        <TableRow>
          <TableCell colSpan={colSpan} className="py-1">
            <InlinePager
              pageIndex={runsPageIndex}
              pageSize={PAGE_SIZE}
              totalCount={effectiveTotalRuns}
              // BucketRuns is always at the deepest level; inline
              // pager indents one beyond the leaf bucket header so
              // it visually nests under the runs.
              depth={(filters.length ?? 0)}
              onPageChange={setRunsPageIndex}
              testId="bucket-runs-pager"
              // Pin loads at most the first 200 runs of a bucket and reorders
              // them client-side. When a group has more than that, the extra
              // runs aren't pageable while pinned — surface a tooltip so a user
              // hunting for run #201+ knows why it's missing (and how to see it).
              // Only on the LAST loaded page (where Next is disabled and they
              // hit the wall), not on every page.
              capNote={
                pinSelectedToTop &&
                !showOnlySelected &&
                totalRuns > effectiveTotalRuns &&
                runsPageIndex >= Math.ceil(effectiveTotalRuns / PAGE_SIZE) - 1
                  ? `Showing the first ${effectiveTotalRuns} of ${totalRuns} runs — Pin to Top loads at most ${effectiveTotalRuns} per group. Turn Pin off to page through all ${totalRuns}.`
                  : undefined
              }
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/** wandb-style inline mini-paginator rendered under an expanded
 *  subgroup / leaf-run list. Shows `01-10 of N` with prev/next
 *  arrows; fixed 10-per-page (the cap is the user-locked constant
 *  for nested levels). Renders nothing when totalCount ≤ pageSize
 *  (a single page) — callers gate the surrounding TableRow on the
 *  same condition. */
function InlinePager({
  pageIndex,
  pageSize,
  totalCount,
  depth,
  onPageChange,
  testId,
  capNote,
}: {
  pageIndex: number;
  pageSize: number;
  totalCount: number;
  /** Used to indent the pager so it lines up with the bucket level
   *  it belongs to (matches the BucketHeaderRow's depth-based
   *  padding). */
  depth: number;
  onPageChange: (next: number) => void;
  testId?: string;
  /** When the paginator total is capped below the real run count (Pin /
   *  DOS only load the first 200 of a bucket), this explains why — shown
   *  as a hover tooltip on the "of N" label so a user hunting for a run
   *  past the 200th isn't left wondering where it went. */
  capNote?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const start = totalCount === 0 ? 0 : pageIndex * pageSize + 1;
  const end = Math.min((pageIndex + 1) * pageSize, totalCount);
  const padStart = (n: number) => String(n).padStart(2, "0");

  return (
    <div
      // Sticky left-0 keeps the pager visible during horizontal scroll
      // (matches BucketHeaderRow's inner div behaviour). Padding
      // formula mirrors BucketHeaderRow's `0.5rem + depth * 1.25rem`
      // EXACTLY so the pager sits directly under the bucket-tree
      // level it paginates — root pagination under "Group:", nested
      // under each parent's indent, runs-pager under the leaf bucket.
      className="sticky left-0 inline-flex max-w-[100vw] items-center gap-1 text-xs text-muted-foreground"
      style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
      data-testid={testId}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={() => onPageChange(Math.max(0, pageIndex - 1))}
        disabled={pageIndex === 0}
        data-testid={testId ? `${testId}-prev` : undefined}
      >
        <ChevronLeft className="h-3 w-3" />
      </Button>
      {capNote ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="tabular-nums cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2"
              data-testid={testId ? `${testId}-label` : undefined}
            >
              {padStart(start)}-{padStart(end)} of {totalCount}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-72 text-xs">
            {capNote}
          </TooltipContent>
        </Tooltip>
      ) : (
        <span className="tabular-nums" data-testid={testId ? `${testId}-label` : undefined}>
          {padStart(start)}-{padStart(end)} of {totalCount}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={() => onPageChange(Math.min(totalPages - 1, pageIndex + 1))}
        disabled={pageIndex >= totalPages - 1}
        data-testid={testId ? `${testId}-next` : undefined}
      >
        <ChevronRight className="h-3 w-3" />
      </Button>
    </div>
  );
}
