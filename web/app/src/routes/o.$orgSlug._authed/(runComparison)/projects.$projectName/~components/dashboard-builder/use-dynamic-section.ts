import { useMemo } from "react";
import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import { globToRegex } from "./glob-utils";
import { fuzzyFilter } from "@/lib/fuzzy-search";
import { isValidRe2Regex } from "../../~lib/validate-re2-regex";
import type {
  Widget,
  ChartWidgetConfig,
  FileGroupWidgetConfig,
  DistributionsWidgetConfig,
} from "../../~types/dashboard-types";
import { SYNTHETIC_CONSOLE_ENTRIES } from "./console-log-constants";
import { useLineSettings } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/use-line-settings";
import { bucketMetricsByPrefix, splitMetricPath } from "./bucket-metrics";
import {
  decodeBarsEntry,
  encodeBarsEntry,
  isBarsEntry,
} from "./bars-entry-encoding";
import { useEligiblePrefixesForRuns } from "../../~queries/file-log-names";

const MAX_DYNAMIC_WIDGETS = 100;

// Re-export pure grouping helpers so the existing import surface stays stable.
// Unit tests should import from `./bucket-metrics` directly to avoid tRPC.
export { splitMetricPath, bucketMetricsByPrefix };

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
  groupBy: string[] | undefined,
  groupPrefixes: string[] | undefined,
  groupPrefixRegex: string | undefined,
): { dynamicWidgets: Widget[]; isLoading: boolean } {
  const hasPattern = !!dynamicPattern?.trim();
  const trimmed = dynamicPattern?.trim() ?? "";
  const hasRuns = selectedRunIds.length > 0;

  // Glob detection (search mode only)
  const isGlob =
    patternMode === "search" &&
    (trimmed.includes("*") || trimmed.includes("?"));

  // Validate regex for re2 compatibility before sending to ClickHouse
  const isRe2Valid = patternMode === "regex" && trimmed ? isValidRe2Regex(trimmed) : true;

  // Strip glob chars before sending to backend (backend doesn't understand globs)
  const backendSearch = isGlob ? trimmed.replace(/[*?]/g, "") : trimmed;

  // Respect the "Include NaN/Inf-only metrics" toggle from line settings.
  // When ON, pattern resolution falls back to the raw mlop_metrics table so
  // all-NaN/Inf metrics still match the pattern (e.g. "train/*" matches a
  // metric whose values are entirely NaN).
  const { settings } = useLineSettings(organizationId, projectName, "full");
  const includeNonFiniteMetrics = settings.includeNonFiniteMetrics ?? false;

  // --- Source 1b: eligible {bars} prefixes ---
  // Pulled unconditionally and merged into the metric list, matching the
  // Add Widget search panel (chart-config-form.tsx) and DynamicPatternPreview.
  // A pattern like `sys/*` will then surface `sys/{bars}` alongside
  // `sys/cpu.percentage.N` — same discovery model the user already has when
  // building a widget. The pattern's own regex/fuzzy filter decides which
  // entries survive; the eligibility proc has already excluded prefixes
  // that wouldn't make a meaningful bars chart.
  const eligiblePrefixes = useEligiblePrefixesForRuns(
    organizationId,
    projectName,
    hasPattern && hasRuns ? selectedRunIds : [],
  );

  // --- Source 1 (search mode): all metrics/files for selected runs ---
  const initialMetrics = useQuery(
    trpc.runs.distinctMetricNames.queryOptions(
      {
        organizationId,
        projectName,
        runIds: selectedRunIds,
        ...(includeNonFiniteMetrics ? { includeNonFiniteMetrics } : {}),
      },
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
      {
        organizationId,
        projectName,
        runIds: selectedRunIds,
        search: backendSearch,
        ...(includeNonFiniteMetrics ? { includeNonFiniteMetrics } : {}),
      },
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
  // Only send if the pattern is re2-compatible to avoid ClickHouse CANNOT_COMPILE_REGEXP errors
  const regexMetrics = useQuery(
    trpc.runs.distinctMetricNames.queryOptions(
      {
        organizationId,
        projectName,
        runIds: selectedRunIds,
        regex: trimmed,
        ...(includeNonFiniteMetrics ? { includeNonFiniteMetrics } : {}),
      },
      {
        enabled: hasPattern && hasRuns && patternMode === "regex" && isRe2Valid,
        staleTime: 60_000,
        placeholderData: (prev) => prev,
      },
    ),
  );

  const regexFiles = useQuery(
    trpc.runs.distinctFileLogNames.queryOptions(
      { organizationId, projectName, runIds: selectedRunIds, regex: trimmed },
      {
        enabled: hasPattern && hasRuns && patternMode === "regex" && isRe2Valid,
        staleTime: 60_000,
        placeholderData: (prev) => prev,
      },
    ),
  );

  const dynamicWidgets = useMemo(() => {
    if (!hasPattern) return [];
    // No runs selected → no metrics to resolve, return empty (prevents stale
    // cached data from generating widgets after the last run is deselected)
    if (!hasRuns) return [];

    let filteredMetrics: string[];
    let filteredFiles: { logName: string; logType: string }[];

    if (patternMode === "regex") {
      // Regex: backend handles filtering of real metric names + file
      // names, use results directly. Synthetic entries (console logs,
      // encoded `${prefix}{bars}` rollups) aren't in the backend's
      // candidate pool — they only exist client-side — so test them
      // against the regex here.
      filteredMetrics = [...(regexMetrics.data?.metricNames ?? [])];
      const backendRegexFiles = regexFiles.data?.files ?? [];
      let syntheticMatches: { logName: string; logType: string }[] = [];
      if (trimmed) {
        try {
          const re = new RegExp(trimmed);
          syntheticMatches = SYNTHETIC_CONSOLE_ENTRIES.filter((e) =>
            re.test(e.logName),
          );
          // Same idea for eligible {bars} prefixes: surface any encoded
          // `${prefix}{bars}` that matches the regex. Without this, a
          // dynamic-section regex like `dataset/\{bars\}|dataset/a`
          // matches the line metrics but never the bars rollup.
          if (eligiblePrefixes.data.length > 0) {
            for (const entry of eligiblePrefixes.data) {
              const encoded = encodeBarsEntry(entry.prefix);
              if (re.test(encoded) && !filteredMetrics.includes(encoded)) {
                filteredMetrics.push(encoded);
              }
            }
          }
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

      // Merge encoded bars entries (`${prefix}{bars}`) into the metric
      // list unconditionally — same model as the Add Widget search panel.
      // The pattern's own regex/fuzzy filter below decides which entries
      // survive; a pattern like `sys/*` will surface `sys/{bars}` next to
      // `sys/cpu.percentage.N` just like in widget creation.
      if (eligiblePrefixes.data.length > 0) {
        for (const entry of eligiblePrefixes.data) {
          mergedMetrics.push(encodeBarsEntry(entry.prefix));
        }
      }

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

    // Apply grouping rules: prefix allowlist OR regex + suffix combining.
    // - groups: combined widgets (one per shared prefix or capture-tuple)
    // - passthrough: metrics that survive the filter but don't combine (own widget)
    const { groups, passthrough } = bucketMetricsByPrefix(
      filteredMetrics,
      groupBy ?? [],
      groupPrefixes ?? [],
      groupPrefixRegex,
    );

    for (const [, group] of groups) {
      const sortedMembers = [...group.members].sort((a, b) => a.localeCompare(b));
      // Title shows the bucket key (prefix or capture-tuple) + the suffixes
      // bundled inside, e.g. "layers/layer_0 (grad_mean, weight_mean)" or
      // "5T · CRPS (max, mean, min)" for regex-grouped buckets.
      const suffixes = sortedMembers.map((m) => splitMetricPath(m).suffix);
      const title = `${group.title} (${suffixes.join(", ")})`;
      const config: ChartWidgetConfig = {
        title,
        metrics: sortedMembers,
        xAxis: "step",
        yAxisScale: "linear",
        xAxisScale: "linear",
        aggregation: "LAST",
        showOriginal: false,
      };
      widgets.push({
        id: `dyn-${sectionId}-group-${group.key}`,
        type: "chart",
        config,
        layout: { x: 0, y: 0, w: 6, h: 4 },
      });
    }

    for (const logName of passthrough) {
      // {bars} entries get a single-entry distributions widget. The
      // encoded display name is `${prefix}{bars}` — decode to recover
      // the raw prefix and emit one bars entry under it.
      if (isBarsEntry(logName)) {
        const prefix = decodeBarsEntry(logName);
        const config: DistributionsWidgetConfig = {
          entries: [
            {
              kind: "bars",
              prefix,
              viewMode: "ridgeline",
              depthAxis: "step",
              ignoreOutliers: true,
              stepsOnX: false,
            },
          ],
        };
        widgets.push({
          id: `dyn-${sectionId}-bars-${prefix}`,
          type: "distributions",
          config,
          layout: { x: 0, y: 0, w: 6, h: 4 },
        });
        continue;
      }
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

    // Categorical {bars} widgets emit whenever the pattern's regex / fuzzy
    // filter selects an encoded `${prefix}{bars}` entry from the merged
    // metric list. The eligible-prefix proc already excludes prefixes
    // that wouldn't make a meaningful bars chart, so a heterogeneous
    // prefix like `train/` never enters the candidate pool in the first
    // place — meaning a pattern like `train/*` still doesn't emit bars,
    // not because the section gates it, but because there's no eligible
    // entry to match. A pattern like `sys/*` (where sys/ IS eligible)
    // surfaces `sys/{bars}` alongside `sys/cpu.percentage.N`, mirroring
    // the Add Widget search panel's behavior.

    // Sort bars widgets to the END of the section, then alpha by id within
    // each group. The Add-Widget panel surfaces bars alongside line metrics
    // but a dashboard reader reaching for "the first widget in this section"
    // usually means a per-metric line chart — surfacing the prefix-level
    // bars rollup first would push the per-metric widgets below the fold.
    // Also keeps the test selectors that grab the first chart-fullscreen-btn
    // in a dynamic section pointing at a uPlot widget rather than a bars
    // canvas (the dialog UI differs and breaks .uplot-based assertions).
    widgets.sort((a, b) => {
      const aIsBars = a.id.includes(`dyn-${sectionId}-bars-`);
      const bIsBars = b.id.includes(`dyn-${sectionId}-bars-`);
      if (aIsBars !== bIsBars) return aIsBars ? 1 : -1;
      return a.id.localeCompare(b.id);
    });
    return widgets.slice(0, MAX_DYNAMIC_WIDGETS);
  }, [
    hasPattern, hasRuns, trimmed, isGlob, patternMode, sectionId, groupBy, groupPrefixes, groupPrefixRegex,
    initialMetrics.data, initialFiles.data,
    searchMetrics.data, searchFiles.data,
    regexMetrics.data, regexFiles.data,
    eligiblePrefixes.data,
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
        (regexMetrics.isLoading || regexFiles.isLoading)) ||
      eligiblePrefixes.isLoading);

  return { dynamicWidgets, isLoading };
}

/**
 * Lightweight hook that returns only the widget count for a dynamic section.
 * Shares the same query cache keys as useDynamicSectionWidgets, so if the
 * section was previously expanded the data comes from cache (0ms).
 *
 * Does NOT create Widget objects, sort, or allocate layouts — just counts matches.
 * Safe to mount for collapsed sections without performance impact.
 */
export function useDynamicWidgetCount(
  dynamicPattern: string | undefined,
  patternMode: "search" | "regex",
  organizationId: string,
  projectName: string,
  selectedRunIds: string[],
  groupBy: string[] | undefined,
  groupPrefixes: string[] | undefined,
  groupPrefixRegex: string | undefined,
): { count: number; isLoading: boolean } {
  const hasPattern = !!dynamicPattern?.trim();
  const trimmed = dynamicPattern?.trim() ?? "";
  const hasRuns = selectedRunIds.length > 0;

  const isGlob =
    patternMode === "search" &&
    (trimmed.includes("*") || trimmed.includes("?"));
  const isRe2Valid = patternMode === "regex" && trimmed ? isValidRe2Regex(trimmed) : true;
  const backendSearch = isGlob ? trimmed.replace(/[*?]/g, "") : trimmed;

  // Same queries as useDynamicSectionWidgets — shares cache
  const initialMetrics = useQuery(
    trpc.runs.distinctMetricNames.queryOptions(
      { organizationId, projectName, runIds: selectedRunIds },
      { enabled: hasPattern && hasRuns && patternMode === "search", staleTime: 60_000 },
    ),
  );
  const initialFiles = useQuery(
    trpc.runs.distinctFileLogNames.queryOptions(
      { organizationId, projectName, runIds: selectedRunIds },
      { enabled: hasPattern && hasRuns && patternMode === "search", staleTime: 60_000 },
    ),
  );
  const searchMetrics = useQuery(
    trpc.runs.distinctMetricNames.queryOptions(
      { organizationId, projectName, runIds: selectedRunIds, search: backendSearch },
      { enabled: hasPattern && hasRuns && patternMode === "search" && backendSearch.length > 0, staleTime: 60_000, placeholderData: (prev) => prev },
    ),
  );
  const searchFiles = useQuery(
    trpc.runs.distinctFileLogNames.queryOptions(
      { organizationId, projectName, runIds: selectedRunIds, search: backendSearch },
      { enabled: hasPattern && hasRuns && patternMode === "search" && backendSearch.length > 0, staleTime: 60_000, placeholderData: (prev) => prev },
    ),
  );
  const regexMetrics = useQuery(
    trpc.runs.distinctMetricNames.queryOptions(
      { organizationId, projectName, runIds: selectedRunIds, regex: trimmed },
      { enabled: hasPattern && hasRuns && patternMode === "regex" && isRe2Valid, staleTime: 60_000, placeholderData: (prev) => prev },
    ),
  );
  const regexFiles = useQuery(
    trpc.runs.distinctFileLogNames.queryOptions(
      { organizationId, projectName, runIds: selectedRunIds, regex: trimmed },
      { enabled: hasPattern && hasRuns && patternMode === "regex" && isRe2Valid, staleTime: 60_000, placeholderData: (prev) => prev },
    ),
  );

  // Mirror `useDynamicSectionWidgets`: pull eligible `{bars}` prefixes so the
  // collapsed-header widget count includes the bars rollups. Without this the
  // count under-reported by exactly the number of bars-eligible prefixes
  // matched by the section's pattern; expanding the section showed the right
  // number because the grid hook merges these in.
  const eligiblePrefixes = useEligiblePrefixesForRuns(
    organizationId,
    projectName,
    selectedRunIds,
    hasPattern && hasRuns,
  );

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

  const count = useMemo(() => {
    if (!hasPattern) return 0;
    if (!hasRuns) return 0;

    let metricNames: string[];
    let fileCount: number;

    // Encoded `${prefix}{bars}` entries surface alongside regular metrics
    // for both pattern modes — merged here so the count-and-filter logic
    // treats them identically to line metrics, matching the grid hook.
    const barsEntries = eligiblePrefixes.data.map((e) => encodeBarsEntry(e.prefix));

    if (patternMode === "regex") {
      // Backend regex doesn't know about synthetic `${prefix}{bars}`
      // entries — they're frontend-only. Filter the eligible bars set
      // against the regex client-side and merge. Same idea for
      // synthetic console entries below.
      let filteredBars: string[] = [];
      let syntheticCount = 0;
      if (trimmed) {
        try {
          const re = new RegExp(trimmed);
          filteredBars = barsEntries.filter((b) => re.test(b));
          syntheticCount = SYNTHETIC_CONSOLE_ENTRIES.filter((e) =>
            re.test(e.logName),
          ).length;
        } catch { /* invalid regex */ }
      }
      metricNames = [
        ...(regexMetrics.data?.metricNames ?? []),
        ...filteredBars,
      ];
      const backendFileCount = regexFiles.data?.files?.length ?? 0;
      fileCount = syntheticCount + backendFileCount;
    } else {
      const initM = initialMetrics.data?.metricNames ?? [];
      const searchM = searchMetrics.data?.metricNames ?? [];
      const mergedMetrics = new Set([...searchM, ...initM, ...barsEntries]);

      const initF = initialFiles.data?.files ?? [];
      const searchF = searchFiles.data?.files ?? [];
      const fileNames = new Set<string>();
      for (const e of SYNTHETIC_CONSOLE_ENTRIES) fileNames.add(e.logName);
      for (const f of initF) fileNames.add(f.logName);
      for (const f of searchF) fileNames.add(f.logName);

      if (!trimmed) {
        metricNames = [...mergedMetrics];
        fileCount = fileNames.size;
      } else if (isGlob) {
        try {
          const regex = globToRegex(trimmed);
          metricNames = [...mergedMetrics].filter((m) => regex.test(m));
          fileCount = [...fileNames].filter((n) => regex.test(n)).length;
        } catch {
          return 0;
        }
      } else {
        metricNames = fuzzyFilter([...mergedMetrics], trimmed);
        fileCount = fuzzyFilter([...fileNames], trimmed).length;
      }
    }

    // Apply grouping: each combined group counts as one widget; passthrough
    // metrics each count as one widget (own widget).
    const hasGrouping =
      (groupBy?.length ?? 0) > 0 ||
      (groupPrefixes?.length ?? 0) > 0 ||
      (groupPrefixRegex?.trim().length ?? 0) > 0;
    let metricWidgetCount: number;
    if (hasGrouping) {
      const { groups, passthrough } = bucketMetricsByPrefix(
        metricNames,
        groupBy ?? [],
        groupPrefixes ?? [],
        groupPrefixRegex,
      );
      metricWidgetCount = groups.size + passthrough.length;
    } else {
      metricWidgetCount = metricNames.length;
    }

    return Math.min(metricWidgetCount + fileCount, MAX_DYNAMIC_WIDGETS);
  }, [
    hasPattern, hasRuns, trimmed, isGlob, patternMode, groupBy, groupPrefixes, groupPrefixRegex,
    initialMetrics.data, initialFiles.data,
    searchMetrics.data, searchFiles.data,
    regexMetrics.data, regexFiles.data,
    eligiblePrefixes.data,
  ]);

  return { count, isLoading };
}

/**
 * Resolve a dynamic pattern to its matched metric names. Cache-shared with
 * useDynamicSectionWidgets so calling this from a dialog while the section
 * is rendered is essentially free.
 *
 * Returned `metricNames` are sorted alphabetically. Files are not included —
 * they don't participate in prefix/suffix grouping.
 */
export function useDynamicMatchedMetrics(
  dynamicPattern: string | undefined,
  patternMode: "search" | "regex",
  organizationId: string,
  projectName: string,
  selectedRunIds: string[],
): { metricNames: string[]; isLoading: boolean } {
  const hasPattern = !!dynamicPattern?.trim();
  const trimmed = dynamicPattern?.trim() ?? "";
  const hasRuns = selectedRunIds.length > 0;

  const isGlob =
    patternMode === "search" && (trimmed.includes("*") || trimmed.includes("?"));
  const isRe2Valid = patternMode === "regex" && trimmed ? isValidRe2Regex(trimmed) : true;
  const backendSearch = isGlob ? trimmed.replace(/[*?]/g, "") : trimmed;

  const initialMetrics = useQuery(
    trpc.runs.distinctMetricNames.queryOptions(
      { organizationId, projectName, runIds: selectedRunIds },
      { enabled: hasPattern && hasRuns && patternMode === "search", staleTime: 60_000 },
    ),
  );
  const searchMetrics = useQuery(
    trpc.runs.distinctMetricNames.queryOptions(
      { organizationId, projectName, runIds: selectedRunIds, search: backendSearch },
      {
        enabled: hasPattern && hasRuns && patternMode === "search" && backendSearch.length > 0,
        staleTime: 60_000,
        placeholderData: (prev) => prev,
      },
    ),
  );
  const regexMetrics = useQuery(
    trpc.runs.distinctMetricNames.queryOptions(
      { organizationId, projectName, runIds: selectedRunIds, regex: trimmed },
      {
        enabled: hasPattern && hasRuns && patternMode === "regex" && isRe2Valid,
        staleTime: 60_000,
        placeholderData: (prev) => prev,
      },
    ),
  );

  const isLoading =
    hasPattern &&
    hasRuns &&
    ((patternMode === "search" && (initialMetrics.isLoading || searchMetrics.isLoading)) ||
      (patternMode === "regex" && regexMetrics.isLoading));

  const metricNames = useMemo(() => {
    if (!hasPattern || !hasRuns) return [];

    let names: string[];
    if (patternMode === "regex") {
      names = regexMetrics.data?.metricNames ?? [];
    } else {
      const initM = initialMetrics.data?.metricNames ?? [];
      const searchM = searchMetrics.data?.metricNames ?? [];
      const merged = Array.from(new Set([...searchM, ...initM]));

      if (!trimmed) {
        names = merged;
      } else if (isGlob) {
        try {
          const regex = globToRegex(trimmed);
          names = merged.filter((m) => regex.test(m));
        } catch {
          return [];
        }
      } else {
        names = fuzzyFilter(merged, trimmed);
      }
    }
    return names.sort((a, b) => a.localeCompare(b));
  }, [
    hasPattern, hasRuns, trimmed, isGlob, patternMode,
    initialMetrics.data, searchMetrics.data, regexMetrics.data,
  ]);

  return { metricNames, isLoading };
}
