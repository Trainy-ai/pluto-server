import { useMemo } from "react";
import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import { globToRegex } from "./glob-utils";
import { fuzzyFilter } from "@/lib/fuzzy-search";
import type {
  Widget,
  ChartWidgetConfig,
  FileGroupWidgetConfig,
} from "../../~types/dashboard-types";
import { SYNTHETIC_CONSOLE_ENTRIES } from "./console-log-constants";

const MAX_DYNAMIC_WIDGETS = 100;

/**
 * Hook that resolves a dynamic section pattern into virtual Widget[].
 *
 * Replicates the two-stage search from SearchMetricPanel / SearchFilePanel
 * (PRs #174 and #199) adapted for dynamic sections:
 *
 * - "search" mode (two-stage):
 *   1. Source 1: all metrics/files for selected runs (no search filter)
 *   2. Source 2: backend fuzzy search with stripped glob chars + runIds
 *   3. Merge both sources (deduplicated union)
 *   4. Client-side: glob → globToRegex() filter, plain text → fuzzyFilter() (Fuse.js)
 *
 * - "regex" mode:
 *   1. Send pattern to backend with regex param + runIds
 *   2. Backend uses ClickHouse match() / PostgreSQL ~ operator
 *
 * Differences from single-widget search:
 * - Only searches selected runs (not all project metrics)
 * - Combines both metrics AND files in one list
 * - Limited to 100 widgets
 *
 * Virtual widgets are NOT persisted; they're regenerated each render based on
 * the pattern, mode, and current selected runs.
 */
