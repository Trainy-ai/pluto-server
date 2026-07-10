"use client";

import React from "react";
import { flexRender, type Row, type SortingState } from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRef, useMemo, useCallback, useEffect, useReducer, useState } from "react";
import { ChevronDown, ChevronRight, GripVertical, Pin } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { columns } from "./columns";
import type { Run } from "../../~queries/list-runs";
import type { ColumnConfig, BaseColumnOverrides } from "../../~hooks/use-column-config";
import { extractServerFilters, type RunFilter, type FilterableField, type SortParam } from "@/lib/run-filters";
import { useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import { computeSelectedAncestorPaths } from "./group-by-utils";
import { columnTableId } from "./column-table-id";
import type { ListMode } from "./components/experiment-runs-toggle";
import type { Header } from "@tanstack/react-table";
import { computePinnedColumnIds, BASE_PINNED_IDS } from "./lib/pinned-columns";
import { MIN_COL_WIDTH } from "./hooks/use-column-resize";
import { useDataTableState } from "./hooks/use-data-table-state";
import { TableToolbar } from "./components/table-toolbar";
import { GroupedBucketTree } from "./grouped-bucket-tree";
import { TablePagination } from "./components/table-pagination";
import { RunRow } from "./components/run-row";

type ViewMode = "charts" | "side-by-side";

// Width (px) of the right-edge zone of a pinned header cell that initiates a
// column resize on mousedown. Matches the visible resize handle's grab area.
const RESIZE_EDGE_ZONE_PX = 6;

interface DataTableProps {
  runs: Run[];
  /** Set of IDs the server's filtered runs.list returned. When provided
   *  alongside `filterActive`, the table draws a divider after the last
   *  matched row to separate filter-matching rows from sticky-appended
   *  selected-but-non-matching rows below. */
  serverFilteredRunIds?: Set<string>;
  filterActive?: boolean;
  orgSlug: string;
  projectName: string;
  organizationId?: string;
  onColorChange: (runId: string, color: string) => void;
  /** runFallback lets callers select a run not currently in the
   *  `runs` prop — required for grouped-mode "Select all on page"
   *  which fetches bucket runs ad-hoc via queryClient.fetchQuery and
   *  passes them straight through. handleRunSelection (see use-
   *  selected-runs.ts:561) silently no-ops without the fallback. */
  onSelectionChange: (runId: string, isSelected: boolean, runFallback?: Run) => void;
  onToggleVisibility: (runId: string) => void;
  /** Bulk visibility setter — bucket-tree group-eye toggles use this
   *  to fan out to every descendant run, eliminating the need for a
   *  separate group-hide state that can't be overridden per-run. */
  onSetRunsHidden: (runIds: string[], hidden: boolean) => void;
  onTagsUpdate: (runId: string, tags: string[]) => void;
  onNotesUpdate: (runId: string, notes: string | null) => void;
  selectedRunsWithColors: Record<string, { run: Run; color: string }>;
  hiddenRunIds: Set<string>;
  runColors: Record<string, string>;
  runCount: number;
  totalRunCount: number;
  /** How many of the currently selected runs match the toolbar
   *  filter (chip filters — search excluded). undefined when there's
   *  no filter or no selection. Powers the toolbar's third status
   *  line: `N of your S selected runs match the filter`. */
  selectedFilterMatchCount?: number;
  /** Total distinct outermost-group values in the project, ignoring
   *  the toolbar filter. Powers the selection line's `out of N total
   *  groups` denominator — the existing `totalGroupCount` prop is
   *  filter-applied and produces confusing "8 of 1" reads. */
  totalGroupCountUnfiltered?: number;
  isLoading: boolean;
  isFetching?: boolean;
  fetchNextPage?: () => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  /** Total rows the server has actually returned across all fetched
   *  runs.list pages. Used for the *fetch trigger* (Next-button +
   *  typed-page-input) only — not for totalPages math. Decoupled from
   *  `displayedRuns.length`, which is inflated by URL-prefetched /
   *  cached selection runs and would otherwise falsely tell the Next
   *  button "we already have enough data, no need to fetch". */
  serverFetchedCount?: number;
  allTags: string[];
  filters: RunFilter[];
  filterableFields: FilterableField[];
  onAddFilter: (filter: RunFilter) => void;
  onRemoveFilter: (filterId: string) => void;
  onClearFilters: () => void;
  onFieldSearch?: (search: string) => void;
  isSearchingFields?: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSearchFocus?: () => void;
  showOnlySelected: boolean;
  onShowOnlySelectedChange: (value: boolean) => void;
  pinSelectedToTop: boolean;
  onPinSelectedToTopChange: (value: boolean) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  panelLayout?: "both" | "list-only" | "graphs-only";
  onToggleListPanel?: () => void;
  onToggleGraphsPanel?: () => void;
  onSelectFirstN: (n: number) => void;
  onSelectAllByIds: (runIds: string[]) => void;
  onDeselectByIds: (runIds: string[]) => void;
  onDeselectAll: () => void;
  onShuffleColors: () => void;
  onReassignAllColors: () => void;
  onShowAllRuns: () => void;
  onHideAllRuns: () => void;
  customColumns?: ColumnConfig[];
  availableConfigKeys?: string[];
  availableSystemMetadataKeys?: string[];
  availableMetricNames?: string[];
  onColumnToggle?: (col: ColumnConfig) => void;
  onClearColumns?: () => void;
  columnKeysLoading?: boolean;
  onColumnSearch?: (search: string) => void;
  isSearchingColumns?: boolean;
  onColumnRename?: (colId: string, source: string, newName: string, aggregation?: string) => void;
  onColumnSetColor?: (colId: string, source: string, color: string | undefined, aggregation?: string) => void;
  onColumnRemove?: (colId: string, source: string, aggregation?: string) => void;
  nameOverrides?: BaseColumnOverrides;
  onNameRename?: (newName: string) => void;
  onNameSetColor?: (color: string | undefined) => void;
  onReorderColumns?: (fromIndex: number, toIndex: number) => void;
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
  /** Pre-decoded form of `sorting` for the grouped bucket-tree query.
   *  Index.tsx already builds it for `runs.list`; passing it down lets
   *  the bucket query order each level by an aggregate of the same
   *  column without re-parsing the SortingState here. */
  sortParam?: SortParam;
  statusFilterValues?: string[];
  onStatusFilterChange?: (values: string[]) => void;
  /** Bulk-actions checkbox selection (decoupled from the eye/chart selection) */
  checkedRunIds?: Set<string>;
  onSetChecked?: (runIds: string[], checked: boolean, runFallbacks?: Run[]) => void;
  /** Run records for the checked set — what bulk delete operates on. */
  checkedRunsWithColors?: Record<string, { run: Run; color: string }>;
  /** Called after the checked runs are deleted, with the deleted run IDs. */
  onCheckedDeleted?: (deletedRunIds: string[]) => void;
  pageSize: number;
  onPageSizeChange: (pageSize: number) => void;
  pageBase?: number;
  onJumpToPage?: (absolutePageIndex: number) => void;
  viewSelector?: React.ReactNode;
  activeChartViewId?: string | null;
  onToggleColumnPin?: (colId: string, source: string, aggregation?: string) => void;
  onPinImagesToBestStep?: (
    logName: string,
    mode: "argmin" | "argmax" | "argmin-with-image" | "argmax-with-image",
    toleranceOverride?: number,
  ) => void;
  bestStepToleranceSteps?: number;
  onChangeBestStepTolerance?: (next: number) => void;
  listMode: ListMode;
  onListModeChange: (mode: ListMode) => void;
  showInherited: boolean;
  onInheritedToggle: () => void;
  /** Encoded grouping fields — `system:status`, `config:lr`,
   *  `tag-prefix:group`. Empty = no grouping. */
  groupBy: string[];
  onGroupByChange: (groupBy: string[]) => void;
  /** Expanded bucket trails, each entry a JSON-stringified
   *  `{field, value}[]` path. Empty = all collapsed. */
  expandedGroups: string[];
  onExpandedGroupsChange: (expanded: string[]) => void;
  searchOtherMatchesDropdown?: React.ReactNode;
}

export function DataTable({
  runs,
  serverFilteredRunIds,
  filterActive,
  orgSlug,
  projectName,
  organizationId,
  onColorChange,
  onSelectionChange,
  onToggleVisibility,
  onSetRunsHidden,
  onTagsUpdate,
  onNotesUpdate,
  selectedRunsWithColors,
  hiddenRunIds,
  runColors,
  runCount,
  totalRunCount,
  selectedFilterMatchCount,
  totalGroupCountUnfiltered,
  isLoading,
  isFetching,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  serverFetchedCount = 0,
  allTags,
  filters,
  filterableFields,
  onAddFilter,
  onRemoveFilter,
  onClearFilters,
  onFieldSearch,
  isSearchingFields,
  searchQuery,
  onSearchChange,
  onSearchFocus,
  viewMode,
  onViewModeChange,
  panelLayout = "both",
  onToggleListPanel,
  onToggleGraphsPanel,
  onSelectFirstN,
  onSelectAllByIds,
  onDeselectByIds,
  onDeselectAll,
  onShuffleColors,
  onReassignAllColors,
  onShowAllRuns,
  onHideAllRuns,
  customColumns = [],
  availableConfigKeys = [],
  availableSystemMetadataKeys = [],
  availableMetricNames = [],
  onColumnToggle,
  onClearColumns,
  columnKeysLoading,
  onColumnSearch,
  isSearchingColumns,
  onColumnRename,
  onColumnSetColor,
  onColumnRemove,
  nameOverrides,
  onNameRename,
  onNameSetColor,
  onReorderColumns,
  sorting,
  onSortingChange,
  sortParam,
  statusFilterValues,
  onStatusFilterChange,
  checkedRunIds,
  onSetChecked,
  checkedRunsWithColors,
  onCheckedDeleted,
  pageSize,
  onPageSizeChange,
  pageBase = 0,
  onJumpToPage,
  viewSelector,
  activeChartViewId,
  onToggleColumnPin,
  onPinImagesToBestStep,
  bestStepToleranceSteps,
  onChangeBestStepTolerance,
  listMode,
  onListModeChange,
  showInherited,
  onInheritedToggle,
  groupBy,
  onGroupByChange,
  expandedGroups,
  onExpandedGroupsChange,
  showOnlySelected,
  onShowOnlySelectedChange,
  pinSelectedToTop,
  onPinSelectedToTopChange,
  searchOtherMatchesDropdown,
}: DataTableProps) {
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  // Track the scroll container's clientWidth (the *visible* table
  // width, not the total scrolled table width) as a CSS custom
  // property `--tbl-visible-w` on the container itself. Full-row
  // labels (pin divider, empty-state) size themselves to this so
  // `text-center` centers in the viewport rather than in the total
  // scrolled table width — otherwise the label ends up wherever the
  // table midpoint happens to be, often off-screen right.
  //
  // Uses a callback ref for attachment because the three branches
  // of the render below all point at `mainScrollRef`, and only one
  // is mounted at a time. A plain `useEffect(() => …, [])` would
  // grab whichever branch happened to be mounted at first render
  // (or null) and never re-attach on branch swap. The callback
  // still writes to mainScrollRef.current so existing consumers
  // (highlight handler, etc.) keep working.
  const scrollObserverRef = useRef<ResizeObserver | null>(null);
  const setScrollEl = useCallback((el: HTMLDivElement | null) => {
    mainScrollRef.current = el;
    scrollObserverRef.current?.disconnect();
    scrollObserverRef.current = null;
    if (!el) return;
    const publish = () => {
      el.style.setProperty("--tbl-visible-w", `${el.clientWidth}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    scrollObserverRef.current = observer;
  }, []);
  useEffect(() => () => {
    scrollObserverRef.current?.disconnect();
    scrollObserverRef.current = null;
  }, []);
  // Ref-based getter for run colors — avoids recreating columns on every color change.
  // The version counter forces a single column re-creation when colors first populate
  // (e.g., from IndexedDB cache), preventing gray circles on initial render.
  const runColorsRef = useRef(runColors);
  const [colorVersion, bumpColorVersion] = useReducer((v: number) => v + 1, 0);
  useEffect(() => {
    const wasEmpty = Object.keys(runColorsRef.current).length === 0;
    runColorsRef.current = runColors;
    if (wasEmpty && Object.keys(runColors).length > 0) {
      bumpColorVersion();
    }
  }, [runColors]);
  const getRunColor = useCallback((runId: string) => runColorsRef.current[runId], []);

  const allTagsRef = useRef(allTags);
  useEffect(() => { allTagsRef.current = allTags; }, [allTags]);
  const getAllTags = useCallback(() => allTagsRef.current, []);

  // Top-level group pagination for the GroupedBucketTree. Driven by
  // the same footer that paginates the flat runs list — keeps the UX
  // consistent between modes (page-size dropdown + prev/next). The
  // tree itself owns its own depth-1+ "Show N more" affordance for
  // progressive disclosure inside an expanded parent.
  const [groupedPageIndex, setGroupedPageIndex] = useState(0);
  // Server can't return a total without a separate COUNT query —
  // `distinctGroupValues` uses LIMIT+1 to report hasMore. The bucket
  // tree pushes this up as it (re-)fetches the root level.
  const [groupedHasMore, setGroupedHasMore] = useState(false);
  // Total top-level group count for "1 / N" footer indicator. Comes
  // from distinctGroupValues' COUNT(*) OVER () window field (Phase
  // 10-D — wandb-parity pagination). 0 until the first root-level
  // query lands.
  const [groupedTotalCount, setGroupedTotalCount] = useState(0);
  // Real distinct count of outer group values — independent of DOS/Pin
  // and of the inflated `pages * pageSize` value above. Drives the
  // toolbar's "X of Y groups selected" label.
  const [groupedRealTotalCount, setGroupedRealTotalCount] = useState(0);
  // Visible top-level buckets on the current page — used by the
  // visibility-options popover to render "Select all on page (N
  // groups) (M runs)" and to iterate per-bucket selectAllInBucket /
  // deselectBucket calls. BucketTree fires onVisibleRootBucketsChange
  // whenever the root distinctGroupValues query lands; we cache the
  // last-seen list here.
  const [visibleRootBuckets, setVisibleRootBuckets] = useState<
    Array<{ value: string | null; count: number; subgroupCount?: number; pathFilters: { field: string; value: string | null }[] }>
  >([]);
  // Per-depth set of encoded ancestor paths for every selected run.
  // BucketTree uses this for DOS filtering (a bucket is visible iff
  // its encoded path is in selectedAncestorPaths[depth]) and for Pin
  // ordering (selected-containing buckets float to the top). Empty
  // array when groupBy is empty — saves the deeper code from having
  // to special-case the flat-mode path.
  const selectedAncestorPaths = useMemo(
    () => computeSelectedAncestorPaths(selectedRunsWithColors, groupBy),
    [selectedRunsWithColors, groupBy],
  );

  // Per-column aggregates for grouped rows. Two derivations from
  // `customColumns`:
  //   `bucketAggregateColumns` — the request the bucket-tree sends
  //   `bucketAggregateColIdIndex` — TanStack column-id → { slot, kind }
  //     so the bucket-header cell renderer can look up which
  //     `aggregates[i]` to read for the cell it's drawing and how to
  //     format the value. `kind: "blank"` means we render nothing
  //     (text/status/tags — W&B parity).
  // `system:name` is intentionally omitted: the bucket LABEL already
  // occupies that slot.
  const { bucketAggregateColumns, bucketAggregateColIdIndex } = useMemo(() => {
    // Only the sticky pinned prefix (select / status / name) has its
    // TanStack column id equal to the bare `id`. Every other column
    // — including "system" ones like notes / createdAt / tags —
    // lives in `customColumns` and its ColumnDef id is prefixed
    // `custom-<source>-<id>[-<agg>]`. Mirror that prefix here so the
    // BucketHeaderRow lookup by tableColumn id actually hits.
    const cols = customColumns.map((c) => ({
      source: c.source,
      field: c.id,
      ...(c.source === "metric" && c.aggregation ? { aggregation: c.aggregation } : {}),
    }));
    const SYSTEM_DATE_FIELDS = new Set(["createdAt", "updatedAt", "statusUpdated"]);
    const ids = new Map<string, { idx: number; kind: "number" | "date" | "blank" }>();
    customColumns.forEach((c, idx) => {
      const tableId = columnTableId(c);
      let kind: "number" | "date" | "blank";
      if (c.source === "metric") kind = "number";
      else if (c.source === "system") kind = SYSTEM_DATE_FIELDS.has(c.id) ? "date" : "blank";
      else kind = "number"; // config/sysmeta — backend nulls text/option out, we treat non-null as number
      ids.set(tableId, { idx, kind });
    });
    return { bucketAggregateColumns: cols, bucketAggregateColIdIndex: ids };
  }, [customColumns]);

  // Metric columns for the bucket tree's leaf-run rows. Bucket runs
  // are fetched independently of the flat table's `runs.list` (they
  // use `groupFilters`), so index.tsx's `useMetricSummaries` doesn't
  // see them and their metric cells otherwise render as "-". Mirrors
  // the shape `useMetricSummaries` expects.
  const bucketMetricColumnSpecs = useMemo(
    () => customColumns
      .filter((c): c is typeof c & { aggregation: "MIN" | "MAX" | "AVG" | "LAST" | "VARIANCE" } => c.source === "metric" && !!c.aggregation)
      .map((c) => ({ logName: c.id, aggregation: c.aggregation })),
    [customColumns],
  );
  // When DOS is on AND there's a search term, also derive ancestor
  // paths from the SEARCH-MATCHING subset of the selection. The
  // bucket tree uses these instead of the unfiltered set so groups
  // whose selected runs don't match the search drop out of the DOS
  // view entirely — symmetric with flat-mode DOS, where non-matching
  // selected runs disappear from the table. Counter / charts still
  // use the unfiltered `selectedAncestorPaths` so "X of Y groups
  // selected" stays accurate. Null when not in DOS+search mode.
  const dosSearchFilteredAncestorPaths = useMemo(() => {
    if (!showOnlySelected || !(searchQuery?.trim())) return null;
    const q = searchQuery.trim().toLowerCase();
    const subset: typeof selectedRunsWithColors = {};
    for (const [id, entry] of Object.entries(selectedRunsWithColors)) {
      if (((entry.run.name ?? "") as string).toLowerCase().includes(q)) {
        subset[id] = entry;
      }
    }
    return computeSelectedAncestorPaths(subset, groupBy);
  }, [showOnlySelected, searchQuery, selectedRunsWithColors, groupBy]);
  // Reset to page 0 whenever the grouping config or page size changes
  // — keeping a stale offset across a re-grouping would either show
  // an empty page (offset past the new total) or misleadingly land
  // mid-stream.
  // groupBy is an array prop; JSON-stringify the dep so a re-ordering
  // (different array identity, same contents) still triggers reset.
  const groupByKey = useMemo(() => JSON.stringify(groupBy), [groupBy]);
  // Also reset when the toolbar filters or search change: tightening a filter
  // shrinks the bucket total, so a stale deep offset would otherwise strand the
  // tree on an out-of-range (empty) page until the user paged back. (Filters are
  // an array prop — stringify for a stable dep.)
  //
  // Sort is included too, mirroring the leaf/nested pagers (which reset to page 1
  // on re-sort): a re-sort reorders the top-level bucket list, so keep the footer
  // on page 1 of the new order rather than a middle page. Without this, keepPrevious
  // Data would also briefly show the prior sort's bucket page while the root query
  // refetches at the old offset under the new sort.
  const filtersKey = useMemo(() => JSON.stringify(filters), [filters]);
  useEffect(() => {
    setGroupedPageIndex(0);
  }, [
    groupByKey,
    pageSize,
    filtersKey,
    searchQuery,
    sortParam?.field,
    sortParam?.source,
    sortParam?.direction,
    sortParam?.aggregation,
  ]);

  // Stable identity for the grouped bucket-tree's base filters. This object
  // was previously built inline in JSX on every render — and because it's a
  // dependency of GroupedBucketTree's render-hot `bucketSelectionSignal` memo,
  // a fresh identity each render defeated that memo entirely: it rebuilt the
  // covering selection Sets (O(selected × depth)) and re-rendered every bucket
  // header on ANY parent render (hover/scroll/keystroke). Memoizing on the
  // filter inputs keeps the reference stable so the signal only recomputes on
  // an actual selection/filter change.
  const groupBaseFilters = useMemo(
    () => ({
      search: searchQuery && searchQuery.trim() ? searchQuery.trim() : undefined,
      ...(extractServerFilters(filters) as Omit<
        ReturnType<typeof extractServerFilters>,
        "status"
      > & {
        status?: ("RUNNING" | "COMPLETED" | "FAILED" | "TERMINATED" | "CANCELLED")[];
      }),
    }),
    [searchQuery, filters],
  );


  const hiddenRunIdsRef = useRef(hiddenRunIds);
  useEffect(() => { hiddenRunIdsRef.current = hiddenRunIds; }, [hiddenRunIds]);
  const getIsHidden = useCallback((runId: string) => hiddenRunIdsRef.current.has(runId), []);

  // In experiments mode, build name→runIds map for group highlighting
  const experimentRunIdsMap = useMemo(() => {
    if (listMode !== "experiments") return null;
    const map = new Map<string, string[]>();
    for (const run of runs) {
      const existing = map.get(run.name) ?? [];
      existing.push(run.id);
      map.set(run.name, existing);
    }
    return map;
  }, [runs, listMode]);

  const getExperimentRunIds = useCallback((runName: string): string[] | undefined => {
    return experimentRunIdsMap?.get(runName);
  }, [experimentRunIdsMap]);

  // Listen for chart hover events to highlight the corresponding run row
  useEffect(() => {
    let lastHighlightedRow: HTMLElement | null = null;

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as string | string[] | null;
      const container = mainScrollRef.current;
      if (!container) return;

      // Clear previous highlight
      if (lastHighlightedRow) {
        lastHighlightedRow.querySelectorAll("td").forEach((td) => {
          td.style.boxShadow = "";
        });
        lastHighlightedRow.removeAttribute("data-chart-highlight");
        lastHighlightedRow = null;
      }

      // In experiments mode, detail may be an array — find the first matching row.
      // Detail values can now also be grouped-chart pathKeys (JSON-stringified
      // GroupFilter trails) when the user hovers a grouped chart line. Those
      // strings contain `[`, `{`, `"` etc. — invalid bare attribute-value
      // characters — so we run them through CSS.escape so the selector parses
      // even though no `data-run-id="<json>"` row will match (the table renders
      // bucket headers, not run rows keyed by pathKey).
      const runIds = Array.isArray(detail) ? detail : (detail ? [detail] : []);
      for (const runId of runIds) {
        const row = container.querySelector(`[data-run-id="${CSS.escape(runId)}"]`) as HTMLElement | null;
        if (row) {
          row.setAttribute("data-chart-highlight", "true");
          row.querySelectorAll("td").forEach((td) => {
            td.style.boxShadow = "inset 0 0 0 1000px rgba(59, 130, 246, 0.15)";
          });
          lastHighlightedRow = row;
          break; // highlight first visible row (experiment representative)
        }
      }
    };

    document.addEventListener("chart-hover-run", handler);
    return () => document.removeEventListener("chart-hover-run", handler);
  }, []);

  const pinnedColumnIds = useMemo(
    () => computePinnedColumnIds(customColumns),
    [customColumns],
  );

  // Total run count across the current page's root buckets (grouped mode) —
  // powers the header select-all state + the toolbar's "(M runs)" label.
  const groupedRunsOnPage = useMemo(
    () => visibleRootBuckets.reduce((sum, b) => sum + b.count, 0),
    [visibleRootBuckets],
  );
  // In grouped mode the header "select all on page" checkbox must act on the
  // buckets — the flat row model is empty when useListRuns is disabled — so it
  // reuses the SAME select/deselect-all-on-page handlers the visibility menu
  // uses. Those are defined below (they depend on fetchAllRunsInBuckets), so we
  // reach them through a ref and hand columns() stable wrappers.
  const groupedOnPageRef = useRef<{
    selectAll: () => void;
    deselectAll: () => void;
  } | null>(null);
  const onGroupedSelectAllOnPage = useCallback(
    () => groupedOnPageRef.current?.selectAll(),
    [],
  );
  const onGroupedDeselectAllOnPage = useCallback(
    () => groupedOnPageRef.current?.deselectAll(),
    [],
  );

  // Build column definitions (depends on stable getters above)
  const memoizedColumns = useMemo(
    () =>
      columns({
        orgSlug,
        projectName,
        organizationId,
        onColorChange,
        onSelectionChange,
        onToggleVisibility,
        onTagsUpdate,
        onNotesUpdate,
        getRunColor,
        getIsHidden,
        getAllTags,
        customColumns,
        onColumnRename,
        onColumnSetColor,
        onColumnRemove,
        nameOverrides,
        onNameRename,
        onNameSetColor,
        sorting,
        onSortingChange,
        activeChartViewId,
        isGrouped: groupBy.length > 0,
        pinnedColumnIds,
        onToggleColumnPin,
        onPinImagesToBestStep,
        bestStepToleranceSteps,
        onChangeBestStepTolerance,
        statusFilterValues,
        onStatusFilterChange,
        checkedRunIds,
        onSetChecked,
        groupedPageRunCount: groupedRunsOnPage,
        onGroupedSelectAllOnPage,
        onGroupedDeselectAllOnPage,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      orgSlug, projectName, organizationId,
      onColorChange, onSelectionChange, onToggleVisibility, onTagsUpdate, onNotesUpdate,
      getRunColor, getIsHidden, getAllTags, customColumns,
      onColumnRename, onColumnSetColor, onColumnRemove,
      nameOverrides, onNameRename, onNameSetColor,
      sorting, onSortingChange, activeChartViewId, groupBy,
      pinnedColumnIds, onToggleColumnPin, onPinImagesToBestStep,
      bestStepToleranceSteps, onChangeBestStepTolerance,
      statusFilterValues, onStatusFilterChange,
      checkedRunIds, onSetChecked,
      groupedRunsOnPage, onGroupedSelectAllOnPage, onGroupedDeselectAllOnPage,
      colorVersion, // trigger cell re-render when colors first populate
    ],
  );

  // Delegate all table state management to the hook
  const {
    pageIndex,
    setPageIndex,
    getWidth,
    handleMouseDown,
    resizeGeneration,
    draggedId,
    dragOverId,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
    isPinningActive,
    pinnedRuns,
    displayedRuns,
    displayedRunCount,
    totalExperimentCount,
    pageRunIds,
    deselectablePageRunIds,
    pinnedColumnMap,
    tableWidth,
    table,
    pinnedTable,
    columnOrder,
    effectivePageSize,
  } = useDataTableState({
    runs,
    selectedRunsWithColors,
    customColumns,
    onReorderColumns,
    filters,
    serverFilteredRunIds,
    searchQuery,
    sorting,
    pageSize,
    onPageSizeChange,
    memoizedColumns,
    pinnedColumnIds,
    orgSlug,
    projectName,
    listMode,
    showOnlySelected,
    pinSelectedToTop,
    onPinSelectedToTopChange,
    // Per-pixel indent applied to the FIRST (leftmost) column when
    // grouping is active. Matches BucketHeaderRow's depth formula so
    // the run-row eye sits one level deeper than the deepest bucket
    // header. Zero in flat mode.
    groupedIndentPx: groupBy.length > 0 ? (0.5 + groupBy.length * 1.25) * 16 : 0,
  });

  const groupedIndentPx = groupBy.length > 0
    ? (0.5 + groupBy.length * 1.25) * 16
    : 0;

  // Advance pageIndex explicitly after the fetch resolves. Previously
  // this was handled by a post-fetch effect keyed on runs.length growth
  // in useDataTableState, but that effect (a) didn't fire when URL-
  // prefetched runs already covered the newly fetched server page so
  // the click was silently lost, and (b) warped the user back to a
  // stale `lastPageIndexRef` when runs.length grew for non-click
  // reasons (e.g. a runs.list refetch after a window-focus invalidation
  // when another SDK had created a run). Explicit advance here is both
  // simpler and correct.
  const handleFetchNextPage = async () => {
    if (fetchNextPage && !isFetchingNextPage) {
      const target = pageIndex + 1;
      await fetchNextPage();
      setPageIndex(target);
    }
  };

  // ---- Grouped-mode "Select all on page" / "Deselect all on page" ----
  // Iterates the visible root-level buckets, fetches their leaf runs
  // via the same runs.list groupFilters mechanism the bucket tree's
  // internal selectAllInBucket uses (line 214), and feeds the
  // collected IDs to selectAllByIds / deselectByIds. Uses
  // queryClient.fetchQuery so it's lazy — zero idle cost while the
  // user is just paging through groups.
  const queryClient = useQueryClient();
  // Cap pages per bucket so a runaway bucket doesn't lock up — matches
  // the bucket tree's selectAllInBucket cap (10 pages × 200 = 2000).
  const fetchAllRunsInBuckets = useCallback(
    async (
      buckets: Array<{ pathFilters: { field: string; value: string | null }[] }>,
    ): Promise<Run[]> => {
      if (!organizationId) return [];
      const PER_PAGE = 200;
      const MAX_PAGES = 10;
      const collected: Run[] = [];
      const seen = new Set<string>();
      // Cast extracted.status to the narrow enum runs.list expects;
      // values come from STATUS_OPTIONS so the runtime is safe.
      const extracted = extractServerFilters(filters) as Omit<ReturnType<typeof extractServerFilters>, "status"> & { status?: ("RUNNING" | "COMPLETED" | "FAILED" | "TERMINATED" | "CANCELLED")[] };
      // Pages within a bucket stay sequential (page N+1 depends on the prior
      // `hasMore`), but buckets run in bounded-parallel batches so a full page
      // of buckets isn't one long sequential waterfall — while capping in-flight
      // requests so we don't unleash pageSize × MAX_PAGES fetches on the server.
      const CONCURRENCY = 6;
      const fetchBucketRuns = async (bucket: {
        pathFilters: { field: string; value: string | null }[];
      }): Promise<Run[]> => {
        const runs: Run[] = [];
        for (let page = 0; page < MAX_PAGES; page++) {
          try {
            const result = (await queryClient.fetchQuery({
              ...trpc.runs.list.queryOptions({
                organizationId,
                projectName,
                groupFilters: bucket.pathFilters,
                search: searchQuery?.trim() || undefined,
                ...extracted,
                limit: PER_PAGE,
                offset: page * PER_PAGE,
              }),
            })) as { runs: Run[] } | undefined;
            if (!result?.runs?.length) break;
            runs.push(...result.runs);
            // runs.list has no `hasMore` field (it returns nextCursor/nextOffset),
            // so a short page is the only reliable "bucket exhausted" signal —
            // relying on the phantom `hasMore` stopped this loop after page 1,
            // capping select/deselect-all-on-page at 200 runs per bucket.
            if (result.runs.length < PER_PAGE) break;
          } catch (e) {
            console.error("[grouped on-page] fetch failed", e);
            break;
          }
        }
        return runs;
      };
      for (let i = 0; i < buckets.length; i += CONCURRENCY) {
        const batch = await Promise.all(
          buckets.slice(i, i + CONCURRENCY).map(fetchBucketRuns),
        );
        for (const runs of batch) {
          for (const r of runs) {
            if (!seen.has(r.id)) {
              seen.add(r.id);
              collected.push(r);
            }
          }
        }
      }
      return collected;
    },
    [queryClient, organizationId, projectName, searchQuery, filters],
  );
  // Use onSelectionChange's 3rd-arg fallback path so we can select
  // runs that aren't in the current useListRuns page slice — the same
  // pattern selectAllInBucket uses (grouped-bucket-tree.tsx:241).
  // onSelectAllByIds/onDeselectByIds filter against the `runs` prop,
  // which is empty when useListRuns is disabled in grouped mode.
  const handleSelectAllGroupsOnPage = useCallback(async () => {
    const fetched = await fetchAllRunsInBuckets(visibleRootBuckets);
    for (const r of fetched) onSelectionChange(r.id, true, r);
  }, [fetchAllRunsInBuckets, visibleRootBuckets, onSelectionChange]);
  const handleDeselectAllGroupsOnPage = useCallback(async () => {
    const fetched = await fetchAllRunsInBuckets(visibleRootBuckets);
    for (const r of fetched) onSelectionChange(r.id, false, r);
  }, [fetchAllRunsInBuckets, visibleRootBuckets, onSelectionChange]);
  // Keep the ref pointed at the latest grouped on-page handlers so the header
  // select-all checkbox (built above in columns()) always calls the current
  // closures. (groupedRunsOnPage is now computed above, before columns().)
  useEffect(() => {
    groupedOnPageRef.current = {
      selectAll: handleSelectAllGroupsOnPage,
      deselectAll: handleDeselectAllGroupsOnPage,
    };
  }, [handleSelectAllGroupsOnPage, handleDeselectAllGroupsOnPage]);
  // Sum of immediate-next-level distinct-value counts across the
  // current page. Only meaningful when groupBy.length === 2, where
  // the immediate next IS the leaf level — at depth 3+ this would
  // be the intermediate subgroup count and wouldn't add up to leaf
  // totals. The toolbar checks groupBy.length itself before showing
  // the "(X leaf groups)" line.
  const groupedSubgroupsOnPage = useMemo(
    () => visibleRootBuckets.reduce((sum, b) => sum + (b.subgroupCount ?? 0), 0),
    [visibleRootBuckets],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    // In grouped mode the flat-table pagination is inert — the bucket tree
    // paginates via groupedPageIndex — so advance the grouped page (bounded to
    // the last page) instead of firing irrelevant flat fetches / nextPage().
    if (groupBy.length > 0) {
      const maxGroupPage = Math.max(
        0,
        Math.ceil(groupedTotalCount / pageSize) - 1,
      );
      setGroupedPageIndex((p) => Math.min(p + 1, maxGroupPage));
      return;
    }
    const nextPageEnd = (pageIndex + 2) * pageSize;
    // Use serverFetchedCount (not displayedRuns.length) so URL-
    // prefetched / cached runs don't falsely satisfy the threshold
    // and skip a needed server fetch. Same logic as TablePagination's
    // onNext.
    const nextPageHasEnoughData = serverFetchedCount >= nextPageEnd;
    if (!nextPageHasEnoughData && hasNextPage) {
      handleFetchNextPage();
    } else if (table.getCanNextPage()) {
      table.nextPage();
    }
  };

  const renderColGroup = useCallback(() =>
    table.getHeaderGroups()[0]?.headers.map((header, i) => {
      const def = header.column.columnDef;
      const isFixed = def.enableResizing === false;
      const baseW = isFixed ? (def.size ?? 150) : getWidth(header.column.id, def.size ?? 150);
      // Widen the FIRST column by the grouped indent so headers, run
      // rows, and bucket headers all share the same column boundaries.
      // Subsequent columns naturally shift right via the `<table>`'s
      // table-fixed layout.
      const w = i === 0 ? baseW + groupedIndentPx : baseW;
      return (
        <col
          key={header.id}
          data-col-id={header.column.id}
          style={{ width: w, minWidth: def.minSize ?? MIN_COL_WIDTH }}
        />
      );
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table, getWidth, resizeGeneration, groupedIndentPx],
  );

  const renderRow = useCallback(
    (row: Row<Run>, opts?: { isPinned?: boolean }) => (
      <RunRow
        key={row.id}
        row={row}
        pinnedColumnMap={pinnedColumnMap}
        tableBodyRef={tableBodyRef}
        isHidden={hiddenRunIds.has(row.original.id)}
        experimentRunIds={getExperimentRunIds(row.original.name)}
        isPinned={opts?.isPinned}
      />
    ),
    [pinnedColumnMap, hiddenRunIds, getExperimentRunIds],
  );

  // Inject a "Selected runs below do not match the active filter"
  // divider between filter-matching selected rows (top) and non-
  // matching selected rows (bottom). Partitioning happens in
  // `renderRowsWithFilterDivider` below — each partition keeps the
  // user's current sort order.
  const filterDividerRow = useMemo(
    () => (
      <TableRow
        key="filter-divider"
        className="hover:bg-transparent"
        data-testid="filter-divider"
      >
        <TableCell
          colSpan={memoizedColumns.length}
          // Row-spanning bg/border on the outer cell so the divider
          // band reads all the way across the scrolled row; sticky
          // inner div pins the label to `--tbl-visible-w` (published
          // by mainScrollRef's ResizeObserver) so the text stays
          // centered in the visible viewport under horizontal scroll
          // — matching the pin divider fix. Previously the naked
          // colSpan + text-center centered over the total scrolled
          // table width, which lands off-screen when the table is
          // wider than the viewport.
          className="bg-primary/15 border-y-2 border-primary/60 py-1 px-0"
        >
          <div
            className="sticky left-0 text-center text-[11px] font-semibold uppercase tracking-wider text-primary"
            style={{ width: "var(--tbl-visible-w, 100%)" }}
          >
            Selected runs below do not match the active filter
          </div>
        </TableCell>
      </TableRow>
    ),
    [memoizedColumns.length],
  );

  const renderRowsWithFilterDivider = useCallback(
    (rows: Row<Run>[], opts?: { isPinned?: boolean }): React.ReactNode[] => {
      if (!filterActive || !serverFilteredRunIds || serverFilteredRunIds.size === 0) {
        return rows.map((r) => renderRow(r, opts));
      }
      if (rows.length === 0) return [];
      // Partition-based rendering (instead of a linear boundary scan):
      // matching-filter rows first (in the user's current sort order),
      // then the divider, then non-matching selected rows (also in
      // sort order). This is what fixes the "sort by batch_size makes
      // the boundary land arbitrarily inside the matched set" bug —
      // the boundary scan assumed the row order already had matching
      // ↑ non-matching, but TanStack's client-side sort had reshuffled
      // them by whatever column the user was sorting on. Each
      // partition still respects the sort because we preserve the
      // input row order within each half.
      const matched: React.ReactNode[] = [];
      const unmatched: React.ReactNode[] = [];
      for (const row of rows) {
        (serverFilteredRunIds.has(row.original.id) ? matched : unmatched).push(renderRow(row, opts));
      }
      // Continuation pages (all-unmatched): skip the divider — the
      // user already crossed it on a prior page. Under DOS/PSTT
      // displayedRuns is partitioned matching-first (see the
      // matched/unmatched split in use-data-table-state's
      // displayedRuns memo), so any "all unmatched" page IS past the
      // boundary; showing the divider again would be noise.
      if (matched.length === 0) return unmatched;
      if (unmatched.length === 0) return matched;
      return [...matched, filterDividerRow, ...unmatched];
    },
    [filterActive, serverFilteredRunIds, filterDividerRow, renderRow],
  );

  const renderHeaderCell = (header: Header<Run, unknown>) => {
    const def = header.column.columnDef;
    const isFixed = def.enableResizing === false;
    const canResize = !isFixed;
    const w = isFixed ? (def.size ?? 150) : getWidth(header.column.id, def.size ?? 150);

    const bgColor = (header.column.columnDef.meta as any)?.backgroundColor;
    const isCustom = header.column.id.startsWith("custom-");
    const isDragOver = isCustom && dragOverId === header.column.id && draggedId !== header.column.id;
    const pinned = pinnedColumnMap[header.column.id];

    // Pinned (sticky, z-20) header cells float above columns that scroll beneath
    // them. Their resize handle sits at the column's right edge — exactly the
    // boundary the neighbouring non-pinned column scrolls under — so the handle
    // can intercept pointer events meant for that neighbour (Playwright hovers
    // land on it). For pinned columns we therefore make the handle visual-only
    // (pointer-events-none) and initiate the resize from a mousedown on the
    // cell's own right-edge zone instead, which keeps resizing working without
    // overlaying neighbouring cells. Non-pinned handles are same-layer as their
    // neighbours and keep their original interactive behaviour.
    const resizeFromEdge = (e: React.MouseEvent<HTMLTableCellElement>) => {
      if (!canResize) return;
      const rect = e.currentTarget.getBoundingClientRect();
      if (rect.right - e.clientX <= RESIZE_EDGE_ZONE_PX) {
        handleMouseDown(header.column.id, w, e);
      }
    };

    // Since the visual resize handle is pointer-events-none for pinned
    // cells (see below), it can't run its own `:hover` CSS. We simulate
    // the same "col-resize cursor + primary/50 highlight on the handle"
    // by tracking mouse position at the cell level and toggling the
    // handle's background directly. Refs-based direct-DOM writes so we
    // don't force re-renders on every mousemove.
    const trackEdgeHover = (e: React.MouseEvent<HTMLTableCellElement>) => {
      if (!canResize || !pinned) return;
      const cell = e.currentTarget;
      const rect = cell.getBoundingClientRect();
      const near = rect.right - e.clientX <= RESIZE_EDGE_ZONE_PX;
      cell.style.cursor = near ? "col-resize" : "";
      const handle = cell.querySelector<HTMLElement>("[data-resize-handle]");
      if (handle) handle.style.backgroundColor = near ? "hsl(var(--primary) / 0.5)" : "";
    };
    const clearEdgeHover = (e: React.MouseEvent<HTMLTableCellElement>) => {
      if (!canResize || !pinned) return;
      const cell = e.currentTarget;
      cell.style.cursor = "";
      const handle = cell.querySelector<HTMLElement>("[data-resize-handle]");
      if (handle) handle.style.backgroundColor = "";
    };

    return (
      <TableHead
        key={header.id}
        className={cn(
          "group overflow-hidden px-2 py-2 text-left text-sm font-medium whitespace-nowrap text-muted-foreground",
          pinned ? "sticky" : "relative",
          isCustom && "cursor-grab",
          isDragOver && "border-l-2 border-primary",
        )}
        style={{
          ...(bgColor
            ? pinned
              ? { background: `linear-gradient(${bgColor}20, ${bgColor}20), hsl(var(--background))` }
              : { backgroundColor: `${bgColor}20` }
            : { backgroundColor: 'hsl(var(--background))' }),
          ...(pinned && {
            left: pinned.left,
            zIndex: 20,
            ...(pinned.isLast && { borderRight: '2px solid hsl(var(--border))' }),
          }),
        }}
        draggable={isCustom}
        onDragStart={isCustom ? (e) => handleDragStart(header.column.id, e) : undefined}
        onDragOver={isCustom ? (e) => handleDragOver(header.column.id, e) : undefined}
        onDrop={isCustom ? (e) => handleDrop(header.column.id, e) : undefined}
        onDragEnd={isCustom ? handleDragEnd : undefined}
        onMouseDown={canResize && pinned ? resizeFromEdge : undefined}
        onMouseMove={canResize && pinned ? trackEdgeHover : undefined}
        onMouseLeave={canResize && pinned ? clearEdgeHover : undefined}
      >
        <div className="flex items-center">
          {isCustom && (
            <GripVertical className="h-3.5 w-0 shrink-0 group-hover:w-3.5 group-hover:mr-1 overflow-hidden text-muted-foreground/40 transition-all duration-150" />
          )}
          {pinned && !(BASE_PINNED_IDS as readonly string[]).includes(header.column.id) && (
            <Pin className="mr-1 h-3 w-3 shrink-0 rotate-45 text-muted-foreground/40" />
          )}
          {header.isPlaceholder
            ? null
            : flexRender(
                header.column.columnDef.header,
                header.getContext(),
              )}
        </div>
        {canResize && (
          <div
            data-resize-handle
            onMouseDown={pinned ? undefined : (e) => handleMouseDown(header.column.id, w, e)}
            className={cn(
              "absolute top-0 right-0 h-full w-1 cursor-col-resize select-none touch-none bg-transparent transition-colors hover:bg-primary/50",
              // For pinned cells the handle is purely a visual affordance; the
              // mousedown is handled by the cell so the overlay never intercepts
              // pointer events meant for the column scrolling beneath it.
              pinned && "pointer-events-none",
            )}
          />
        )}
      </TableHead>
    );
  };

  if (isLoading && runs.length === 0) {
    return <LoadingSkeleton />;
  }

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-[200px] flex-col overflow-hidden">
      <TableToolbar
        organizationId={organizationId}
        projectName={projectName}
        onRunsDeleted={onCheckedDeleted ?? onDeselectAll}
        selectedRunsWithColors={selectedRunsWithColors}
        checkedRunsWithColors={checkedRunsWithColors}
        runCount={listMode === "experiments" ? displayedRunCount : runCount}
        totalRunCount={listMode === "experiments" ? totalExperimentCount : totalRunCount}
        selectedFilterMatchCount={selectedFilterMatchCount}
        totalGroupCountUnfiltered={totalGroupCountUnfiltered}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        onSearchFocus={onSearchFocus}
        onKeyDown={handleKeyDown}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        panelLayout={panelLayout}
        onToggleListPanel={onToggleListPanel}
        onToggleGraphsPanel={onToggleGraphsPanel}
        onSelectFirstN={onSelectFirstN}
        onSelectAllByIds={onSelectAllByIds}
        onDeselectByIds={onDeselectByIds}
        onDeselectAll={onDeselectAll}
        onShuffleColors={onShuffleColors}
        onReassignAllColors={onReassignAllColors}
        hiddenCount={hiddenRunIds.size}
        onShowAllRuns={onShowAllRuns}
        onHideAllRuns={onHideAllRuns}
        showOnlySelected={showOnlySelected}
        onShowOnlySelectedChange={onShowOnlySelectedChange}
        pinSelectedToTop={pinSelectedToTop}
        onPinSelectedToTopChange={onPinSelectedToTopChange}
        pageRunIds={pageRunIds}
        deselectablePageRunIds={deselectablePageRunIds}
        groupedBucketsOnPage={visibleRootBuckets.length}
        groupedRunsOnPage={groupedRunsOnPage}
        groupedSubgroupsOnPage={groupedSubgroupsOnPage}
        onSelectAllGroupsOnPage={handleSelectAllGroupsOnPage}
        onDeselectAllGroupsOnPage={handleDeselectAllGroupsOnPage}
        filters={filters}
        filterableFields={filterableFields}
        onAddFilter={onAddFilter}
        onRemoveFilter={onRemoveFilter}
        onClearFilters={onClearFilters}
        onFieldSearch={onFieldSearch}
        isSearchingFields={isSearchingFields}
        customColumns={customColumns}
        availableConfigKeys={availableConfigKeys}
        availableSystemMetadataKeys={availableSystemMetadataKeys}
        availableMetricNames={availableMetricNames}
        onColumnToggle={onColumnToggle}
        onClearColumns={onClearColumns}
        columnKeysLoading={columnKeysLoading}
        onColumnSearch={onColumnSearch}
        isSearchingColumns={isSearchingColumns}
        viewSelector={viewSelector}
        listMode={listMode}
        onListModeChange={onListModeChange}
        showInherited={showInherited}
        onInheritedToggle={onInheritedToggle}
        groupBy={groupBy}
        onGroupByChange={onGroupByChange}
        // Outer-group counts for the toolbar's "X of Y groups
        // selected" line. selectedGroupCount comes from
        // selectedAncestorPaths[0] (built upstream from the selected
        // runs' group field values); totalGroupCount comes from the
        // bucket tree's root-level distinctGroupValues totalCount,
        // which we already cache in `groupedTotalCount` for the
        // pagination footer.
        selectedGroupCount={selectedAncestorPaths[0]?.size ?? 0}
        // Leaf-level selected count — only meaningful when groupBy
        // has 2+ levels (at depth 1 the outermost IS the leaf).
        selectedLeafGroupCount={groupBy.length >= 2 ? (selectedAncestorPaths[groupBy.length - 1]?.size ?? 0) : 0}
        totalGroupCount={groupedRealTotalCount}
        searchOtherMatchesDropdown={searchOtherMatchesDropdown}
      />

      <div className="min-h-0 flex-1 flex flex-col overflow-hidden rounded-md border">
        {groupBy.length > 0 && organizationId ? (
          /* Grouped view — bucket tree replaces the flat list. Pinning,
             selection, drag-zoom, and inline sort do NOT apply here; the
             user is browsing buckets, not the unfiltered run set. */
          <div ref={setScrollEl} className="isolate min-h-0 flex-1 overflow-y-auto overflow-x-scroll" data-table-container>
            <Table
              wrapperClassName="!overflow-x-visible"
              style={{ tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0, minWidth: "100%", width: tableWidth }}
            >
              <colgroup>{renderColGroup()}</colgroup>
              <TableHeader ref={theadRef} className="sticky top-0 z-[60] bg-background">
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>{hg.headers.map((h) => renderHeaderCell(h))}</TableRow>
                ))}
              </TableHeader>
              <TableBody ref={tableBodyRef}>
                <GroupedBucketTree
                  organizationId={organizationId}
                  organizationSlug={orgSlug}
                  projectName={projectName}
                  groupBy={groupBy}
                  expanded={expandedGroups}
                  onExpandedChange={onExpandedGroupsChange}
                  colSpan={memoizedColumns.length}
                  columns={memoizedColumns}
                  columnOrder={columnOrder}
                  pinnedColumnMap={pinnedColumnMap}
                  selectedRunsWithColors={selectedRunsWithColors}
                  hiddenRunIds={hiddenRunIds}
                  tableBodyRef={tableBodyRef}
                  onColorChange={onColorChange}
                  onSelectionChange={onSelectionChange}
                  onSetRunsHidden={onSetRunsHidden}
                  runFirstCellPaddingLeft={groupedIndentPx}
                  rootPageSize={pageSize}
                  rootPageIndex={groupedPageIndex}
                  onRootHasMoreChange={setGroupedHasMore}
                  onRootTotalCountChange={setGroupedTotalCount}
                  onRootRealTotalCountChange={setGroupedRealTotalCount}
                  onVisibleRootBucketsChange={setVisibleRootBuckets}
                  showOnlySelected={showOnlySelected}
                  pinSelectedToTop={pinSelectedToTop}
                  // When DOS + search is active, hand the bucket tree
                  // the search-filtered ancestor paths so groups with
                  // no matching selected runs disappear from the
                  // view. Otherwise pass the unfiltered set.
                  selectedAncestorPaths={dosSearchFilteredAncestorPaths ?? selectedAncestorPaths}
                  // Forward the column sort so bucket levels (and any
                  // subgroups inside them) order by an aggregate of the
                  // sort column across their descendant runs. Same
                  // parity as W&B's grouped sort — backend picks the
                  // aggregator from source/dataType.
                  sortField={sortParam?.field}
                  sortSource={sortParam?.source}
                  sortDirection={sortParam?.direction}
                  sortAggregation={sortParam?.aggregation}
                  aggregateColumns={bucketAggregateColumns}
                  aggregateColIdIndex={bucketAggregateColIdIndex}
                  metricColumnSpecs={bucketMetricColumnSpecs}
                  // Memoized above (groupBaseFilters) so its identity is
                  // stable across renders — see the comment there. Threads the
                  // toolbar status/tags/date/field/metric/system filters into
                  // the bucket tree the same way flat mode wires them into
                  // runs.list in index.tsx.
                  baseFilters={groupBaseFilters}
                />
              </TableBody>
            </Table>
          </div>
        ) : isPinningActive ? (
          // One scroll container, one <Table>, one <TableBody>. The
          // pinned rows render first, then the unpinned page slice.
          // Pagination math (in TablePagination) only advances the
          // unpinned slice; the pinned block is always rendered at the
          // top so the user sees `pinned + (pageSize - pinned)` rows
          // every page.
          <div ref={setScrollEl} className="isolate min-h-0 flex-1 overflow-y-auto overflow-x-scroll" data-table-container>
            <Table
              wrapperClassName="!overflow-x-visible"
              style={{ tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0, minWidth: "100%", width: tableWidth }}
            >
              <colgroup>{renderColGroup()}</colgroup>
              <TableHeader ref={theadRef} className="sticky top-0 z-[60] bg-background">
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>{hg.headers.map((h) => renderHeaderCell(h))}</TableRow>
                ))}
              </TableHeader>
              <TableBody ref={tableBodyRef}>
                {/* Pinned block (PSTT-on): all selected runs. Under
                    an active filter, partition into
                      matching → FILTER DIVIDER → non-matching
                    so the pin section itself reads as two subsections
                    before the "Unselected runs below" pin divider
                    hands off to the unpinned matching set. */}
                {renderRowsWithFilterDivider(pinnedTable.getRowModel().rows, { isPinned: true })}
                {/* Divider between pinned (selected) and unpinned rows.
                    Only render when:
                     - there are pinned rows above,
                     - effectivePageSize > 0 (otherwise the pinned block
                       has already consumed the user's pageSize budget,
                       see the analogous skip on the unpinned `.map` just
                       below), AND
                     - there's actually a non-empty unpinned slice. */}
                {pinnedTable.getRowModel().rows.length > 0 &&
                  effectivePageSize > 0 &&
                  table.getRowModel().rows.length > 0 && (
                    <TableRow
                      key="pin-divider"
                      className="hover:bg-transparent"
                      data-testid="pin-divider"
                    >
                      <TableCell
                        colSpan={memoizedColumns.length}
                        // Outer cell holds the row-spanning bg/border
                        // so the divider band reads across the whole
                        // scrolled row. Sticky inner div pins the LABEL
                        // to `--tbl-visible-w` (published above by the
                        // scroll-container ResizeObserver) so the text
                        // stays centered in the visible viewport under
                        // horizontal scroll instead of drifting off
                        // toward the middle of the total table width.
                        className="bg-primary/15 border-y-2 border-primary/60 py-1 px-0"
                      >
                        <div
                          className="sticky left-0 text-center text-[11px] font-semibold uppercase tracking-wider text-primary"
                          style={{ width: "var(--tbl-visible-w, 100%)" }}
                        >
                          {filterActive
                            ? "Unselected runs below that match the active filter"
                            : "Unselected runs below"}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                {/* Suppress the unpinned slice entirely when the pinned
                    block has already filled the user's pageSize budget.
                    Without this, TanStack still slices ONE row out
                    (tablePageSize is floored at 1 in the hook to avoid
                    a div-by-zero), leaving a stray "+1" leftover row
                    visible below the pinned section. Triggered when
                    pinnedCount ≥ pageSize — e.g. selecting from the
                    "Other matches" dropdown pushes the selection past
                    the cap. */}
                {effectivePageSize > 0 && renderRowsWithFilterDivider(table.getRowModel().rows)}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div ref={setScrollEl} className="isolate min-h-0 flex-1 overflow-y-auto overflow-x-scroll" data-table-container>
            <Table wrapperClassName="!overflow-x-visible" style={{ tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0, minWidth: "100%", width: tableWidth }}>
              <colgroup>{renderColGroup()}</colgroup>
              <TableHeader ref={theadRef} className="sticky top-0 z-[60] bg-background">
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>{hg.headers.map((h) => renderHeaderCell(h))}</TableRow>
                ))}
              </TableHeader>
              <TableBody ref={tableBodyRef}>
                {table.getRowModel().rows.length ? (
                  renderRowsWithFilterDivider(table.getRowModel().rows)
                ) : (
                  <TableRow>
                    <TableCell colSpan={memoizedColumns.length} className="h-16 text-center text-sm text-muted-foreground">
                      No runs found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Pagination footer. Same component in both modes; the
          `mode="groups"` path swaps the dropdown labels and the
          prev/next wiring so the footer drives the bucket tree's
          root-level offset instead of the (hidden) flat-runs page.
          Wandb-equivalent UX: page-size dropdown still works, prev/
          next cycles through top-level group pages. */}
      <TablePagination
        table={table}
        runCount={runCount}
        pinnedRunCount={pinnedRuns.length}
        isPinningActive={isPinningActive}
        pageIndex={pageIndex}
        pageSize={pageSize}
        effectivePageSize={effectivePageSize}
        displayOnlySelected={showOnlySelected}
        runsLength={displayedRuns.length}
        serverFetchedCount={serverFetchedCount}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        onFetchNextPage={handleFetchNextPage}
        pageBase={pageBase}
        onJumpToPage={onJumpToPage}
        mode={groupBy.length > 0 ? "groups" : "runs"}
        groupPageIndex={groupedPageIndex}
        groupHasMore={groupedHasMore}
        groupTotalCount={groupedTotalCount}
        onGroupPageIndexChange={setGroupedPageIndex}
      />
    </div>
  );
}

const LoadingSkeleton = () => (
  <div className="flex h-full w-full min-w-[200px] flex-col">
    <div className="mb-2 space-y-2">
      <div className="mt-2 flex items-center gap-1 pl-1">
        <Skeleton className="h-5 w-24" />
      </div>
      <div className="relative">
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
    <div className="flex-1 overflow-hidden rounded-md border">
      <div className="h-full overflow-y-auto">
        <Skeleton className="h-full w-full" />
      </div>
    </div>
  </div>
);
