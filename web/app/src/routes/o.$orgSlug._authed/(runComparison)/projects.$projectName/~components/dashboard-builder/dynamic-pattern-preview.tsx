import { useState, useEffect, useMemo } from "react";
import {
  BarChart3Icon,
  ImageIcon,
  VideoIcon,
  MusicIcon,
  FileTextIcon,
  LineChartIcon,
  Loader2Icon,
  TerminalIcon,
} from "lucide-react";
import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import { globToRegex } from "./glob-utils";
import { fuzzyFilter } from "@/lib/fuzzy-search";
import { SYNTHETIC_CONSOLE_ENTRIES } from "./console-log-constants";

const MAX_PREVIEW = 100;

interface DynamicPatternPreviewProps {
  pattern: string;
  mode: "search" | "regex";
  organizationId: string;
  projectName: string;
  selectedRunIds: string[];
}

interface MatchedItem {
  name: string;
  type: "metric" | "file";
  logType?: string;
}

/**
 * Live preview of dynamic section pattern matches.
 *
 * Replicates the two-stage search from SearchMetricPanel / SearchFilePanel
 * (PRs #174 and #199) with 300ms debouncing for the backend queries.
 */
export function DynamicPatternPreview({
  pattern,
  mode,
  organizationId,
  projectName,
  selectedRunIds,
}: DynamicPatternPreviewProps) {
  const hasPattern = !!pattern.trim();
  const trimmed = pattern.trim();
  const hasRuns = selectedRunIds.length > 0;

  // Glob detection (search mode only)
  const isGlob =
    mode === "search" && (trimmed.includes("*") || trimmed.includes("?"));

  // Debounced search term (300ms) — same as SearchMetricPanel / SearchFilePanel
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(isGlob ? trimmed.replace(/[*?]/g, "") : trimmed);
    }, 300);
    return () => clearTimeout(timer);
  }, [trimmed, isGlob]);

  // Debounced regex (300ms) — same as RegexSearchMetricPanel
  const [debouncedRegex, setDebouncedRegex] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedRegex(trimmed);
    }, 300);
    return () => clearTimeout(timer);
  }, [trimmed]);

  // --- Source 1 (search mode): all metrics/files for selected runs ---
  const initialMetrics = useQuery(
    trpc.runs.distinctMetricNames.queryOptions(
      { organizationId, projectName, runIds: selectedRunIds },
      {
        enabled: hasPattern && hasRuns && mode === "search",
        staleTime: 60_000,
      },
    ),
  );

  const initialFiles = useQuery(
    trpc.runs.distinctFileLogNames.queryOptions(
      { organizationId, projectName, runIds: selectedRunIds },
      {
        enabled: hasPattern && hasRuns && mode === "search",
        staleTime: 60_000,
      },
    ),
  );

  // --- Source 2 (search mode): debounced server-side fuzzy search ---
  const searchMetrics = useQuery(
    trpc.runs.distinctMetricNames.queryOptions(
      { organizationId, projectName, runIds: selectedRunIds, search: debouncedSearch },
      {
        enabled:
          hasPattern && hasRuns && mode === "search" && debouncedSearch.length > 0,
        staleTime: 60_000,
        placeholderData: (prev) => prev,
      },
    ),
  );

  const searchFiles = useQuery(
    trpc.runs.distinctFileLogNames.queryOptions(
      { organizationId, projectName, runIds: selectedRunIds, search: debouncedSearch },
      {
        enabled:
          hasPattern && hasRuns && mode === "search" && debouncedSearch.length > 0,
        staleTime: 60_000,
        placeholderData: (prev) => prev,
      },
    ),
  );

  // --- Regex mode: debounced server-side regex within selected runs ---
  const regexMetrics = useQuery(
    trpc.runs.distinctMetricNames.queryOptions(
      { organizationId, projectName, runIds: selectedRunIds, regex: debouncedRegex },
      {
        enabled: hasPattern && hasRuns && mode === "regex" && debouncedRegex.length > 0,
        staleTime: 60_000,
        placeholderData: (prev) => prev,
      },
    ),
  );

  const regexFiles = useQuery(
    trpc.runs.distinctFileLogNames.queryOptions(
      { organizationId, projectName, runIds: selectedRunIds, regex: debouncedRegex },
      {
        enabled: hasPattern && hasRuns && mode === "regex" && debouncedRegex.length > 0,
        staleTime: 60_000,
        placeholderData: (prev) => prev,
      },
    ),
  );

  const isLoading =
    hasPattern &&
    hasRuns &&
    ((mode === "search" &&
      (initialMetrics.isLoading ||
        initialFiles.isLoading ||
        searchMetrics.isFetching ||
        searchFiles.isFetching)) ||
      (mode === "regex" &&
        (regexMetrics.isFetching || regexFiles.isFetching)));

  const matched = useMemo<MatchedItem[]>(() => {
    if (!hasPattern) return [];

    let filteredMetricNames: string[];
    let filteredFileItems: { logName: string; logType: string }[];

    if (mode === "regex") {
      // Regex: backend handles filtering, use results directly
      filteredMetricNames = regexMetrics.data?.metricNames ?? [];
      filteredFileItems = regexFiles.data?.files ?? [];
      // Test synthetic entries against the regex client-side
      try {
        const re = new RegExp(trimmed);
        const syntheticMatches = SYNTHETIC_CONSOLE_ENTRIES.filter((e) => re.test(e.logName));
        filteredFileItems = [...syntheticMatches, ...filteredFileItems];
      } catch {
        // invalid regex — skip synthetic injection
      }
    } else {
      // Search: merge initial + search results, then client-side filter
      const initM = initialMetrics.data?.metricNames ?? [];
      const searchM = searchMetrics.data?.metricNames ?? [];
      const mergedMetrics = Array.from(new Set([...searchM, ...initM]));

      const initF = initialFiles.data?.files ?? [];
      const searchF = searchFiles.data?.files ?? [];
      const fileMap = new Map<string, { logName: string; logType: string }>();
      for (const e of SYNTHETIC_CONSOLE_ENTRIES) fileMap.set(e.logName, e);
      for (const f of initF) fileMap.set(f.logName, f);
      for (const f of searchF) fileMap.set(f.logName, f);
      const mergedFileNames = Array.from(fileMap.keys());

      if (isGlob) {
        try {
          const regex = globToRegex(trimmed);
          filteredMetricNames = mergedMetrics
            .filter((m) => regex.test(m))
            .sort((a, b) => a.localeCompare(b));
          filteredFileItems = mergedFileNames
            .filter((n) => regex.test(n))
            .sort((a, b) => a.localeCompare(b))
            .map((n) => fileMap.get(n)!);
        } catch {
          return [];
        }
      } else {
        // Fuse.js fuzzy filter (same as SearchMetricPanel / SearchFilePanel)
        filteredMetricNames = fuzzyFilter(mergedMetrics, trimmed);
        const fuzzyFileNames = fuzzyFilter(mergedFileNames, trimmed);
        filteredFileItems = fuzzyFileNames.map((n) => fileMap.get(n)!);
      }
    }

    const items: MatchedItem[] = [
      ...filteredMetricNames.map((name) => ({ name, type: "metric" as const })),
      ...filteredFileItems.map((f) => ({
        name: f.logName,
        type: "file" as const,
        logType: f.logType,
      })),
    ];

    items.sort((a, b) => a.name.localeCompare(b.name));
    return items;
  }, [
    hasPattern, trimmed, isGlob, mode,
    initialMetrics.data, initialFiles.data,
    searchMetrics.data, searchFiles.data,
    regexMetrics.data, regexFiles.data,
  ]);

  if (!hasPattern) return null;

  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          {isLoading
            ? "Searching..."
            : matched.length > MAX_PREVIEW
              ? `${MAX_PREVIEW}+ matches`
              : `${matched.length} match${matched.length !== 1 ? "es" : ""}`}
        </span>
      </div>
      <div className="h-[200px] overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Searching...
          </div>
        ) : matched.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted-foreground">
            No metrics or files match this pattern
          </div>
        ) : (
          matched.slice(0, MAX_PREVIEW).map((item) => (
            <div
              key={`${item.type}-${item.name}`}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm"
            >
              <ItemTypeIcon type={item.type} logType={item.logType} />
              <span className="truncate">{item.name}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ItemTypeIcon({ type, logType }: { type: "metric" | "file"; logType?: string }) {
  const className = "size-3.5 shrink-0 text-muted-foreground";
  if (type === "metric") {
    return <LineChartIcon className={className} />;
  }
  switch (logType) {
    case "HISTOGRAM": return <BarChart3Icon className={className} />;
    case "IMAGE": return <ImageIcon className={className} />;
    case "VIDEO": return <VideoIcon className={className} />;
    case "AUDIO": return <MusicIcon className={className} />;
    case "CONSOLE_STDOUT":
    case "CONSOLE_STDERR": return <TerminalIcon className={className} />;
    default: return <FileTextIcon className={className} />;
  }
}