export function useDynamicSectionWidgets(
  sectionId: string,
  dynamicPattern: string | undefined,
  patternMode: "search" | "regex",
  organizationId: string,
  projectName: string,
  selectedRunIds: string[],
): { dynamicWidgets: Widget[]; isLoading: boolean } {
  const hasPattern = !!dynamicPattern?.trim();
  const trimmed = dynamicPattern?.trim() ?? "";
  const hasRuns = selectedRunIds.length > 0;

  // Glob detection (search mode only)
  const isGlob =
    patternMode === "search" &&
    (trimmed.includes("*") || trimmed.includes("?"));

  // Strip glob chars before sending to backend (backend doesn't understand globs)
  const backendSearch = isGlob ? trimmed.replace(/[*?]/g, "") : trimmed;

  // --- Source 1 (search mode): all metrics/files for selected runs ---
  const initialMetrics = useQuery(
    trpc.runs.distinctMetricNames.queryOptions(
      { organizationId, projectName, runIds: selectedRunIds },
      {
        enabled: hasPattern && hasRuns && patternMode === "search",
        staleTime: 60_000,
      },
    ),
  );

  const initialFiles = useQuery(
    trpc.runs.distinctFileLogNames.queryOptions(
      { organizationId, projectName, runIds: selectedRunIds },
      {
        enabled: hasPattern && hasRuns && patternMode === "search",
        staleTime: 60_000,
      },
    ),
  );

  // --- Source 2 (search mode): server-side fuzzy search within selected runs ---
  const searchMetrics = useQuery(
    trpc.runs.distinctMetricNames.queryOptions(
      { organizationId, projectName, runIds: selectedRunIds, search: backendSearch },
      {
        enabled:
          hasPattern && hasRuns && patternMode === "search" && backendSearch.length > 0,
        staleTime: 60_000,
        placeholderData: (prev) => prev,
      },
    ),
  );

  const searchFiles = useQuery(
    trpc.runs.distinctFileLogNames.queryOptions(
      { organizationId, projectName, runIds: selectedRunIds, search: backendSearch },
      {
        enabled:
          hasPattern && hasRuns && patternMode === "search" && backendSearch.length > 0,
        staleTime: 60_000,
        placeholderData: (prev) => prev,
      },
    ),
  );

  // --- Regex mode: server-side regex within selected runs ---
  const regexMetrics = useQuery(
    trpc.runs.distinctMetricNames.queryOptions(
      { organizationId, projectName, runIds: selectedRunIds, regex: trimmed },
      {
        enabled: hasPattern && hasRuns && patternMode === "regex",
        staleTime: 60_000,
        placeholderData: (prev) => prev,
      },
    ),
  );

  const regexFiles = useQuery(
    trpc.runs.distinctFileLogNames.queryOptions(
      { organizationId, projectName, runIds: selectedRunIds, regex: trimmed },
      {
        enabled: hasPattern && hasRuns && patternMode === "regex",
        staleTime: 60_000,
        placeholderData: (prev) => prev,
      },
    ),
  );

  const dynamicWidgets = useMemo(() => {
    if (!hasPattern) return [];

    let filteredMetrics: string[];
    let filteredFiles: { logName: string; logType: string }[];

    if (patternMode === "regex") {
      // Regex: backend handles filtering, use results directly
      filteredMetrics = regexMetrics.data?.metricNames ?? [];
      const backendRegexFiles = regexFiles.data?.files ?? [];
      // Test synthetic entries against regex client-side
      let syntheticMatches: { logName: string; logType: string }[] = [];
      if (trimmed) {
        try {
          const re = new RegExp(trimmed);
          syntheticMatches = SYNTHETIC_CONSOLE_ENTRIES.filter((e) => re.test(e.logName));
        } catch { /* invalid regex — skip */ }
      }
      filteredFiles = [...syntheticMatches, ...backendRegexFiles];
    } else {
      // Search: merge initial + search results, then client-side filter
      const initM = initialMetrics.data?.metricNames ?? [];
      const searchM = searchMetrics.data?.metricNames ?? [];
      const mergedMetrics = Array.from(new Set([...searchM, ...initM]));

      const initF = initialFiles.data?.files ?? [];
      const searchF = searchFiles.data?.files ?? [];
      // Deduplicate files by logName, preferring search results (+ synthetic console entries)
      const fileMap = new Map<string, { logName: string; logType: string }>();
      for (const e of SYNTHETIC_CONSOLE_ENTRIES) fileMap.set(e.logName, e);
      for (const f of initF) fileMap.set(f.logName, f);
      for (const f of searchF) fileMap.set(f.logName, f);
      const mergedFileNames = Array.from(fileMap.keys());

      if (!trimmed) {
        filteredMetrics = mergedMetrics.sort((a, b) => a.localeCompare(b));
        filteredFiles = mergedFileNames
          .sort((a, b) => a.localeCompare(b))
          .map((n) => fileMap.get(n)!);
      } else if (isGlob) {
        try {
          const regex = globToRegex(trimmed);
          filteredMetrics = mergedMetrics
            .filter((m) => regex.test(m))
            .sort((a, b) => a.localeCompare(b));
          filteredFiles = mergedFileNames
            .filter((n) => regex.test(n))
            .sort((a, b) => a.localeCompare(b))
            .map((n) => fileMap.get(n)!);
        } catch {
          return [];
        }
      } else {
        // Fuse.js fuzzy filter (same as SearchMetricPanel / SearchFilePanel)
        filteredMetrics = fuzzyFilter(mergedMetrics, trimmed);
        const fuzzyFileNames = fuzzyFilter(mergedFileNames, trimmed);
        filteredFiles = fuzzyFileNames.map((n) => fileMap.get(n)!);
      }
    }

    // Generate widgets
    const widgets: Widget[] = [];

    for (const logName of filteredMetrics) {
      const config: ChartWidgetConfig = {
        metrics: [logName],
        xAxis: "step",
        yAxisScale: "linear",
        xAxisScale: "linear",
        aggregation: "LAST",
        showOriginal: false,
      };
      widgets.push({
        id: `dyn-${sectionId}-metric-${logName}`,
        type: "chart",
        config,
        layout: { x: 0, y: 0, w: 6, h: 4 },
      });
    }

    for (const file of filteredFiles) {
      const config: FileGroupWidgetConfig = {
        files: [file.logName],
      };
      widgets.push({
        id: `dyn-${sectionId}-file-${file.logName}`,
        type: "file-group",
        config,
        layout: { x: 0, y: 0, w: 6, h: 4 },
      });
    }

    widgets.sort((a, b) => a.id.localeCompare(b.id));
    return widgets.slice(0, MAX_DYNAMIC_WIDGETS);
  }, [
    hasPattern, trimmed, isGlob, patternMode, sectionId,
    initialMetrics.data, initialFiles.data,
    searchMetrics.data, searchFiles.data,
    regexMetrics.data, regexFiles.data,
  ]);

  const isLoading =
    hasPattern &&
    hasRuns &&
    ((patternMode === "search" &&
      (initialMetrics.isLoading ||
        initialFiles.isLoading ||
        searchMetrics.isLoading ||
        searchFiles.isLoading)) ||
      (patternMode === "regex" &&
        (regexMetrics.isLoading || regexFiles.isLoading)));

  return { dynamicWidgets, isLoading };
}
