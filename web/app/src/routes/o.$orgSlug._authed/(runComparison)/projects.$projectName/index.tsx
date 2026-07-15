import { queryClient, trpc } from "@/utils/trpc";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import RunComparisonLayout from "@/components/layout/runComparison/layout";
import PageLayout from "@/components/layout/page-layout";
import { OrganizationPageTitle } from "@/components/layout/page-title";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useBestStepTolerance } from "@/hooks/use-best-step-tolerance";
import type { ExpandedState, SortingState } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { useSelectedRuns } from "./~hooks/use-selected-runs";
import { useRunListAssembly, useTableViewPartition } from "./~hooks/use-run-list-model";
import { prefetchListRuns, useListRuns, type Run } from "./~queries/list-runs";
import { useSelectedRunLogs } from "./~queries/selected-run-logs";
import { useUpdateTags } from "./~queries/update-tags";
import { useUpdateNotes } from "./~queries/update-notes";
import { useDistinctColumnKeys, useSearchColumnKeys } from "./~queries/distinct-column-keys";
import { useColumnConfig, useBaseColumnOverrides, DEFAULT_COLUMNS, type ColumnConfig, type MetricAggregation } from "./~hooks/use-column-config";
import { useLocalStorageBool } from "./~hooks/use-local-storage-bool";
import { useSearchOtherMatches } from "./~hooks/use-search-other-matches";
import { SearchOtherMatchesDropdown } from "./~components/runs-table/components/search-other-matches-dropdown";
import { useDistinctMetricNames, useSearchMetricNames, useMetricSummaries } from "./~queries/metric-summaries";
import { groupMetrics } from "./~lib/metrics-utils";
import { MetricsDisplay } from "./~components/metrics-display";
import { SideBySideView } from "./~components/side-by-side/side-by-side-view";
import { DataTable } from "./~components/runs-table/data-table";
import { useRefresh } from "./~hooks/use-refresh";
import { useRunCount } from "./~queries/run-count";
import { useRunFilters } from "./~hooks/use-run-filters";
import { SYSTEM_FILTERABLE_FIELDS, type FilterableField, type FieldFilterParam, type MetricFilterParam, type SystemFilterParam, type SortParam } from "@/lib/run-filters";
import { generateUuid } from "@/lib/uuid";
import { buildRefreshQueryFilters } from "./~lib/build-refresh-queries";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { useDebouncedCallback } from "@/lib/hooks/use-debounced-callback";
import { RunTableViewSelector } from "./~components/runs-table/run-table-view-selector";
import { DEFAULT_PAGE_SIZE, SELECTED_RUNS_LIMIT } from "./~components/runs-table/config";
import { ImageStepSyncProvider } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~context/image-step-sync-context";
import { RunSyncProvider } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~context/run-sync-context";

// Search params type for the route
// Note: runs is stored as comma-separated string in URL for cleaner URLs
interface RunComparisonSearchParams {
  chart?: string;
  runs?: string;  // Comma-separated run IDs (e.g., "id1,id2,id3")
  hidden?: string; // Comma-separated IDs of hidden-but-selected runs
  listMode?: "experiments" | "runs";
  inherited?: "true" | "false"; // Show inherited metrics from fork parents
}

export const Route = createFileRoute(
  "/o/$orgSlug/_authed/(runComparison)/projects/$projectName/",
)({
  component: RouteComponent,
  validateSearch: (search): RunComparisonSearchParams => {
    const result: RunComparisonSearchParams = {};

    // Support ?chart=<viewId> to deep-link to a specific custom chart
    if (typeof search.chart === "string" && search.chart.trim()) {
      result.chart = search.chart.trim();
    }

    // Support ?runs=id1,id2,id3 to pre-select specific runs (stored as comma-separated string)
    if (typeof search.runs === "string" && search.runs.trim()) {
      result.runs = search.runs.trim();
    }

    // Support ?hidden=id1,id2 to hide specific selected runs from charts
    if (typeof search.hidden === "string" && search.hidden.trim()) {
      result.hidden = search.hidden.trim();
    }

    // Support ?listMode=experiments|runs to toggle between grouped and flat views
    if (search.listMode === "experiments" || search.listMode === "runs") {
      result.listMode = search.listMode;
    }

    // Support ?inherited=true|false to show/hide inherited fork metrics
    if (search.inherited === "true" || search.inherited === "false") {
      result.inherited = search.inherited;
    }

    return result;
  },
  beforeLoad: async ({ context, params }) => {
    const auth = context.auth;
    const organizationId = auth.activeOrganization.id;

    // Prefetch run-table-views so the component's useState for pageSize can
    // read the saved view's value synchronously on first render. Without
    // this, first render uses a fallback pageSize, useEffect then applies
    // the view's pageSize, and two runs.list queries fire with different
    // limits (the "first-load zombie" bug).
    await context.queryClient.ensureQueryData(
      trpc.runTableViews.list.queryOptions({
        organizationId,
        projectName: params.projectName,
      }),
    );

    return {
      organizationId,
      projectName: params.projectName,
      organizationSlug: params.orgSlug,
    };
  },
});

/**
 * Main component for the run comparison page
 * Integrates data loading, selection state, and the display of runs and metrics
 */
type ViewMode = "charts" | "side-by-side";

