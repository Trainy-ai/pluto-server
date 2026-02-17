import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import type { Run } from "../../~queries/list-runs";
import { useRunMetricNames, useMetricSummaries } from "../../~queries/metric-summaries";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronDown, ChevronRight, Eye, EyeOff, Search, X, Code2, Text, GitCompareArrows } from "lucide-react";
import { formatValue } from "@/lib/flatten-object";

interface SideBySideViewProps {
  selectedRunsWithColors: Record<string, { run: Run; color: string }>;
  onRemoveRun?: (runId: string) => void;
  organizationId: string;
  projectName: string;
}

const DEFAULT_COL_WIDTH = 200;
const MIN_COL_WIDTH = 120;

// Sticky key column divider style: border-right on each sticky cell.
// We use border-separate on the table so each cell owns its borders independently,
// preventing scrolled content from covering the sticky cell's border.
const KEY_COL_BORDER = "2px solid hsl(var(--border))";

// Prefixes that identify imported (e.g. Neptune) metadata keys within the config object.
const IMPORTED_KEY_PREFIXES = ["sys/", "source_code/"];

// Priority ordering for import keys — Map for O(1) lookups in sort comparator
const IMPORT_KEY_PRIORITY = new Map([
  "sys/name", "sys/id", "sys/creation_time", "sys/custom_run_id",
  "sys/owner", "sys/tags", "sys/modification_time", "sys/ping_time",
  "sys/family", "sys/description", "sys/failed", "sys/state",
  "sys/size", "sys/archived", "sys/trashed", "sys/group_tags",
].map((key, i) => [key, i] as const));

const COLLAPSED_MAX_HEIGHT = 60; // px - roughly 3 lines of monospace text

// Diff highlight colors (git-style)
const DIFF_ADDED_BG = "color-mix(in srgb, hsl(142 76% 36%) 25%, hsl(var(--background)))";
const DIFF_REMOVED_BG = "color-mix(in srgb, hsl(0 72% 51%) 25%, hsl(var(--background)))";

// Check if values differ across runs for a given row.
// Returns true if at least two runs have different formatted values.
function hasRowDiff(values: string[]): boolean {
  if (values.length < 2) return false;
  const first = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] !== first) return true;
  }
  return false;
}

// For a row of values, return which cells differ from the reference run.
// Reference cell is highlighted as "removed" (red), differing cells as "added" (green).
function getDiffHighlights(values: string[], refIndex: number): (string | undefined)[] {
  if (values.length < 2) return values.map(() => undefined);
  const ref = values[refIndex];
  const anyDiff = values.some((v, i) => i !== refIndex && v !== ref);
  if (!anyDiff) return values.map(() => undefined);
  return values.map((v, i) => {
    if (i === refIndex) return DIFF_REMOVED_BG; // reference run
    return v !== ref ? DIFF_ADDED_BG : undefined;
  });
}

// Column index: 0 = key column, 1+ = run columns
// Uses useEffect for event listener cleanup to prevent memory leaks on unmount.
function useResizableColumns(numColumns: number) {
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>({});
  const [dragState, setDragState] = useState<{
    colIndex: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  const handleMouseDown = useCallback(
    (colIndex: number, e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      setColumnWidths((prev) => {
        const startWidth = prev[colIndex] ?? DEFAULT_COL_WIDTH;
        setDragState({ colIndex, startX, startWidth });
        return prev;
      });
    },
    [],
  );

  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const diff = moveEvent.clientX - dragState.startX;
      const newWidth = Math.max(MIN_COL_WIDTH, dragState.startWidth + diff);
      setColumnWidths((prev) => ({
        ...prev,
        [dragState.colIndex]: newWidth,
      }));
    };

    const handleMouseUp = () => {
      setDragState(null);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState]);

  const getWidth = useCallback(
    (colIndex: number) => {
      return columnWidths[colIndex] ?? DEFAULT_COL_WIDTH;
    },
    [columnWidths],
  );

  // Total width of all columns (key + runs)
  const totalWidth = useMemo(() => {
    let total = 0;
    for (let i = 0; i <= numColumns; i++) {
      total += columnWidths[i] ?? DEFAULT_COL_WIDTH;
    }
    return total;
  }, [columnWidths, numColumns]);

  return { getWidth, handleMouseDown, totalWidth };
}

// Opaque section header background using color-mix to bake primary into the background
const SECTION_BG = "color-mix(in srgb, hsl(var(--primary)) 12%, hsl(var(--background)))";

