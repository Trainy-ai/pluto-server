import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import type { Run } from "../../~queries/list-runs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronDown, ChevronRight, Eye, EyeOff, Search, X, Code2, Text } from "lucide-react";

interface SideBySideViewProps {
  selectedRunsWithColors: Record<string, { run: Run; color: string }>;
  onRemoveRun?: (runId: string) => void;
}

// Helper to flatten nested objects into dot-notation keys
function flattenObject(obj: unknown, prefix = ""): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (obj === null || obj === undefined) {
    return result;
  }

  if (typeof obj !== "object" || Array.isArray(obj)) {
    if (prefix) {
      result[prefix] = obj;
    }
    return result;
  }

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, newKey));
    } else {
      result[newKey] = value;
    }
  }

  return result;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return value.toLocaleString();
    }
    return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

const DEFAULT_COL_WIDTH = 200;
const MIN_COL_WIDTH = 120;

// Sticky key column divider style: border-right on each sticky cell.
// We use border-separate on the table so each cell owns its borders independently,
// preventing scrolled content from covering the sticky cell's border.
const KEY_COL_BORDER = "2px solid hsl(var(--border))";

// Prefixes that identify imported (e.g. Neptune) metadata keys within the config object.
const IMPORTED_KEY_PREFIXES = ["sys/", "source_code/"];

const COLLAPSED_MAX_HEIGHT = 60; // px - roughly 3 lines of monospace text

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