function RouteComponent() {
  const { organizationId, projectName, organizationSlug } =
    Route.useRouteContext();
  const { chart, runs: urlRunsParam, hidden: urlHiddenParam, listMode: urlListMode, inherited: urlInherited } = Route.useSearch();
  const navigate = useNavigate();
  useDocumentTitle(projectName);

  // Parse hidden run IDs from URL
  const urlHiddenIds = useMemo(() => {
    if (!urlHiddenParam) return undefined;
    const ids = urlHiddenParam.split(",").map((id) => id.trim()).filter(Boolean);
    return ids.length > 0 ? ids : undefined;
  }, [urlHiddenParam]);

  // Persist last selected dashboard view to localStorage per org/project
  const dashboardStorageKey = `run-table-dashboard:${organizationSlug}:${projectName}`;

  // On initial load, restore last dashboard if no ?chart= param in URL
  useEffect(() => {
    if (chart) return; // URL already specifies a dashboard
    try {
      const saved = localStorage.getItem(dashboardStorageKey);
      if (saved) {
        void navigate({
          to: ".",
          search: (prev) => ({ ...prev, chart: saved }),
          replace: true,
        });
      }
    } catch {
      // localStorage unavailable
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handler for changing the selected dashboard view (syncs with URL + localStorage)
  const handleViewChange = useCallback(
    (viewId: string | null) => {
      try {
        if (viewId) {
          localStorage.setItem(dashboardStorageKey, viewId);
        } else {
          localStorage.removeItem(dashboardStorageKey);
        }
      } catch {
        // localStorage unavailable
      }
      void navigate({
        to: ".",
        search: (prev) => ({
          ...prev,
          chart: viewId || undefined,
        }),
        replace: true,
      });
    },
    [navigate, dashboardStorageKey],
  );

  // Handler for syncing run selection to URL (debounced to avoid excessive updates)
  const handleSelectionChange = useCallback(
    (selectedRunIds: string[]) => {
      void navigate({
        to: ".",
        search: (prev) => ({
          ...prev,
          runs: selectedRunIds.length > 0 ? selectedRunIds.join(",") : undefined,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  // Handler for syncing hidden run IDs to URL
  const handleHiddenChange = useCallback(
    (hiddenIds: string[]) => {
      void navigate({
        to: ".",
        search: (prev) => ({
          ...prev,
          hidden: hiddenIds.length > 0 ? hiddenIds.join(",") : undefined,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  // Debounced version of selection change to avoid rapid URL updates
  const debouncedSelectionChange = useDebouncedCallback(handleSelectionChange, 300);
  const debouncedHiddenChange = useDebouncedCallback(handleHiddenChange, 300);

  // View mode state - "charts" (default) or "side-by-side"
  const [viewMode, setViewMode] = useState<ViewMode>("charts");

  // List mode state - "experiments" (grouped by lineage root) or "runs" (all individual runs)
  // Persisted via URL param ?listMode=experiments|runs
  type ListMode = "experiments" | "runs";
  const listMode: ListMode = urlListMode ?? "runs";
  const handleListModeChange = useCallback((mode: ListMode) => {
    navigate({
      to: ".",
      search: (prev) => ({
        ...prev,
        listMode: mode === "runs" ? undefined : mode,
      }),
      replace: true,
    });
  }, [navigate]);

  // Inherited metrics — synced via URL param. Default is ON (Neptune behavior).
  // ?inherited=false explicitly disables; absent = enabled.
  const handleInheritedToggle = useCallback(() => {
    const current = urlInherited !== "false"; // default true
    navigate({
      to: ".",
      search: (prev) => ({
        ...prev,
        inherited: current ? "false" : undefined, // remove param when true (default)
      }),
      replace: true,
    });
  }, [urlInherited, navigate]);

  const handleInheritedChange = useCallback((value: boolean) => {
    navigate({
      to: ".",
      search: (prev) => ({
        ...prev,
        inherited: value ? undefined : "false", // remove param when true (default)
      }),
      replace: true,
    });
  }, [navigate]);

  // Panel layout state - which panels are visible
  type PanelLayout = "both" | "list-only" | "graphs-only";
  const [panelLayout, setPanelLayout] = useState<PanelLayout>("both");
  const listPanelRef = useRef<PanelImperativeHandle | null>(null);
  const graphsPanelRef = useRef<PanelImperativeHandle | null>(null);

  const toggleListPanel = useCallback(() => {
    setPanelLayout((prev) => {
      if (prev === "graphs-only") {
        // List is hidden — expand it to show both
        listPanelRef.current?.expand();
        return "both";
      }
      if (prev === "list-only") {
        // List is the only visible panel — expand graphs to show both
        graphsPanelRef.current?.expand();
        return "both";
      }
      // Both visible — collapse list
      listPanelRef.current?.collapse();
      return "graphs-only";
    });
  }, []);

  const toggleGraphsPanel = useCallback(() => {
    setPanelLayout((prev) => {
      if (prev === "list-only") {
        // Graphs hidden — expand to show both
        graphsPanelRef.current?.expand();
        return "both";
      }
      if (prev === "graphs-only") {
        // Graphs is the only visible panel — expand list to show both
        listPanelRef.current?.expand();
        return "both";
      }
      // Both visible — collapse graphs
      graphsPanelRef.current?.collapse();
      return "list-only";
    });
  }, []);

  // Keyboard shortcuts for panel toggle
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      if (e.key === "[") {
        e.preventDefault();
        toggleListPanel();
      } else if (e.key === "]") {
        e.preventDefault();
        toggleGraphsPanel();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleListPanel, toggleGraphsPanel]);

  // Table hover → chart highlighting is handled entirely via DOM events
  // ("run-table-hover" dispatched by data-table.tsx, consumed by chart-sync-context.tsx)
  // to avoid re-rendering the component tree (which remounts table cells and closes popovers).

  // Server-side sorting state (persisted to localStorage)
  const sortingStorageKey = `run-table-sorting:${organizationSlug}:${projectName}`;
  const [sorting, setSorting] = useState<SortingState>(() => {
    try {
      const saved = localStorage.getItem(sortingStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });
  // Persist sorting to localStorage on change
  useEffect(() => {
    try {
      if (sorting.length > 0) {
        localStorage.setItem(sortingStorageKey, JSON.stringify(sorting));
      } else {
        localStorage.removeItem(sortingStorageKey);
      }
    } catch {}
  }, [sortingStorageKey, sorting]);

  // Active run table view state (persisted to localStorage)
  const activeViewStorageKey = `mlop:active-table-view:${organizationSlug}:${projectName}`;
  const [activeViewId, setActiveViewIdRaw] = useState<string | null>(() => {
    try {
      return localStorage.getItem(activeViewStorageKey) || null;
    } catch {
      return null;
    }
  });
  const setActiveViewId = useCallback(
    (viewId: string | null) => {
      setActiveViewIdRaw(viewId);
      try {
        if (viewId) {
          localStorage.setItem(activeViewStorageKey, viewId);
        } else {
          localStorage.removeItem(activeViewStorageKey);
        }
      } catch {
        // localStorage unavailable
      }
    },
    [activeViewStorageKey],
  );

  // Page size state — sourced from the saved view in DB (prefetched in
  // beforeLoad). Resolves on first render: active view → saved "Default"
  // view → hardcoded DEFAULT_PAGE_SIZE. No localStorage: persistence for
  // the Default view lives in its RunTableView row. Users wanting the
  // pageSize to stick across visits save a "Default" view.
  const getInitialPageSize = useCallback((): number => {
    try {
      const data = queryClient.getQueryData(
        trpc.runTableViews.list.queryOptions({
          organizationId,
          projectName,
        }).queryKey,
      ) as { views: Array<{ id: string; name: string; config: { pageSize?: number } }> } | undefined;
      const views = data?.views;
      if (views) {
        const savedActiveViewId = (() => {
          try { return localStorage.getItem(activeViewStorageKey); } catch { return null; }
        })();
        if (savedActiveViewId) {
          const active = views.find((v) => v.id === savedActiveViewId);
          if (active?.config.pageSize != null) return active.config.pageSize;
        }
        const defaultView = views.find((v) => v.name === "Default");
        if (defaultView?.config.pageSize != null) return defaultView.config.pageSize;
      }
    } catch {}
    return DEFAULT_PAGE_SIZE;
  }, [organizationId, projectName, activeViewStorageKey]);
  const [pageSize, setPageSize] = useState<number>(getInitialPageSize);
  // Page jump offset: 0-based display page index that table page 0 corresponds to.
  // When pageBase > 0, the infinite query fetches starting from (pageBase * pageSize).
  const [pageBase, setPageBase] = useState(0);
  // Called from the page size dropdown in the table.
  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
  }, []);

  // Known metric aggregation suffixes for parsing column table IDs
  const METRIC_AGGS = new Set(["MIN", "MAX", "AVG", "LAST", "VARIANCE"]);

  // Convert TanStack Table sorting state to backend sort param
  const sortParam = useMemo((): SortParam | undefined => {
    if (sorting.length === 0) return undefined;
    const { id, desc } = sorting[0];
    const direction = desc ? "desc" as const : "asc" as const;

    // Base "name" column
    if (id === "name") {
      return { field: "name", source: "system", direction };
    }

    // Base "status" column — sorted server-side (enum compared as text)
    if (id === "status") {
      return { field: "status", source: "system", direction };
    }

    // Custom columns: "custom-config-lr", "custom-system-createdAt", "custom-metric-train/loss-LAST"
    if (id.startsWith("custom-")) {
      const rest = id.slice(7); // remove "custom-"
      const dashIdx = rest.indexOf("-");
      if (dashIdx === -1) return undefined;
      const source = rest.substring(0, dashIdx);
      const field = rest.substring(dashIdx + 1);

      // Metric columns: "custom-metric-train/loss-LAST"
      // Parse aggregation from the last segment after the last dash
      if (source === "metric") {
        const lastDash = field.lastIndexOf("-");
        if (lastDash === -1) return undefined;
        const metricName = field.substring(0, lastDash);
        const agg = field.substring(lastDash + 1);
        if (METRIC_AGGS.has(agg)) {
          return { field: metricName, source: "metric", direction, aggregation: agg as MetricAggregation };
        }
        return undefined;
      }

      if (source === "system" || source === "config" || source === "systemMetadata") {
        return { field, source, direction };
      }
    }

    return undefined;
  }, [sorting]);

  // Unified filter state
  const {
    filters,
    addFilter,
    removeFilter,
    updateFilter,
    clearAll: clearFilters,
    setAll: setAllFilters,
    serverFilters,
  } = useRunFilters(organizationSlug, projectName);

  // Status column-header filter ↔ unified RunFilter state. The header edits the
  // same "status" filter the toolbar builder uses, so the two stay in sync.
  const statusFilter = useMemo(
    () => filters.find((f) => f.field === "status" && f.source === "system"),
    [filters],
  );
  const statusFilterValues = useMemo(
    () => (statusFilter?.values as string[] | undefined) ?? [],
    [statusFilter],
  );
  const handleStatusFilterChange = useCallback(
    (values: string[]) => {
      if (values.length === 0) {
        if (statusFilter) removeFilter(statusFilter.id);
        return;
      }
      if (statusFilter) {
        updateFilter(statusFilter.id, { values });
      } else {
        addFilter({
          id: generateUuid(),
          field: "status",
          source: "system",
          dataType: "option",
          operator: "is any of",
          values,
        });
      }
    },
    [statusFilter, addFilter, removeFilter, updateFilter],
  );

  const filterActive = useMemo(() => {
    return (
      (serverFilters.tags?.length ?? 0) > 0 ||
      (serverFilters.status?.length ?? 0) > 0 ||
      (serverFilters.dateFilters?.length ?? 0) > 0 ||
      (serverFilters.fieldFilters?.length ?? 0) > 0 ||
      (serverFilters.metricFilters?.length ?? 0) > 0 ||
      (serverFilters.systemFilters?.length ?? 0) > 0
    );
  }, [serverFilters]);

  // showOnlySelected state — persisted to localStorage per org/project (lifted from DataTable)
  const showOnlySelectedKey = `run-table-showOnlySelected:${organizationSlug}:${projectName}`;
  const [showOnlySelected, setShowOnlySelected] = useLocalStorageBool(showOnlySelectedKey);

  // pinSelectedToTop — owned here so a future grouping picker can re-add the
  // mutex (in v1 it was mutually exclusive with the now-removed group toggle).
  const pinSelectedToTopKey = `run-table-pinSelectedToTop:${organizationSlug}:${projectName}`;
  const [pinSelectedToTop, setPinSelectedToTop] = useLocalStorageBool(pinSelectedToTopKey);

  // W&B-style grouping: ordered list of encoded group fields. Empty =
  // no grouping (the flat table). Persisted per-project so the user's
  // grouping survives reload.
  const groupByStorageKey = `run-table-groupBy:v2:${organizationSlug}:${projectName}`;
  const [groupBy, setGroupByRaw] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(groupByStorageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
        return parsed;
      }
      return [];
    } catch {
      return [];
    }
  });
  // Expanded bucket trails — keyed by JSON-stringified `{field, value}[]`.
  // Lives in-memory only (so reload-without-loading-a-view collapses to
  // all); saved views persist + restore this via RunTableViewConfig.
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const handleGroupByChange = useCallback(
    (next: string[]) => {
      setGroupByRaw(next);
      // Switching grouping fields invalidates every prior expanded path
      // (the trails reference fields that may no longer apply).
      setExpandedGroups([]);
      try {
        if (next.length === 0) localStorage.removeItem(groupByStorageKey);
        else localStorage.setItem(groupByStorageKey, JSON.stringify(next));
      } catch {
        // localStorage may be unavailable (private mode etc.) — non-fatal.
      }
    },
    [groupByStorageKey],
  );

  // Search state — persisted to localStorage per org/project
  const searchStorageKey = `run-table-search:${organizationSlug}:${projectName}`;
  const [searchInput, setSearchInput] = useState<string>(() => {
    try {
      return localStorage.getItem(searchStorageKey) ?? "";
    } catch {
      return "";
    }
  });
  // Debounced search value for server queries
  const [debouncedSearch, setDebouncedSearch] = useState<string>(searchInput);

  // Debounce search updates to avoid excessive API calls
  const updateDebouncedSearch = useDebouncedCallback(
    (value: string) => setDebouncedSearch(value),
    300,
  );

  // Tracks whether the user has dismissed the "Other matches" dropdown
  // (via Esc or click-outside). Typing in the search input clears the
  // dismissal so the dropdown can reappear.
  const [otherMatchesDismissed, setOtherMatchesDismissed] = useState(false);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      updateDebouncedSearch(value);
      setOtherMatchesDismissed(false);
      try {
        if (value) {
          localStorage.setItem(searchStorageKey, value);
        } else {
          localStorage.removeItem(searchStorageKey);
        }
      } catch {
        // localStorage unavailable
      }
    },
    [updateDebouncedSearch, searchStorageKey],
  );

  // Auto-refresh predicate: every runs.* query, refetchType "active".
  // Same predicate for both charts and side-by-side modes — "active" skips
  // unmounted/orphaned queries automatically, so the per-mode narrowing
  // that used to live here is no longer needed.
  const { refresh, lastRefreshed } = useRefresh({
    queries: useMemo(() => buildRefreshQueryFilters(), []),
  });

  const { data: runCount, isLoading: runCountLoading } = useRunCount(
    organizationId,
    projectName,
    serverFilters.tags,
    serverFilters.status,
    debouncedSearch,
    serverFilters.dateFilters,
    serverFilters.fieldFilters as FieldFilterParam[] | undefined,
    serverFilters.metricFilters as MetricFilterParam[] | undefined,
    serverFilters.systemFilters as SystemFilterParam[] | undefined,
  );

  // Unfiltered total count for the project
  const { data: totalRunCount } = useRunCount(
    organizationId,
    projectName,
  );


  // Reset pageBase when sort/filter/search changes so the user starts at page 1
  useEffect(() => {
    setPageBase(0);
  }, [sortParam, serverFilters, debouncedSearch]);

  // Column configuration (custom columns in runs table).
  // Declared before useListRuns so we can derive `visibleColumns` from it
  // and pass that into the list query — the server trims the per-run
  // config/systemMetadata blobs to exactly what the table is showing.
  const { columns: customColumns, addColumn, removeColumn, updateColumns, reorderColumns, toggleColumnPin } = useColumnConfig(organizationSlug, projectName);

  // Map the customColumns array to the runs.list visibleColumns input shape.
  // Only config / systemMetadata columns flow into the flat blobs; system
  // columns come from system fields and metric columns come from
  // runs.metricSummaries. ColumnConfig.id carries the `source.` prefix
  // (e.g. "config.lr") — strip it here to match the backend key shape.
  const listVisibleColumns = useMemo(() => {
    const out: { source: "config" | "systemMetadata"; key: string }[] = [];
    for (const col of customColumns) {
      if (col.source === "config" || col.source === "systemMetadata") {
        const prefix = `${col.source}.`;
        const key = col.id.startsWith(prefix) ? col.id.slice(prefix.length) : col.id;
        out.push({ source: col.source, key });
      }
    }
    return out;
  }, [customColumns]);

  // Load runs using infinite query with standard TanStack/tRPC v11 approach
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isFetching,
    isError,
    error,
    // Disable the flat runs.list when grouping is active: the bucket tree
    // replaces the flat table (data-table.tsx:613), the pagination footer
    // switches to group-count mode (data-table.tsx:749), side-by-side uses
    // getByIds, and column/metric dropdowns use their own dedicated
    // endpoints. The only consumer we lose is `allTags` (initial seed for
    // the tag-editor popover), which falls back to a direct distinctTags
    // fetch below — equivalent quality, ~1KB instead of ~10-200KB.
  } = useListRuns(organizationId, projectName, serverFilters.tags, serverFilters.status, debouncedSearch, serverFilters.dateFilters, sortParam, serverFilters.fieldFilters as FieldFilterParam[] | undefined, serverFilters.metricFilters as MetricFilterParam[] | undefined, serverFilters.systemFilters as SystemFilterParam[] | undefined, pageSize, pageBase, listVisibleColumns, groupBy.length === 0);

  // Total rows the server has actually returned across all fetched
  // runs.list pages. Used for the *fetch trigger* (Next-button +
  // typed-page-input), NOT for the totalPages indicator. Decouples the
  // fetch decision from `displayedRuns.length`, which is inflated by
  // URL-prefetched / IndexedDB-cached selection runs and was tricking
  // Next into thinking "we have enough data" when in fact additional
  // runs.list pages still need fetching.
  const serverFetchedCount = useMemo(() => {
    if (!data?.pages) return 0;
    let count = 0;
    for (const page of data.pages) {
      if (page?.runs) count += page.runs.length;
    }
    return count;
  }, [data]);

  // Mutation for updating tags
  const updateTagsMutation = useUpdateTags(organizationId, projectName);

  // Mutation for updating notes
  const updateNotesMutation = useUpdateNotes(organizationId, projectName);

  const { data: columnKeysData, isLoading: columnKeysLoading } = useDistinctColumnKeys(organizationId, projectName);

  // Metric names for column picker and filter dropdown (initial load: last 100)
  const { data: metricNamesData } = useDistinctMetricNames(organizationId, projectName);

  // Search column keys — queries the project_column_keys cache table when user types in filter dropdown
  const [fieldSearch, setFieldSearch] = useState("");
  const [debouncedFieldSearch, setDebouncedFieldSearch] = useState("");
  const updateDebouncedFieldSearch = useDebouncedCallback(
    (value: string) => setDebouncedFieldSearch(value),
    300,
  );
  const handleFieldSearch = useCallback(
    (value: string) => {
      setFieldSearch(value);
      updateDebouncedFieldSearch(value);
    },
    [updateDebouncedFieldSearch],
  );
  const { data: searchKeysData, isFetching: isSearchingKeys } = useSearchColumnKeys(organizationId, projectName, debouncedFieldSearch);
  const { data: searchMetricNamesData, isFetching: isSearchingMetrics } = useSearchMetricNames(organizationId, projectName, debouncedFieldSearch);

  // Merge initial metric names with search results (deduplicated)
  const metricNames = useMemo(() => {
    const initial = metricNamesData?.metricNames ?? [];
    const searched = searchMetricNamesData?.metricNames ?? [];
    if (searched.length === 0) return initial;
    const set = new Set(initial);
    const merged = [...initial];
    for (const name of searched) {
      if (!set.has(name)) {
        merged.push(name);
      }
    }
    return merged;
  }, [metricNamesData, searchMetricNamesData]);

  const handleColumnToggle = useCallback(
    (col: ColumnConfig) => {
      const exists = customColumns.some(
        (c) => c.id === col.id && c.source === col.source && c.aggregation === col.aggregation
      );
      if (exists) {
        removeColumn(col);
      } else {
        addColumn(col);
      }
    },
    [customColumns, addColumn, removeColumn],
  );

  const handleClearColumns = useCallback(() => {
    updateColumns([]);
  }, [updateColumns]);

  // Base column overrides (Name column rename + background color)
  const { overrides: baseOverrides, updateOverride: updateBaseOverride, setAllOverrides } =
    useBaseColumnOverrides(organizationSlug, projectName);

  const nameOverrides = baseOverrides["name"];

  const handleNameRename = useCallback(
    (newName: string) => updateBaseOverride("name", { customLabel: newName }),
    [updateBaseOverride],
  );

  const handleNameSetColor = useCallback(
    (color: string | undefined) => updateBaseOverride("name", { backgroundColor: color }),
    [updateBaseOverride],
  );

  // Column header dropdown handlers for custom columns
  const handleColumnRename = useCallback(
    (colId: string, source: string, newName: string, aggregation?: string) => {
      updateColumns(
        customColumns.map((c) =>
          c.id === colId && c.source === source && c.aggregation === aggregation ? { ...c, customLabel: newName } : c,
        ),
      );
    },
    [customColumns, updateColumns],
  );

  const handleColumnSetColor = useCallback(
    (colId: string, source: string, color: string | undefined, aggregation?: string) => {
      updateColumns(
        customColumns.map((c) =>
          c.id === colId && c.source === source && c.aggregation === aggregation ? { ...c, backgroundColor: color } : c,
        ),
      );
    },
    [customColumns, updateColumns],
  );

  const handleColumnRemove = useCallback(
    (colId: string, source: string, aggregation?: string) => {
      removeColumn({ id: colId, source: source as any, label: "", aggregation: aggregation as any });
    },
    [removeColumn],
  );

  // Run table view handlers
  const handleLoadView = useCallback(
    (config: {
      columns: ColumnConfig[];
      baseOverrides: Record<string, any>;
      filters: any[];
      sorting: SortingState;
      pageSize?: number;
      groupBy?: string[];
      expanded?: string[];
    }) => {
      updateColumns(config.columns);
      setAllOverrides(config.baseOverrides);
      setAllFilters(config.filters);
      setSorting(config.sorting);
      if (config.pageSize != null) {
        setPageSize(config.pageSize);
      }
      // Apply groupBy first (clears expanded internally) then restore
      // the view's own expanded set so the saved buckets re-open.
      // `config.groupBy === undefined` means "preserve current groupBy" —
      // the saved-default auto-loader uses this to avoid clobbering the
      // localStorage-persisted groupBy with a stale snapshot (see
      // run-table-view-selector.tsx default-init effect). An explicit
      // empty array still clears grouping as the user expects.
      if (config.groupBy !== undefined) {
        handleGroupByChange(config.groupBy);
      }
      setExpandedGroups(config.expanded ?? []);
    },
    [updateColumns, setAllOverrides, setAllFilters, handleGroupByChange],
  );

  const handleResetToDefault = useCallback(() => {
    updateColumns([...DEFAULT_COLUMNS]);
    setAllOverrides({});
    setAllFilters([]);
    setSorting([]);
    setPageSize(DEFAULT_PAGE_SIZE);
    handleGroupByChange([]);
    setExpandedGroups([]);
  }, [updateColumns, setAllOverrides, setAllFilters, handleGroupByChange]);

  // Assemble the run collections from their sources — runs.list pages, the
  // ?runs= URL prefetch, and the IndexedDB-cached selection prefetch. All
  // merge rules live in ~lib/run-list-model.ts (unit-tested); the hook only
  // wires them to queries.
  const {
    urlRunIds,
    allLoadedRuns,
    cachedSelectedRunIds,
    prefetchedSelectedRuns,
    allVisibleRuns,
    serverFilteredRunIds,
  } = useRunListAssembly({
    organizationId,
    projectName,
    urlRunsParam,
    pages: data?.pages,
  });

  // Candidate tags for the filter and tag-editor dropdowns. Default view
  // derives them from the runs already loaded in the table (no extra
  // fetch). Grouped view doesn't load that flat list (the bucket tree
  // replaces it), so we fall back to a project-wide distinctTags fetch —
  // ~1KB, server-side ranked by usage, same shape allTags consumers
  // already expect. Either way, the dropdowns escape this seed and search
  // the backend once the user starts typing (via useTagSearch).
  const groupedTagsSeed = useQuery(
    trpc.runs.distinctTags.queryOptions(
      { organizationId, projectName, limit: 200 },
      { enabled: groupBy.length > 0, staleTime: 60_000 },
    ),
  );
  const allTags = useMemo(() => {
    if (groupBy.length > 0) {
      return groupedTagsSeed.data?.tags ?? [];
    }
    const counts = new Map<string, number>();
    const latest = new Map<string, number>();
    for (const run of allLoadedRuns) {
      const ts = run.createdAt ? new Date(run.createdAt).getTime() : 0;
      for (const tag of (run.tags ?? []) as string[]) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
        const prev = latest.get(tag) ?? 0;
        if (ts > prev) latest.set(tag, ts);
      }
    }
    return Array.from(counts.keys()).sort((a, b) => {
      const dc = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
      if (dc !== 0) return dc;
      const dt = (latest.get(b) ?? 0) - (latest.get(a) ?? 0);
      if (dt !== 0) return dt;
      return a.localeCompare(b);
    });
  }, [allLoadedRuns, groupBy.length, groupedTagsSeed.data]);

  // Extract metric column specs for the summaries query
  const metricColumnSpecs = useMemo(() => {
    return customColumns
      .filter((c): c is typeof c & { aggregation: MetricAggregation } => c.source === "metric" && !!c.aggregation)
      .map((c) => ({ logName: c.id, aggregation: c.aggregation }));
  }, [customColumns]);

  // Build run IDs for metric summaries: visible runs + cached selected runs.
  // Selected runs must always be included so their metric values persist when
  // sort changes push them out of the current page (e.g., NULLS LAST).
  const metricRunIds = useMemo(() => {
    const ids = new Set(allVisibleRuns.map((r) => r.id));
    for (const id of cachedSelectedRunIds) {
      ids.add(id);
    }
    return [...ids];
  }, [allVisibleRuns, cachedSelectedRunIds]);

  // Fetch metric summaries for visible + selected runs
  const { data: metricSummariesData, loadedRunIds: metricLoadedRunIds } = useMetricSummaries(
    organizationId,
    projectName,
    metricRunIds,
    metricColumnSpecs,
  );

  // Merge metric summaries into runs.
  // Field values (_flatConfig, _flatSystemMetadata) already arrive inline
  // from runs.list and getByIds — no separate fetch needed.
  //
  // _metricsLoading is set when the run isn't yet in the fetch
  // accumulator AND there are metric columns to fetch. Cells in metric
  // columns use this to render a skeleton instead of "-" so the user
  // can tell "still loading" apart from "value is genuinely null/NaN".
  const runs = useMemo(() => {
    if (metricColumnSpecs.length === 0) return allVisibleRuns;
    const summaries = metricSummariesData?.summaries ?? {};
    return allVisibleRuns.map((run) => {
      const runSummaries = summaries[run.id];
      const isLoading = !metricLoadedRunIds.has(run.id);
      if (runSummaries == null && !isLoading) return run;
      return {
        ...run,
        metricSummaries: runSummaries,
        _metricsLoading: isLoading,
      } as typeof run & { _metricsLoading?: boolean };
    });
  }, [allVisibleRuns, metricSummariesData, metricLoadedRunIds, metricColumnSpecs.length]);

  // Build filterable fields from system fields + config/systemMetadata keys.
  // When the user is searching, merge results from the cache table so keys
  // beyond the latest-100-runs scan are discoverable.
  const filterableFields = useMemo<FilterableField[]>(() => {
    const fields: FilterableField[] = SYSTEM_FILTERABLE_FIELDS.map(f => ({ ...f }));

    // Add tags options dynamically
    const tagsField = fields.find((f) => f.id === "tags");
    if (tagsField && allTags.length > 0) {
      tagsField.options = allTags.map((t) => ({ label: t, value: t }));
    }

    // Track which keys we've already added to avoid duplicates
    const seen = new Set<string>();

    // Add config keys from initial scan (last 100 runs)
    if (columnKeysData?.configKeys) {
      for (const ck of columnKeysData.configKeys) {
        seen.add(`config:${ck.key}`);
        fields.push({
          id: ck.key,
          source: "config",
          label: ck.key,
          dataType: ck.type as FilterableField["dataType"],
        });
      }
    }

    // Add system metadata keys from initial scan
    if (columnKeysData?.systemMetadataKeys) {
      for (const sk of columnKeysData.systemMetadataKeys) {
        seen.add(`systemMetadata:${sk.key}`);
        fields.push({
          id: sk.key,
          source: "systemMetadata",
          label: sk.key,
          dataType: sk.type as FilterableField["dataType"],
        });
      }
    }

    // Merge in search results from the cache table (keys not in the initial scan)
    if (searchKeysData?.configKeys) {
      for (const ck of searchKeysData.configKeys) {
        if (!seen.has(`config:${ck.key}`)) {
          fields.push({
            id: ck.key,
            source: "config",
            label: ck.key,
            dataType: ck.type as FilterableField["dataType"],
          });
        }
      }
    }
    if (searchKeysData?.systemMetadataKeys) {
      for (const sk of searchKeysData.systemMetadataKeys) {
        if (!seen.has(`systemMetadata:${sk.key}`)) {
          fields.push({
            id: sk.key,
            source: "systemMetadata",
            label: sk.key,
            dataType: sk.type as FilterableField["dataType"],
          });
        }
      }
    }

    return fields;
  }, [columnKeysData, searchKeysData, allTags]);

  // Handler for updating tags on a run — uses a ref so the callback identity
  // is stable and doesn't trigger column recreation on every mutation state change.
  const updateTagsMutationRef = useRef(updateTagsMutation);
  useEffect(() => { updateTagsMutationRef.current = updateTagsMutation; }, [updateTagsMutation]);
  const handleTagsUpdate = useCallback(
    (runId: string, tags: string[]) => {
      updateTagsMutationRef.current.mutate({
        organizationId,
        runId,
        projectName,
        tags,
      });
    },
    [organizationId, projectName]
  );

  // Handler for updating notes on a run — uses a ref so the callback identity
  // is stable and doesn't trigger column recreation on every mutation state change.
  const updateNotesMutationRef = useRef(updateNotesMutation);
  useEffect(() => { updateNotesMutationRef.current = updateNotesMutation; }, [updateNotesMutation]);
  const handleNotesUpdate = useCallback(
    (runId: string, notes: string | null) => {
      updateNotesMutationRef.current.mutate({
        organizationId,
        runId,
        projectName,
        notes,
      });
    },
    [organizationId, projectName]
  );


  const {
    runColors,
    selectedRunsWithColors,
    visibleRunsWithColors,
    hiddenRunIds,
    handleRunSelection,
    handleColorChange,
    toggleRunVisibility,
    setRunsHidden,
    showAllRuns,
    hideAllRuns,
    selectFirstN,
    selectAllByIds,
    deselectByIds,
    deselectAll,
    shuffleColors,
    reassignAllColors,
  } = useSelectedRuns(runs, organizationId, projectName, {
    urlRunIds,
    urlHiddenIds,
    onSelectionChange: debouncedSelectionChange,
    onHiddenChange: debouncedHiddenChange,
  });

  // Intersection count: how many of the CURRENTLY SELECTED runs also
  // match the toolbar filter. Powers the toolbar's third status line
  // ("N of your S selected runs match the filter"). Only fires when
  // BOTH a filter is active AND the user has selected runs — no point
  // paying an extra RTT for the trivial cases. `filterActive` is the
  // memoized flag already defined above.
  const selectedRunIdsForCount = useMemo(
    () => Object.keys(selectedRunsWithColors),
    [selectedRunsWithColors],
  );
  const shouldFireIntersection = filterActive && selectedRunIdsForCount.length > 0;
  const { data: selectedFilterMatchCount } = useRunCount(
    organizationId,
    projectName,
    shouldFireIntersection ? serverFilters.tags : undefined,
    shouldFireIntersection ? serverFilters.status : undefined,
    // Search intentionally omitted — the third line is about the
    // filter chips, not the search term (which is a separate lens).
    undefined,
    shouldFireIntersection ? serverFilters.dateFilters : undefined,
    shouldFireIntersection ? (serverFilters.fieldFilters as FieldFilterParam[] | undefined) : undefined,
    shouldFireIntersection ? (serverFilters.metricFilters as MetricFilterParam[] | undefined) : undefined,
    shouldFireIntersection ? (serverFilters.systemFilters as SystemFilterParam[] | undefined) : undefined,
    shouldFireIntersection ? selectedRunIdsForCount : undefined,
  );

  // Enrich selectedRunsWithColors with metric summaries so that runs served
  // from the IndexedDB cache (outOfPage path in mergeSelectedRuns) also carry
  // metric values.  Without this, sorting can push selected runs out of the
  // current page and their metric columns show "-".
  const enrichedSelectedRunsWithColors = useMemo(() => {
    const summaries = metricSummariesData?.summaries;
    if (!summaries || metricColumnSpecs.length === 0) {
      return selectedRunsWithColors;
    }
    let changed = false;
    const result: typeof selectedRunsWithColors = {};
    for (const [id, entry] of Object.entries(selectedRunsWithColors)) {
      const runSummaries = summaries[id];
      if (runSummaries && !(entry.run as any).metricSummaries) {
        changed = true;
        result[id] = { ...entry, run: { ...entry.run, metricSummaries: runSummaries } as any };
      } else {
        result[id] = entry;
      }
    }
    return changed ? result : selectedRunsWithColors;
  }, [selectedRunsWithColors, metricSummariesData, metricColumnSpecs.length]);

  // Unfiltered outermost-group count for the toolbar. Same server
  // proc the bucket tree uses, but without any toolbar filter or
  // search — so we get the true "N total groups" denominator even
  // when the user has a filter active reducing bucket tree's own
  // `data.totalCount` down. Only fires when grouping is on;
  // returnAll:true because we only care about the count, not the
  // values, and the count comes back regardless of paging.
  const outermostGroupField = groupBy[0];
  const { data: unfilteredGroupData } = useQuery({
    ...trpc.runs.distinctGroupValues.queryOptions({
      organizationId,
      projectName,
      field: outermostGroupField ?? "system:name",
      limit: 1,
      offset: 0,
    }),
    enabled: !!outermostGroupField,
    staleTime: 60_000,
  });
  const totalGroupCountUnfiltered = unfilteredGroupData?.totalCount ?? 0;

  // Selection-aware partition: the rows the table actually shows (with
  // stale-prefetch phantoms dropped) and the "in view" id set the search
  // "Other matches" dropdown partitions against. Rules live in
  // ~lib/run-list-model.ts.
  const { tableRuns, inViewRunIds } = useTableViewPartition({
    runs,
    allLoadedRuns,
    prefetchedSelectedRuns,
    selectedRunsWithColors,
    showOnlySelected,
    pinSelectedToTop,
  });

  // Unified selection: the checkbox column is the single selection control — a
  // checked run is plotted on the charts (?runs=) AND the target of bulk actions
  // (delete). It reads/writes the same chart-selection set the eye's visibility
  // toggle acts on, so there's no separate "checked" state to keep in sync.
  const selectedIdSet = useMemo(
    () => new Set(Object.keys(selectedRunsWithColors)),
    [selectedRunsWithColors],
  );

  const handleSetSelected = useCallback(
    (ids: string[], selected: boolean, runFallbacks?: Run[]) => {
      if (!selected) {
        ids.forEach((id) => handleRunSelection(id, false));
        return;
      }
      // Selecting: respect SELECTED_RUNS_LIMIT — add only up to the cap, so a
      // shift-range / select-all can't blow past the plotted-runs limit.
      const available = SELECTED_RUNS_LIMIT - Object.keys(selectedRunsWithColors).length;
      if (available <= 0) return;
      const toAdd = ids.filter((id) => !selectedRunsWithColors[id]).slice(0, available);
      // Pass the caller's run objects so grouped-mode rows (absent from the flat
      // `runs` list) still resolve inside selectAllByIds.
      if (toAdd.length > 0) selectAllByIds(toAdd, runFallbacks);
    },
    [handleRunSelection, selectAllByIds, selectedRunsWithColors],
  );

  const handleSelectedDeleted = useCallback(
    (deletedIds: string[]) => {
      // Deleted runs are removed from the chart selection so they don't linger.
      deletedIds.forEach((id) => handleRunSelection(id, false));
    },
    [handleRunSelection],
  );

  // Fetch logs only for selected runs (lazy loading)
  const selectedRunIds = useMemo(
    () => Object.keys(selectedRunsWithColors),
    [selectedRunsWithColors]
  );
  const { data: logsByRunId } = useSelectedRunLogs(
    selectedRunIds,
    projectName,
    organizationId
  );

  // "Other matches" dropdown — searches across all runs ignoring active filters.
  // Gated on `!otherMatchesDismissed` so window-focus refetches don't fire
  // while the popover is hidden.
  const otherMatches = useSearchOtherMatches({
    organizationId,
    projectName,
    query: debouncedSearch,
    inViewRunIds,
    filterActive,
    displayOnlySelectedActive: showOnlySelected,
    pinSelectedToTopActive: pinSelectedToTop,
    enabled: !otherMatchesDismissed,
  });

  // Esc and click-outside both dismiss the dropdown but keep the typed
  // query in place so the user can refocus the input to bring it back.
  const handleDismissOtherMatchesDropdown = useCallback(() => {
    setOtherMatchesDismissed(true);
  }, []);

  // Refocusing the search input re-opens the dropdown — the user came
  // back to the search bar, so they probably want to see the results
  // again. If there's still nothing to show, the dropdown stays hidden
  // via its own render gate.
  const handleSearchFocus = useCallback(() => {
    setOtherMatchesDismissed(false);
  }, []);

  // Per-user / per-browser "best step (with image)" tolerance, scoped to
  // this project. Stored in localStorage — no backend persistence so one
  // user's tweak doesn't reshape pins for the rest of the team.
  const [bestStepToleranceSteps, handleChangeBestStepTolerance] =
    useBestStepTolerance(projectName);

  // Pin images to best step handler. The backend returns
  // { argmin, argmax } where each entry is { metricStep, imageStep, distance }.
  // When `with image` is requested, nearest-snap coupling produces a non-null
  // imageStep (= the actual file to render) and distance (= metric↔image
  // step delta for provenance). Without image coupling, imageStep/distance
  // are null and we pin the metric step directly.
  //
  // The optional `toleranceOverride` lets the column-header dropdown pass
  // the user's freshly-typed value for THIS click even if they haven't
  // saved it back to localStorage yet — falls back to the persisted
  // value otherwise.
  const handlePinImagesToBestStep = useCallback(
    async (
      logName: string,
      mode: "argmin" | "argmax" | "argmin-with-image" | "argmax-with-image",
      toleranceOverride?: number,
    ) => {
      if (selectedRunIds.length === 0) return;

      const useMin = mode === "argmin" || mode === "argmin-with-image";
      const withImage =
        mode === "argmin-with-image" || mode === "argmax-with-image";

      try {
        const result = await queryClient.fetchQuery(
          trpc.runs.metricBestSteps.queryOptions({
            organizationId,
            projectName,
            logName,
            runIds: selectedRunIds,
            perWidget: withImage,
            toleranceSteps: toleranceOverride ?? bestStepToleranceSteps,
          }),
        );

        const toleranceUsed = result.toleranceUsed ?? 0;

        if (withImage && result.perWidgetBestSteps && result.perWidgetBestSteps.length > 0) {
          // Per-widget pins: key is "runId:imageLogName", value is the
          // imageStep (what the widget renders) for the chosen argmin/argmax.
          const pinsByWidget: Record<string, number> = {};
          // Parallel map carrying provenance (metric step + distance) and
          // tied-alternative step so the image card can show a "tied
          // with step X" hint on hover.
          const pinMetadataByWidget: Record<
            string,
            {
              metricStep: number;
              metricValue: number | null;
              distance: number;
              tiedAlternativeImageStep: number | null;
            }
          > = {};
          for (const entry of result.perWidgetBestSteps) {
            if (!entry) continue;
            const bestEntry = useMin ? entry.argmin : entry.argmax;
            const stepToPin = bestEntry.imageStep ?? bestEntry.metricStep;
            const key = `${entry.runId}:${entry.imageLogName}`;
            pinsByWidget[key] = stepToPin;
            pinMetadataByWidget[key] = {
              metricStep: bestEntry.metricStep,
              metricValue: bestEntry.metricValue,
              distance: bestEntry.distance ?? 0,
              tiedAlternativeImageStep: bestEntry.tiedAlternativeImageStep,
            };
          }
          document.dispatchEvent(
            new CustomEvent("pin-runs-to-best-step", {
              detail: {
                pinsByWidget,
                pinMetadataByWidget,
                toleranceUsed,
                mode,
                logName,
              },
            }),
          );
        } else if (result.bestSteps && result.bestSteps.length > 0) {
          // Single step per run (applies to all image widgets).
          const pins: Record<string, number> = {};
          const pinMetadata: Record<
            string,
            {
              metricStep: number;
              metricValue: number | null;
              distance: number;
              tiedAlternativeImageStep: number | null;
            }
          > = {};
          for (const entry of result.bestSteps) {
            if (!entry) continue;
            const bestEntry = useMin ? entry.argmin : entry.argmax;
            const stepToPin = bestEntry.imageStep ?? bestEntry.metricStep;
            pins[entry.runId] = stepToPin;
            pinMetadata[entry.runId] = {
              metricStep: bestEntry.metricStep,
              metricValue: bestEntry.metricValue,
              distance: bestEntry.distance ?? 0,
              tiedAlternativeImageStep: bestEntry.tiedAlternativeImageStep,
            };
          }
          document.dispatchEvent(
            new CustomEvent("pin-runs-to-best-step", {
              detail: {
                pins,
                pinMetadata,
                toleranceUsed,
                mode,
                logName,
              },
            }),
          );
        }
      } catch (error) {
        console.error("Failed to fetch best steps:", error);
      }
    },
    [selectedRunIds, organizationId, projectName, bestStepToleranceSteps],
  );

  // In experiments mode, unify colors so all runs in the same experiment
  // (same name) share one color. Keep ALL runs for chart data — the table
  // handles collapsing to one row per experiment, but charts show all branches.
  const effectiveRunsWithColors = useMemo(() => {
    if (listMode !== "experiments") return selectedRunsWithColors;
    const nameToColor = new Map<string, string>();
    const result: typeof selectedRunsWithColors = {};
    for (const [id, entry] of Object.entries(selectedRunsWithColors)) {
      const name = entry.run.name;
      if (!nameToColor.has(name)) {
        nameToColor.set(name, entry.color);
      }
      result[id] = { ...entry, color: nameToColor.get(name)! };
    }
    return result;
  }, [selectedRunsWithColors, listMode]);

  // Process metrics data from ALL selected runs (including hidden)
  // Hidden runs are toggled via imperative uPlot setSeries() in chart-sync-context,
  // keeping series count stable to avoid chart destroy/recreate flash
  const groupedMetrics = useMemo(() => {
    const metrics = groupMetrics(effectiveRunsWithColors, logsByRunId, organizationId, projectName);
    return metrics;
  }, [effectiveRunsWithColors, logsByRunId, organizationId, projectName]);

  // Build experiment run ID lookup: runId → all runIds with the same name.
  // Used by chart sync context for experiment-level group highlighting.
  const experimentRunIdsMap = useMemo(() => {
    if (listMode !== "experiments") return null;
    const nameToIds = new Map<string, string[]>();
    for (const [id, { run }] of Object.entries(selectedRunsWithColors)) {
      const ids = nameToIds.get(run.name) ?? [];
      ids.push(id);
      nameToIds.set(run.name, ids);
    }
    // Build reverse map: runId → all runIds in same experiment
    const map = new Map<string, string[]>();
    for (const ids of nameToIds.values()) {
      for (const id of ids) {
        map.set(id, ids);
      }
    }
    return map;
  }, [selectedRunsWithColors, listMode]);

  // Dispatch DOM event when hidden runs change — chart-sync-context listens
  // and imperatively toggles uPlot series visibility on already-mounted
  // charts (no React re-render). Charts that mount after this event fires
  // pick up the value via the synchronous prop-sync inside ChartSyncProvider.
  useEffect(() => {
    const event = new CustomEvent('run-visibility-change', {
      detail: hiddenRunIds,
    });
    document.dispatchEvent(event);
  }, [hiddenRunIds]);

  return (
    <RunComparisonLayout>
      <PageLayout
        showSidebarTrigger={false}
        disableScroll={true}
        headerLeft={
          <OrganizationPageTitle
            breadcrumbs={[
              { title: "Home", to: "/o/$orgSlug" },
              { title: "Projects", to: "/o/$orgSlug/projects" },
            ]}
            title={projectName}
          />
        }
      >
        <ImageStepSyncProvider>
        <RunSyncProvider>
        <ResizablePanelGroup
          orientation="horizontal"
          className="h-[calc(100vh-4rem)] w-full p-2"
          defaultLayout={{
            "runs-list": 30,
            "metrics-display": 70,
          }}
        >
          <ResizablePanel
            panelRef={listPanelRef}
            id="runs-list"
            defaultSize={30}
            minSize={15}
            collapsible
            collapsedSize={0}
            onResize={(size) => {
              if (size.asPercentage === 0) {
                setPanelLayout("graphs-only");
              } else {
                setPanelLayout((prev) => prev === "graphs-only" ? "both" : prev);
              }
            }}
            className="overflow-hidden"
          >
            <div className="flex h-full min-h-0 flex-col overflow-hidden pr-2">
              <DataTable
                runs={tableRuns}
                serverFilteredRunIds={serverFilteredRunIds}
                filterActive={filterActive}
                orgSlug={organizationSlug}
                projectName={projectName}
                organizationId={organizationId}
                onColorChange={handleColorChange}
                onSelectionChange={handleRunSelection}
                onToggleVisibility={toggleRunVisibility}
                onSetRunsHidden={setRunsHidden}
                onTagsUpdate={handleTagsUpdate}
                onNotesUpdate={handleNotesUpdate}
                selectedRunsWithColors={enrichedSelectedRunsWithColors}
                hiddenRunIds={hiddenRunIds}
                runColors={runColors}
                isLoading={(isLoading && !data) || (runCountLoading && runCount === undefined)}
                isFetching={isFetching}
                runCount={runCount || 0}
                totalRunCount={totalRunCount || runCount || 0}
                selectedFilterMatchCount={
                  shouldFireIntersection ? selectedFilterMatchCount : undefined
                }
                totalGroupCountUnfiltered={totalGroupCountUnfiltered}
                fetchNextPage={fetchNextPage}
                hasNextPage={hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
                serverFetchedCount={serverFetchedCount}
                allTags={allTags}
                filters={filters}
                filterableFields={filterableFields}
                onAddFilter={addFilter}
                onRemoveFilter={removeFilter}
                onClearFilters={clearFilters}
                onFieldSearch={handleFieldSearch}
                isSearchingFields={isSearchingKeys || isSearchingMetrics}
                searchQuery={searchInput}
                onSearchChange={handleSearchChange}
                onSearchFocus={handleSearchFocus}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                panelLayout={panelLayout}
                onToggleListPanel={toggleListPanel}
                onToggleGraphsPanel={toggleGraphsPanel}
                onSelectFirstN={selectFirstN}
                onSelectAllByIds={selectAllByIds}
                onDeselectByIds={deselectByIds}
                onDeselectAll={deselectAll}
                onShuffleColors={shuffleColors}
                onReassignAllColors={reassignAllColors}
                onShowAllRuns={showAllRuns}
                onHideAllRuns={hideAllRuns}
                customColumns={customColumns}
                availableConfigKeys={[
                  ...(columnKeysData?.configKeys?.map((k) => k.key) ?? []),
                  ...(searchKeysData?.configKeys?.map((k) => k.key).filter((k) => !columnKeysData?.configKeys?.some((ck) => ck.key === k)) ?? []),
                ]}
                availableSystemMetadataKeys={[
                  ...(columnKeysData?.systemMetadataKeys?.map((k) => k.key) ?? []),
                  ...(searchKeysData?.systemMetadataKeys?.map((k) => k.key).filter((k) => !columnKeysData?.systemMetadataKeys?.some((sk) => sk.key === k)) ?? []),
                ]}
                availableMetricNames={metricNames}
                onColumnToggle={handleColumnToggle}
                onClearColumns={handleClearColumns}
                columnKeysLoading={columnKeysLoading}
                onColumnSearch={handleFieldSearch}
                isSearchingColumns={isSearchingKeys || isSearchingMetrics}
                onColumnRename={handleColumnRename}
                onColumnSetColor={handleColumnSetColor}
                onColumnRemove={handleColumnRemove}
                nameOverrides={nameOverrides}
                onNameRename={handleNameRename}
                onNameSetColor={handleNameSetColor}
                onReorderColumns={reorderColumns}
                onToggleColumnPin={toggleColumnPin}
                onPinImagesToBestStep={handlePinImagesToBestStep}
                bestStepToleranceSteps={bestStepToleranceSteps}
                onChangeBestStepTolerance={handleChangeBestStepTolerance}
                sorting={sorting}
                onSortingChange={setSorting}
                sortParam={sortParam}
                statusFilterValues={statusFilterValues}
                onStatusFilterChange={handleStatusFilterChange}
                checkedRunIds={selectedIdSet}
                onSetChecked={handleSetSelected}
                checkedRunsWithColors={enrichedSelectedRunsWithColors}
                onCheckedDeleted={handleSelectedDeleted}
                pageSize={pageSize}
                onPageSizeChange={handlePageSizeChange}
                pageBase={pageBase}
                onJumpToPage={setPageBase}
                viewSelector={
                  <RunTableViewSelector
                    organizationId={organizationId}
                    projectName={projectName}
                    currentColumns={customColumns}
                    currentBaseOverrides={baseOverrides}
                    currentFilters={filters}
                    currentSorting={sorting}
                    currentPageSize={pageSize}
                    currentGroupBy={groupBy}
                    currentExpanded={expandedGroups}
                    activeViewId={activeViewId}
                    onActiveViewChange={setActiveViewId}
                    onLoadView={handleLoadView}
                    onResetToDefault={handleResetToDefault}
                  />
                }
                activeChartViewId={chart ?? null}
                listMode={listMode}
                onListModeChange={handleListModeChange}
                showInherited={urlInherited !== "false"}
                onInheritedToggle={handleInheritedToggle}
                groupBy={groupBy}
                onGroupByChange={handleGroupByChange}
                expandedGroups={expandedGroups}
                onExpandedGroupsChange={setExpandedGroups}
                showOnlySelected={showOnlySelected}
                onShowOnlySelectedChange={setShowOnlySelected}
                pinSelectedToTop={pinSelectedToTop}
                onPinSelectedToTopChange={setPinSelectedToTop}
                searchOtherMatchesDropdown={
                  // Mirror the hook's enabled gate at the render site
                  // so toggling DOS / Pin / a filter back off makes the
                  // dropdown disappear in grouped mode too. The hook
                  // stops firing, but React Query keeps its cached
                  // data — the memo re-partitions against
                  // `inViewRunIds`, and in grouped mode that set
                  // doesn't grow (useListRuns is disabled, so
                  // `tableRuns` stays empty), leaving the cached
                  // `outOfView` in place. In flat mode the re-
                  // partition naturally empties `outOfView`, so this
                  // gate is a no-op there.
                  (otherMatchesDismissed
                    || debouncedSearch.trim().length === 0
                    || !(filterActive || showOnlySelected || pinSelectedToTop)) ? null : (
                    <SearchOtherMatchesDropdown
                      outOfView={otherMatches.outOfView}
                      inView={otherMatches.inView}
                      hasMore={otherMatches.hasMore}
                      isLoading={otherMatches.isLoading}
                      selectedRunsWithColors={enrichedSelectedRunsWithColors}
                      onSelectRun={(run) => handleRunSelection(run.id, true, run)}
                      onDeselectRun={(runId) => handleRunSelection(runId, false)}
                      onDismiss={handleDismissOtherMatchesDropdown}
                    />
                  )
                }
              />
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            panelRef={graphsPanelRef}
            id="metrics-display"
            defaultSize={70}
            collapsible
            collapsedSize={0}
            onResize={(size) => {
              if (size.asPercentage === 0) {
                setPanelLayout("list-only");
              } else {
                setPanelLayout((prev) => prev === "list-only" ? "both" : prev);
              }
            }}
          >
            <div className="flex h-full flex-col overflow-y-auto overscroll-y-contain pl-2">
              {(isLoading || runCountLoading) && runs.length === 0 ? (
                <Skeleton className="h-full w-full" />
              ) : (
                <>
                  {viewMode === "side-by-side" ? (
                    <SideBySideView
                      selectedRunsWithColors={visibleRunsWithColors}
                      onRemoveRun={(runId) => handleRunSelection(runId, false)}
                      organizationId={organizationId}
                      projectName={projectName}
                    />
                  ) : (
                    // MetricsDisplay is only mounted while the user is on
                    // Charts view. Keeping it mounted-but-hidden via CSS in
                    // side-by-side mode left every dashboard useQuery an
                    // active observer and every chart's DOM listeners live,
                    // which produced visible UI lag (re-renders on cache
                    // changes, RefreshButton timer firing, dynamic-section
                    // regex queries refetching) even with auto-refresh off.
                    // Switching back to Charts re-mounts the tree; query
                    // data is served from the TanStack Query cache so the
                    // refetch cost is minimal. Only in-component state like
                    // per-chart uPlot zoom is lost on the switch.
                    <div className="relative h-full">
                      <MetricsDisplay
                        groupedMetrics={groupedMetrics}
                        onRefresh={refresh}
                        organizationId={organizationId}
                        projectName={projectName}
                        lastRefreshed={lastRefreshed}
                        selectedRuns={effectiveRunsWithColors}
                        selectedViewId={chart ?? null}
                        onViewChange={handleViewChange}
                        showInheritedMetrics={urlInherited === "false" ? false : true}
                        onInheritedChange={handleInheritedChange}
                        experimentRunIdsMap={experimentRunIdsMap}
                        hiddenRunIds={hiddenRunIds}
                        groupBy={groupBy}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
        </RunSyncProvider>
        </ImageStepSyncProvider>
      </PageLayout>
    </RunComparisonLayout>
  );
}