// Section header with collapse toggle: first cell is sticky left with the label, remaining cells are empty
function SectionHeader({
  numRunCols,
  label,
  isCollapsed,
  onToggle,
}: {
  numRunCols: number;
  label: string;
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <tr className="border-y-2 border-border" style={{ background: SECTION_BG }}>
      <td
        className="sticky left-0 z-10 px-3 py-2 cursor-pointer select-none"
        style={{ background: SECTION_BG, borderRight: KEY_COL_BORDER }}
        onClick={onToggle}
      >
        <div className="flex items-center gap-1.5">
          {isCollapsed ? (
            <ChevronRight className="h-3.5 w-3.5 text-primary" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-primary" />
          )}
          <span className="text-xs font-bold uppercase tracking-wider text-primary">
            {label}
          </span>
        </div>
      </td>
      {Array.from({ length: numRunCols }, (_, i) => (
        <td
          key={i}
          className="px-3 py-2 cursor-pointer"
          style={{ background: SECTION_BG }}
          onClick={onToggle}
        />
      ))}
    </tr>
  );
}

// Collapsible cell for long content - default collapsed
function CollapsibleCell({ value, isEmpty }: { value: string; isEmpty: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [needsCollapse, setNeedsCollapse] = useState(false);

  const checkOverflow = useCallback((el: HTMLDivElement | null) => {
    contentRef.current = el;
    if (el) {
      setNeedsCollapse(el.scrollHeight > COLLAPSED_MAX_HEIGHT);
    }
  }, []);

  const handleToggle = useCallback(() => {
    const wasExpanded = isExpanded;
    setIsExpanded(!wasExpanded);
    // When collapsing, scroll the row back into view so the user isn't stranded
    if (wasExpanded && containerRef.current) {
      // Use requestAnimationFrame to wait for the DOM to update after state change
      requestAnimationFrame(() => {
        containerRef.current?.closest("tr")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    }
  }, [isExpanded]);

  if (isEmpty) {
    return <span className="break-all font-mono text-xs">-</span>;
  }

  return (
    <div ref={containerRef}>
      <div
        ref={checkOverflow}
        className="break-all font-mono text-xs overflow-hidden"
        style={!isExpanded && needsCollapse ? { maxHeight: COLLAPSED_MAX_HEIGHT } : undefined}
      >
        {value}
      </div>
      {needsCollapse && (
        <button
          type="button"
          onClick={handleToggle}
          className="mt-1 flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {isExpanded ? (
            <>
              <ChevronDown className="h-3 w-3" />
              Show less
            </>
          ) : (
            <>
              <ChevronRight className="h-3 w-3" />
              Show more
            </>
          )}
        </button>
      )}
    </div>
  );
}

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

// Check if a key or any of its values match the search
function rowMatchesSearch(
  key: string,
  values: unknown[],
  searchTerm: string,
  isRegex: boolean,
): boolean {
  if (!searchTerm) return true;
  if (isRegex) {
    try {
      const re = new RegExp(searchTerm, "i");
      if (re.test(key)) return true;
      return values.some((v) => v != null && re.test(formatValue(v)));
    } catch {
      return true; // invalid regex shows everything
    }
  }
  const lower = searchTerm.toLowerCase();
  if (key.toLowerCase().includes(lower)) return true;
  return values.some((v) => v != null && formatValue(v).toLowerCase().includes(lower));
}

const METRIC_AGGS = ["MIN", "MAX", "AVG", "LAST", "VARIANCE"] as const;

// Sub-header background for metric name rows - slightly lighter than section header
const METRIC_SUB_BG = "color-mix(in srgb, hsl(var(--primary)) 6%, hsl(var(--background)))";

function formatMetricValue(value: number | undefined | null): string {
  if (value == null) return "-";
  // Use toPrecision for compact display of very large or very small numbers
  if (Math.abs(value) >= 1e6 || (Math.abs(value) < 1e-4 && value !== 0)) {
    return value.toExponential(4);
  }
  // Up to 6 significant digits for normal range
  return Number(value.toPrecision(6)).toString();
}

// Renders a collapsible group for a single metric: sub-header row + 5 aggregation rows
function MetricSubGroup({
  metricName,
  isExpanded,
  onToggle,
  selectedRuns,
  summaries,
  numRunCols,
  showOnlyDiffs,
  referenceRunIndex,
}: {
  metricName: string;
  isExpanded: boolean;
  onToggle: () => void;
  selectedRuns: { run: Run; color: string }[];
  summaries: Record<string, Record<string, number>> | undefined;
  numRunCols: number;
  showOnlyDiffs: boolean;
  referenceRunIndex: number;
}) {
  return (
    <>
      {/* Metric name sub-header row */}
      <tr
        className="border-b border-border/50 cursor-pointer select-none hover:bg-accent/30 transition-colors"
        style={{ background: METRIC_SUB_BG }}
        onClick={onToggle}
      >
        <td
          className="sticky left-0 z-10 px-3 py-1.5"
          style={{ background: METRIC_SUB_BG, borderRight: KEY_COL_BORDER }}
        >
          <div className="flex items-center gap-1.5 pl-2">
            {isExpanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
            <span className="break-all font-mono text-xs font-medium text-foreground">
              {metricName}
            </span>
          </div>
        </td>
        {Array.from({ length: numRunCols }, (_, i) => (
          <td
            key={i}
            className="px-3 py-1.5"
            style={{ background: METRIC_SUB_BG }}
          />
        ))}
      </tr>
      {/* Aggregation rows (when expanded) */}
      {isExpanded &&
        METRIC_AGGS.map((agg, idx) => {
          const values = selectedRuns.map(({ run }) => formatMetricValue(summaries?.[run.id]?.[`${metricName}|${agg}`]));
          const highlights = showOnlyDiffs ? getDiffHighlights(values, referenceRunIndex) : values.map(() => undefined);
          return (
          <tr
            key={`${metricName}-${agg}`}
            className={`border-b border-border/50 ${
              idx % 2 === 0 ? "bg-background" : "bg-muted"
            } hover:bg-accent/30 transition-colors`}
          >
            <td
              style={{ borderRight: KEY_COL_BORDER }}
              className={`sticky left-0 z-10 px-3 py-1.5 align-top ${
                idx % 2 === 0 ? "bg-background" : "bg-muted"
              }`}
            >
              <span className="pl-6 text-xs font-medium text-muted-foreground">
                {agg}
              </span>
            </td>
            {selectedRuns.map(({ run }, colIdx) => {
              const isEmpty = values[colIdx] === "-";
              return (
                <td
                  key={run.id}
                  className={`border-r border-border/50 px-3 py-1.5 align-top last:border-r-0 ${
                    isEmpty ? "text-muted-foreground/50" : "text-foreground"
                  }`}
                  style={highlights[colIdx] ? { background: highlights[colIdx] } : undefined}
                >
                  <span className="break-all font-mono text-xs">
                    {values[colIdx]}
                  </span>
                </td>
              );
            })}
          </tr>
          );
        })}
    </>
  );
}

export function SideBySideView({ selectedRunsWithColors, onRemoveRun, organizationId, projectName }: SideBySideViewProps) {
  const selectedRuns = Object.values(selectedRunsWithColors);

  // Search state
  const [searchValue, setSearchValue] = useState("");
  const [isRegexMode, setIsRegexMode] = useState(false);
  const [isInvalidRegex, setIsInvalidRegex] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Diff-only mode: show only rows where values differ across runs
  const [showOnlyDiffs, setShowOnlyDiffs] = useState(false);

  // Index of the reference run for diff highlighting (default: first run)
  const [referenceRunIndex, setReferenceRunIndex] = useState(0);
  // Clamp reference index if runs change (e.g. a run is removed)
  const clampedRefIndex = Math.min(referenceRunIndex, selectedRuns.length - 1);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setSearchValue(val);
      if (isRegexMode && val) {
        setIsInvalidRegex(!isValidRegex(val));
      } else {
        setIsInvalidRegex(false);
      }
    },
    [isRegexMode],
  );

  const handleSearchClear = useCallback(() => {
    setSearchValue("");
    setIsInvalidRegex(false);
    searchInputRef.current?.focus();
  }, []);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && searchValue) {
        e.preventDefault();
        handleSearchClear();
      }
    },
    [searchValue, handleSearchClear],
  );

  const toggleRegexMode = useCallback(() => {
    setIsRegexMode((prev) => {
      const next = !prev;
      if (!next) {
        setIsInvalidRegex(false);
      } else if (searchValue) {
        setIsInvalidRegex(!isValidRegex(searchValue));
      }
      return next;
    });
  }, [searchValue]);

  // Section collapse state
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const toggleSection = useCallback((section: string) => {
    setCollapsedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);

  // Per-metric collapse state (collapsed by default)
  const [expandedMetrics, setExpandedMetrics] = useState<Record<string, boolean>>({});
  const toggleMetric = useCallback((metricName: string) => {
    setExpandedMetrics((prev) => ({ ...prev, [metricName]: !prev[metricName] }));
  }, []);

  // Fetch metric names scoped to selected runs (all names, no limit)
  const selectedRunIds = useMemo(() => selectedRuns.map(({ run }) => run.id), [selectedRuns]);
  const { data: metricNamesData } = useRunMetricNames(organizationId, projectName, selectedRunIds);
  const allMetricNames = useMemo(() => metricNamesData?.metricNames ?? [], [metricNamesData]);

  // Only fetch summaries for expanded metrics (lazy-load to avoid URL-too-long errors)
  const expandedMetricNames = useMemo(
    () => allMetricNames.filter((name) => expandedMetrics[name]),
    [allMetricNames, expandedMetrics],
  );

  const metricSpecs = useMemo(
    () => expandedMetricNames.flatMap((name) => METRIC_AGGS.map((agg) => ({ logName: name, aggregation: agg }))),
    [expandedMetricNames],
  );

  const { data: metricSummariesData } = useMetricSummaries(
    organizationId,
    projectName,
    selectedRunIds,
    metricSpecs,
  );

  const {
    allConfigKeys,
    runConfigs,
    allSysMetaKeys,
    runSysMeta,
    importKeys,
    nonImportConfigKeys,
    runImportData,
    hasAnyImportData,
  } = useMemo(() => {
    const configKeySet = new Set<string>();
    const configs: Record<string, Record<string, unknown>> = {};
    const sysMetaKeySet = new Set<string>();
    const sysMeta: Record<string, Record<string, unknown>> = {};
    // Track import (sys/*) keys separately from other config keys
    const importKeySet = new Set<string>();
    const importData: Record<string, Record<string, unknown>> = {};
    let anyImport = false;

    for (const { run } of selectedRuns) {
      // Use pre-flattened data from the data layer (flattened once at load time)
      const flatConfig: Record<string, unknown> = (run as any)._flatConfig ?? {};
      configs[run.id] = flatConfig;

      const runImport: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(flatConfig)) {
        configKeySet.add(key);
        if (IMPORTED_KEY_PREFIXES.some(prefix => key.startsWith(prefix))) {
          importKeySet.add(key);
          runImport[key] = value;
          anyImport = true;
        }
      }
      importData[run.id] = runImport;

      const flatSysMeta: Record<string, unknown> = (run as any)._flatSystemMetadata ?? {};
      sysMeta[run.id] = flatSysMeta;
      for (const key of Object.keys(flatSysMeta)) {
        sysMetaKeySet.add(key);
      }
    }

    // Priority ordering for import keys: sys/ fields first in a specific order, then others
    const sortedImportKeys = Array.from(importKeySet).sort((a, b) => {
      const aIdx = IMPORT_KEY_PRIORITY.get(a) ?? -1;
      const bIdx = IMPORT_KEY_PRIORITY.get(b) ?? -1;
      // Both in priority list
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      // Only one in priority list
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      const aSys = a.startsWith("sys/");
      const bSys = b.startsWith("sys/");
      // Both sys/ but not in priority list
      if (aSys && bSys) return a.localeCompare(b);
      // sys/ before non-sys/
      if (aSys) return -1;
      if (bSys) return 1;
      // Non-sys/ alphabetical
      return a.localeCompare(b);
    });
    const nonImport = Array.from(configKeySet)
      .filter((k) => !importKeySet.has(k))
      .sort((a, b) => a.localeCompare(b));

    return {
      allConfigKeys: Array.from(configKeySet).sort((a, b) => a.localeCompare(b)),
      runConfigs: configs,
      allSysMetaKeys: Array.from(sysMetaKeySet).sort((a, b) => a.localeCompare(b)),
      runSysMeta: sysMeta,
      importKeys: sortedImportKeys,
      nonImportConfigKeys: nonImport,
      runImportData: importData,
      hasAnyImportData: anyImport,
    };
  }, [selectedRuns]);

  const { getWidth, handleMouseDown, totalWidth } = useResizableColumns(selectedRuns.length);

  // Helper to get owner name from Pluto creator relation
  function getPlutoOwner(run: Run): string {
    if (run.creator?.name) return run.creator.name;
    if (run.creator?.email) return run.creator.email;
    // Fallback to git info from pre-flattened systemMetadata
    const flat: Record<string, unknown> | undefined = (run as any)._flatSystemMetadata;
    if (flat) {
      const gitName = flat["git.name"];
      if (gitName && typeof gitName === "string") return gitName;
      const gitEmail = flat["git.email"];
      if (gitEmail && typeof gitEmail === "string") return gitEmail;
    }
    return "-";
  }

  // Pluto metadata rows - always shown, uses Pluto DB fields
  const plutoMetadataRows: { key: string; getValue: (run: Run) => string }[] = [
    {
      key: "Name",
      getValue: (run: Run) => run.name || "-",
    },
    {
      key: "Id",
      getValue: (run: Run) => run.id,
    },
    {
      key: "Status",
      getValue: (run: Run) => run.status || "-",
    },
    {
      key: "Owner",
      getValue: (run: Run) => getPlutoOwner(run),
    },
    {
      key: "Created",
      getValue: (run: Run) =>
        run.createdAt ? new Date(run.createdAt).toLocaleString() : "-",
    },
    {
      key: "Updated",
      getValue: (run: Run) =>
        run.updatedAt ? new Date(run.updatedAt).toLocaleString() : "-",
    },
    {
      key: "Status Changed",
      getValue: (run: Run) =>
        run.statusUpdated ? new Date(run.statusUpdated).toLocaleString() : "-",
    },
    {
      key: "External Id",
      getValue: (run: Run) => run.externalId || "-",
    },
    {
      key: "Notes",
      getValue: (run: Run) => run.notes || "-",
    },
  ];

  const numRunCols = selectedRuns.length;

  // Active search term (only apply if valid)
  const activeSearch = isInvalidRegex ? "" : searchValue;

  // Filter helper for key-value rows
  const keyMatchesSearch = useCallback(
    (key: string, getValues: () => unknown[]) => {
      if (!activeSearch) return true;
      return rowMatchesSearch(key, getValues(), activeSearch, isRegexMode);
    },
    [activeSearch, isRegexMode],
  );

  // Shared filter+precompute helper: filters keys by search & diff, pre-computes values and highlights.
  // Addresses both code duplication and redundant value computation across filter and render phases.
  const filterKeyedSection = useCallback(
    <T,>(
      keys: T[],
      getKey: (item: T) => string,
      getValues: (item: T) => string[],
      getRawValues?: (item: T) => unknown[],
    ): { item: T; values: string[]; highlights: (string | undefined)[] }[] => {
      const diffEnabled = showOnlyDiffs && selectedRuns.length >= 2;
      return keys.reduce<{ item: T; values: string[]; highlights: (string | undefined)[] }[]>((acc, item) => {
        const key = getKey(item);
        const values = getValues(item);
        const rawValues = getRawValues ? getRawValues(item) : values;
        if (!keyMatchesSearch(key, () => rawValues)) return acc;
        if (diffEnabled && !hasRowDiff(values)) return acc;
        const highlights = diffEnabled ? getDiffHighlights(values, clampedRefIndex) : values.map(() => undefined);
        acc.push({ item, values, highlights });
        return acc;
      }, []);
    },
    [keyMatchesSearch, showOnlyDiffs, selectedRuns.length, clampedRefIndex],
  );

  // Filter pluto metadata rows (pre-compute values + highlights)
  const filteredPlutoRows = useMemo(
    () =>
      filterKeyedSection(
        plutoMetadataRows,
        (row) => row.key,
        (row) => selectedRuns.map(({ run }) => row.getValue(run)),
      ),
    [plutoMetadataRows, filterKeyedSection, selectedRuns],
  );

  // Check if Tags row matches + pre-compute highlights
  const tagsRow = useMemo(() => {
    if (!rowMatchesSearch(
      "Tags",
      selectedRuns.flatMap(({ run }) => run.tags || []),
      activeSearch || "",
      isRegexMode,
    )) return null;
    const tagStrings = selectedRuns.map(({ run }) => ((run.tags as string[]) || []).sort().join(","));
    const diffEnabled = showOnlyDiffs && selectedRuns.length >= 2;
    if (diffEnabled && !hasRowDiff(tagStrings)) return null;
    const highlights = diffEnabled ? getDiffHighlights(tagStrings, clampedRefIndex) : tagStrings.map(() => undefined);
    return { highlights };
  }, [activeSearch, isRegexMode, selectedRuns, showOnlyDiffs, clampedRefIndex]);

  // Filter keyed sections (pre-compute values + highlights for each)
  const filteredImportRows = useMemo(
    () =>
      filterKeyedSection(
        importKeys,
        (key) => key,
        (key) => selectedRuns.map(({ run }) => formatValue(runImportData[run.id]?.[key])),
        (key) => selectedRuns.map(({ run }) => runImportData[run.id]?.[key]),
      ),
    [importKeys, filterKeyedSection, selectedRuns, runImportData],
  );

  const filteredSysMetaRows = useMemo(
    () =>
      filterKeyedSection(
        allSysMetaKeys,
        (key) => key,
        (key) => selectedRuns.map(({ run }) => formatValue(runSysMeta[run.id]?.[key])),
        (key) => selectedRuns.map(({ run }) => runSysMeta[run.id]?.[key]),
      ),
    [allSysMetaKeys, filterKeyedSection, selectedRuns, runSysMeta],
  );

  const filteredConfigRows = useMemo(
    () =>
      filterKeyedSection(
        nonImportConfigKeys,
        (key) => key,
        (key) => selectedRuns.map(({ run }) => formatValue(runConfigs[run.id]?.[key])),
        (key) => selectedRuns.map(({ run }) => runConfigs[run.id]?.[key]),
      ),
    [nonImportConfigKeys, filterKeyedSection, selectedRuns, runConfigs],
  );

  // Filter metric names for search - match on metric name or aggregation labels
  const filteredMetricNames = useMemo(() => {
    if (!activeSearch) return allMetricNames;
    return allMetricNames.filter((name) => {
      // Match on metric name itself
      if (isRegexMode) {
        try {
          const re = new RegExp(activeSearch, "i");
          if (re.test(name)) return true;
          // Also match on aggregation labels
          if (METRIC_AGGS.some((agg) => re.test(agg))) return true;
        } catch {
          return true;
        }
      } else {
        const lower = activeSearch.toLowerCase();
        if (name.toLowerCase().includes(lower)) return true;
        if (METRIC_AGGS.some((agg) => agg.toLowerCase().includes(lower))) return true;
      }
      // Match on values
      const summaries = metricSummariesData?.summaries;
      if (summaries) {
        for (const { run } of selectedRuns) {
          const runSummaries = summaries[run.id];
          if (runSummaries) {
            for (const agg of METRIC_AGGS) {
              const val = runSummaries[`${name}|${agg}`];
              if (val != null) {
                const valStr = String(val);
                if (isRegexMode) {
                  try { if (new RegExp(activeSearch, "i").test(valStr)) return true; } catch {}
                } else {
                  if (valStr.toLowerCase().includes(activeSearch.toLowerCase())) return true;
                }
              }
            }
          }
        }
      }
      return false;
    });
  }, [allMetricNames, activeSearch, isRegexMode, metricSummariesData, selectedRuns]);

  if (selectedRuns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Select runs from the left panel to compare</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-border">
      {/* Search bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={toggleRegexMode}
              className={`shrink-0 h-8 w-8 ${isRegexMode ? "bg-accent" : ""}`}
              aria-label="Toggle regex mode"
            >
              {isRegexMode ? (
                <Text className="h-3.5 w-3.5" />
              ) : (
                <Code2 className="h-3.5 w-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{isRegexMode ? "Switch to normal search" : "Switch to regex search"}</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setShowOnlyDiffs((prev) => !prev)}
              className={`shrink-0 h-8 w-8 ${showOnlyDiffs ? "bg-accent" : ""}`}
              aria-label="Show only differences"
              disabled={selectedRuns.length < 2}
            >
              <GitCompareArrows className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{showOnlyDiffs ? "Show all rows" : "Show only differences"}</p>
          </TooltipContent>
        </Tooltip>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-2 left-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            placeholder={isRegexMode ? "Search (regex)..." : "Search..."}
            value={searchValue}
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
            className={`h-8 w-full pr-7 pl-7 text-xs ${isInvalidRegex ? "border-destructive" : ""}`}
          />
          {searchValue && (
            <button
              type="button"
              onClick={handleSearchClear}
              className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="text-sm" style={{ width: `max(100%, ${totalWidth}px)`, borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: getWidth(0), minWidth: MIN_COL_WIDTH }} />
            {selectedRuns.map((_, i) => (
              <col key={i} style={{ width: getWidth(i + 1), minWidth: MIN_COL_WIDTH }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-20">
            <tr className="border-b border-border bg-background">
              {/* Key column header - sticky left + top, highest z-index */}
              <th
                className="sticky left-0 z-30 relative bg-background px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                style={{ width: getWidth(0), minWidth: MIN_COL_WIDTH, borderRight: KEY_COL_BORDER }}
              >
                Key
                <div
                  onMouseDown={(e) => handleMouseDown(0, e)}
                  className="absolute top-0 right-0 h-full w-1 cursor-col-resize bg-transparent transition-colors hover:bg-primary/50"
                />
              </th>
              {/* Run column headers with eye toggle + reference selector */}
              {selectedRuns.map(({ run, color }, i) => {
                const isRef = showOnlyDiffs && i === clampedRefIndex;
                return (
                <th
                  key={run.id}
                  className={`relative border-r border-border bg-background px-3 py-2 text-left font-medium last:border-r-0 ${
                    showOnlyDiffs && !isRef ? "cursor-pointer" : ""
                  }`}
                  style={{
                    width: getWidth(i + 1),
                    ...(isRef ? { background: DIFF_REMOVED_BG } : {}),
                  }}
                  onClick={showOnlyDiffs && !isRef ? () => setReferenceRunIndex(i) : undefined}
                  title={showOnlyDiffs && !isRef ? "Click to set as reference" : undefined}
                >
                  <div className="flex items-center gap-2">
                    {onRemoveRun ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onRemoveRun(run.id); }}
                        className="group flex shrink-0 items-center justify-center rounded-sm p-0.5 transition-colors hover:bg-muted"
                        title="Remove from comparison"
                      >
                        <Eye
                          className="h-3.5 w-3.5 group-hover:hidden"
                          style={{ color }}
                        />
                        <EyeOff
                          className="hidden h-3.5 w-3.5 group-hover:block text-muted-foreground"
                        />
                      </button>
                    ) : (
                      <div
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                    )}
                    <span className="truncate text-xs" title={run.name}>
                      {run.name}
                    </span>
                    {isRef && (
                      <span className="shrink-0 rounded bg-destructive/20 px-1 py-0.5 text-[9px] font-bold uppercase leading-none text-destructive">
                        ref
                      </span>
                    )}
                  </div>
                  <div
                    onMouseDown={(e) => handleMouseDown(i + 1, e)}
                    className="absolute top-0 right-0 h-full w-1 cursor-col-resize bg-transparent transition-colors hover:bg-primary/50"
                  />
                </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {/* ===== PLUTO METADATA section ===== */}
            <SectionHeader
              numRunCols={numRunCols}
              label="Pluto Metadata"
              isCollapsed={!!collapsedSections["pluto"]}
              onToggle={() => toggleSection("pluto")}
            />
            {!collapsedSections["pluto"] && (
              <>
                {filteredPlutoRows.map(({ item: row, values, highlights }, idx) => (
                  <tr
                    key={row.key}
                    className={`border-b border-border/50 ${
                      idx % 2 === 0 ? "bg-background" : "bg-muted"
                    } hover:bg-accent/30 transition-colors`}
                  >
                    <td
                      style={{ borderRight: KEY_COL_BORDER }}
                      className={`sticky left-0 z-10 px-3 py-1.5 align-top ${
                        idx % 2 === 0 ? "bg-background" : "bg-muted"
                      }`}
                    >
                      <span className="text-xs font-medium text-muted-foreground">
                        {row.key}
                      </span>
                    </td>
                    {selectedRuns.map(({ run }, colIdx) => {
                      const value = values[colIdx];
                      const isEmpty = value === "-";
                      return (
                        <td
                          key={run.id}
                          className={`border-r border-border/50 px-3 py-1.5 align-top last:border-r-0 ${
                            isEmpty ? "text-muted-foreground/50" : "text-foreground"
                          }`}
                          style={highlights[colIdx] ? { background: highlights[colIdx] } : undefined}
                        >
                          <span className="break-all font-mono text-xs">
                            {value}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {/* Pluto Tags row */}
                {tagsRow && (
                <tr
                  className={`border-b border-border/50 ${
                    filteredPlutoRows.length % 2 === 0 ? "bg-background" : "bg-muted"
                  } hover:bg-accent/30 transition-colors`}
                >
                  <td
                    style={{ borderRight: KEY_COL_BORDER }}
                      className={`sticky left-0 z-10 px-3 py-1.5 align-top ${
                      filteredPlutoRows.length % 2 === 0 ? "bg-background" : "bg-muted"
                    }`}
                  >
                    <span className="text-xs font-medium text-muted-foreground">
                      Tags
                    </span>
                  </td>
                  {selectedRuns.map(({ run }, colIdx) => {
                    const tags: string[] = (run.tags as string[]) || [];
                    return (
                      <td
                        key={run.id}
                        className="border-r border-border/50 px-3 py-1.5 align-top last:border-r-0"
                        style={tagsRow.highlights[colIdx] ? { background: tagsRow.highlights[colIdx] } : undefined}
                      >
                        {tags.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1">
                            {tags.map((tag) => (
                              <Badge
                                key={tag}
                                variant="secondary"
                                className="text-xs"
                              >
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">-</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
                )}
              </>
            )}

            {/* ===== IMPORTED METADATA section (Neptune sys/* keys from config) ===== */}
            {hasAnyImportData && filteredImportRows.length > 0 && (
              <>
                <SectionHeader
                  numRunCols={numRunCols}
                  label="Imported Metadata"
                  isCollapsed={!!collapsedSections["import"]}
                  onToggle={() => toggleSection("import")}
                />
                {!collapsedSections["import"] &&
                  filteredImportRows.map(({ item: key, values, highlights }, idx) => (
                    <tr
                      key={`imp-${key}`}
                      className={`border-b border-border/50 ${
                        idx % 2 === 0 ? "bg-background" : "bg-muted"
                      } hover:bg-accent/30 transition-colors`}
                    >
                      <td
                        style={{ borderRight: KEY_COL_BORDER }}
                      className={`sticky left-0 z-10 px-3 py-1.5 align-top ${
                          idx % 2 === 0 ? "bg-background" : "bg-muted"
                        }`}
                      >
                        <span className="break-all font-mono text-xs text-muted-foreground">
                          {key}
                        </span>
                      </td>
                      {selectedRuns.map(({ run }, colIdx) => {
                        const displayValue = values[colIdx];
                        const isEmpty = displayValue === "-";
                        return (
                          <td
                            key={run.id}
                            className={`border-r border-border/50 px-3 py-1.5 align-top last:border-r-0 ${
                              isEmpty ? "text-muted-foreground/50" : "text-foreground"
                            }`}
                            style={highlights[colIdx] ? { background: highlights[colIdx] } : undefined}
                          >
                            <CollapsibleCell value={displayValue} isEmpty={isEmpty} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </>
            )}

            {/* ===== SYSTEM METADATA section ===== */}
            {filteredSysMetaRows.length > 0 && (
              <>
                <SectionHeader
                  numRunCols={numRunCols}
                  label="System Metadata"
                  isCollapsed={!!collapsedSections["sysmeta"]}
                  onToggle={() => toggleSection("sysmeta")}
                />
                {!collapsedSections["sysmeta"] &&
                  filteredSysMetaRows.map(({ item: key, values, highlights }, idx) => (
                    <tr
                      key={`sys-${key}`}
                      className={`border-b border-border/50 ${
                        idx % 2 === 0 ? "bg-background" : "bg-muted"
                      } hover:bg-accent/30 transition-colors`}
                    >
                      <td
                        style={{ borderRight: KEY_COL_BORDER }}
                      className={`sticky left-0 z-10 px-3 py-1.5 align-top ${
                          idx % 2 === 0 ? "bg-background" : "bg-muted"
                        }`}
                      >
                        <span className="break-all font-mono text-xs text-muted-foreground">
                          {key}
                        </span>
                      </td>
                      {selectedRuns.map(({ run }, colIdx) => {
                        const displayValue = values[colIdx];
                        const isEmpty = displayValue === "-";
                        return (
                          <td
                            key={run.id}
                            className={`border-r border-border/50 px-3 py-1.5 align-top last:border-r-0 ${
                              isEmpty ? "text-muted-foreground/50" : "text-foreground"
                            }`}
                            style={highlights[colIdx] ? { background: highlights[colIdx] } : undefined}
                          >
                            <CollapsibleCell value={displayValue} isEmpty={isEmpty} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </>
            )}

            {/* ===== CONFIG section (non-import keys only) ===== */}
            {filteredConfigRows.length > 0 && (
              <>
                <SectionHeader
                  numRunCols={numRunCols}
                  label="Config"
                  isCollapsed={!!collapsedSections["config"]}
                  onToggle={() => toggleSection("config")}
                />
                {!collapsedSections["config"] &&
                  filteredConfigRows.map(({ item: key, values, highlights }, idx) => (
                    <tr
                      key={`cfg-${key}`}
                      className={`border-b border-border/50 ${
                        idx % 2 === 0 ? "bg-background" : "bg-muted"
                      } hover:bg-accent/30 transition-colors`}
                    >
                      <td
                        style={{ borderRight: KEY_COL_BORDER }}
                      className={`sticky left-0 z-10 px-3 py-1.5 align-top ${
                          idx % 2 === 0 ? "bg-background" : "bg-muted"
                        }`}
                      >
                        <span className="break-all font-mono text-xs text-muted-foreground">
                          {key}
                        </span>
                      </td>
                      {selectedRuns.map(({ run }, colIdx) => {
                        const displayValue = values[colIdx];
                        const isEmpty = displayValue === "-";
                        return (
                          <td
                            key={run.id}
                            className={`border-r border-border/50 px-3 py-1.5 align-top last:border-r-0 ${
                              isEmpty ? "text-muted-foreground/50" : "text-foreground"
                            }`}
                            style={highlights[colIdx] ? { background: highlights[colIdx] } : undefined}
                          >
                            <CollapsibleCell value={displayValue} isEmpty={isEmpty} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </>
            )}

            {/* ===== METRIC SUMMARIES section ===== */}
            {filteredMetricNames.length > 0 && (
              <>
                <SectionHeader
                  numRunCols={numRunCols}
                  label="Metric Summaries"
                  isCollapsed={!!collapsedSections["metrics"]}
                  onToggle={() => toggleSection("metrics")}
                />
                {!collapsedSections["metrics"] &&
                  filteredMetricNames.map((metricName) => {
                    const isExpanded = !!expandedMetrics[metricName];
                    return (
                      <MetricSubGroup
                        key={`metric-${metricName}`}
                        metricName={metricName}
                        isExpanded={isExpanded}
                        onToggle={() => toggleMetric(metricName)}
                        selectedRuns={selectedRuns}
                        summaries={metricSummariesData?.summaries}
                        numRunCols={numRunCols}
                        showOnlyDiffs={showOnlyDiffs}
                        referenceRunIndex={clampedRefIndex}
                      />
                    );
                  })}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