export function SideBySideView({ selectedRunsWithColors, onRemoveRun }: SideBySideViewProps) {
  const selectedRuns = Object.values(selectedRunsWithColors);

  // Search state
  const [searchValue, setSearchValue] = useState("");
  const [isRegexMode, setIsRegexMode] = useState(false);
  const [isInvalidRegex, setIsInvalidRegex] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
      const flatConfig = flattenObject(run.config);
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

      const flatSysMeta = flattenObject(run.systemMetadata);
      sysMeta[run.id] = flatSysMeta;
      for (const key of Object.keys(flatSysMeta)) {
        sysMetaKeySet.add(key);
      }
    }

    // Priority ordering for import keys: sys/ fields first in a specific order, then others
    const importKeyPriority = [
      "sys/name",
      "sys/id",
      "sys/creation_time",
      "sys/custom_run_id",
      "sys/owner",
      "sys/tags",
      "sys/modification_time",
      "sys/ping_time",
      "sys/family",
      "sys/description",
      "sys/failed",
      "sys/state",
      "sys/size",
      "sys/archived",
      "sys/trashed",
      "sys/group_tags",
    ];
    const sortedImportKeys = Array.from(importKeySet).sort((a, b) => {
      const aIdx = importKeyPriority.indexOf(a);
      const bIdx = importKeyPriority.indexOf(b);
      const aSys = a.startsWith("sys/");
      const bSys = b.startsWith("sys/");
      // Both in priority list
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      // Only one in priority list
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
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
    // Fallback to git info from systemMetadata
    if (run.systemMetadata && typeof run.systemMetadata === "object") {
      const flat = flattenObject(run.systemMetadata);
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

  // Filter pluto metadata rows
  const filteredPlutoRows = useMemo(
    () =>
      plutoMetadataRows.filter((row) =>
        keyMatchesSearch(row.key, () => selectedRuns.map(({ run }) => row.getValue(run))),
      ),
    [plutoMetadataRows, keyMatchesSearch, selectedRuns],
  );

  // Check if Tags row matches
  const tagsRowVisible = useMemo(() => {
    if (!activeSearch) return true;
    return rowMatchesSearch(
      "Tags",
      selectedRuns.flatMap(({ run }) => run.tags || []),
      activeSearch,
      isRegexMode,
    );
  }, [activeSearch, isRegexMode, selectedRuns]);

  // Filter keyed sections
  const filteredImportKeys = useMemo(
    () =>
      importKeys.filter((key) =>
        keyMatchesSearch(key, () => selectedRuns.map(({ run }) => runImportData[run.id]?.[key])),
      ),
    [importKeys, keyMatchesSearch, selectedRuns, runImportData],
  );

  const filteredSysMetaKeys = useMemo(
    () =>
      allSysMetaKeys.filter((key) =>
        keyMatchesSearch(key, () => selectedRuns.map(({ run }) => runSysMeta[run.id]?.[key])),
      ),
    [allSysMetaKeys, keyMatchesSearch, selectedRuns, runSysMeta],
  );

  const filteredConfigKeys = useMemo(
    () =>
      nonImportConfigKeys.filter((key) =>
        keyMatchesSearch(key, () => selectedRuns.map(({ run }) => runConfigs[run.id]?.[key])),
      ),
    [nonImportConfigKeys, keyMatchesSearch, selectedRuns, runConfigs],
  );

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
              {/* Run column headers with eye toggle */}
              {selectedRuns.map(({ run, color }, i) => (
                <th
                  key={run.id}
                  className="relative border-r border-border bg-background px-3 py-2 text-left font-medium last:border-r-0"
                  style={{ width: getWidth(i + 1) }}
                >
                  <div className="flex items-center gap-2">
                    {onRemoveRun ? (
                      <button
                        type="button"
                        onClick={() => onRemoveRun(run.id)}
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
                  </div>
                  <div
                    onMouseDown={(e) => handleMouseDown(i + 1, e)}
                    className="absolute top-0 right-0 h-full w-1 cursor-col-resize bg-transparent transition-colors hover:bg-primary/50"
                  />
                </th>
              ))}
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
                {filteredPlutoRows.map((row, idx) => (
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
                    {selectedRuns.map(({ run }) => {
                      const value = row.getValue(run);
                      const isEmpty = value === "-";
                      return (
                        <td
                          key={run.id}
                          className={`border-r border-border/50 px-3 py-1.5 align-top last:border-r-0 ${
                            isEmpty ? "text-muted-foreground/50" : "text-foreground"
                          }`}
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
                {tagsRowVisible && (
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
                  {selectedRuns.map(({ run }) => {
                    const tags = run.tags || [];
                    return (
                      <td
                        key={run.id}
                        className="border-r border-border/50 px-3 py-1.5 align-top last:border-r-0"
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
            {hasAnyImportData && filteredImportKeys.length > 0 && (
              <>
                <SectionHeader
                  numRunCols={numRunCols}
                  label="Imported Metadata"
                  isCollapsed={!!collapsedSections["import"]}
                  onToggle={() => toggleSection("import")}
                />
                {!collapsedSections["import"] &&
                  filteredImportKeys.map((key, idx) => (
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
                      {selectedRuns.map(({ run }) => {
                        const value = runImportData[run.id]?.[key];
                        const displayValue = formatValue(value);
                        const isEmpty = value === null || value === undefined;
                        return (
                          <td
                            key={run.id}
                            className={`border-r border-border/50 px-3 py-1.5 align-top last:border-r-0 ${
                              isEmpty ? "text-muted-foreground/50" : "text-foreground"
                            }`}
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
            {filteredSysMetaKeys.length > 0 && (
              <>
                <SectionHeader
                  numRunCols={numRunCols}
                  label="System Metadata"
                  isCollapsed={!!collapsedSections["sysmeta"]}
                  onToggle={() => toggleSection("sysmeta")}
                />
                {!collapsedSections["sysmeta"] &&
                  filteredSysMetaKeys.map((key, idx) => (
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
                      {selectedRuns.map(({ run }) => {
                        const value = runSysMeta[run.id]?.[key];
                        const displayValue = formatValue(value);
                        const isEmpty = value === null || value === undefined;
                        return (
                          <td
                            key={run.id}
                            className={`border-r border-border/50 px-3 py-1.5 align-top last:border-r-0 ${
                              isEmpty ? "text-muted-foreground/50" : "text-foreground"
                            }`}
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
            {filteredConfigKeys.length > 0 && (
              <>
                <SectionHeader
                  numRunCols={numRunCols}
                  label="Config"
                  isCollapsed={!!collapsedSections["config"]}
                  onToggle={() => toggleSection("config")}
                />
                {!collapsedSections["config"] &&
                  filteredConfigKeys.map((key, idx) => (
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
                      {selectedRuns.map(({ run }) => {
                        const value = runConfigs[run.id]?.[key];
                        const displayValue = formatValue(value);
                        const isEmpty = value === null || value === undefined;
                        return (
                          <td
                            key={run.id}
                            className={`border-r border-border/50 px-3 py-1.5 align-top last:border-r-0 ${
                              isEmpty ? "text-muted-foreground/50" : "text-foreground"
                            }`}
                          >
                            <CollapsibleCell value={displayValue} isEmpty={isEmpty} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
