import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import { useRunMetricNames } from "../../~queries/metric-summaries";
import { useLineSettings } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/use-line-settings";
import {
  isPatternValue,
  isGlobValue,
  getGlobPattern,
  isRegexValue,
  getRegexPattern,
  resolveMetrics,
} from "./glob-utils";
import { isValidRe2Regex } from "../../~lib/validate-re2-regex";
import type { Section, ChartWidgetConfig } from "../../~types/dashboard-types";

interface UseHiddenPatternWidgetsParams {
  sections: Section[];
  selectedRunIds: string[];
  organizationId: string;
  projectName: string;
  isEditing: boolean;
}

/**
 * Computes which pattern-only chart widgets should be hidden because their
 * patterns resolve to zero metrics for the currently selected runs.
 *
 * This runs at the DashboardBuilder level (before rendering) so we don't
 * depend on VirtualizedChart / IntersectionObserver to mount each widget first.
 *
 * Returns a Set of widget IDs that should be removed from the layout.
 * In edit mode or when no runs are selected, returns an empty set.
 */
export function useHiddenPatternWidgets({
  sections,
  selectedRunIds,
  organizationId,
  projectName,
  isEditing,
}: UseHiddenPatternWidgetsParams): {
  hidden: Set<string>;
  /** Map of pattern widget ID → resolved metric names (for search filtering) */
  resolved: Map<string, string[]>;
} {
  // Collect all pattern-only chart widgets across all sections.
  // Always compute this regardless of isEditing so that the downstream
  // useQueries observers stay active and cached during edit mode.
  // This avoids a stale-query race when transitioning back to view mode.
  const patternWidgets = useMemo(() => {
    const result: { id: string; metrics: string[] }[] = [];
    const collectFromWidgets = (widgets: Section["widgets"]) => {
      for (const widget of widgets) {
        if (widget.type !== "chart") continue;
        const config = widget.config as ChartWidgetConfig;
        if (
          config.metrics &&
          config.metrics.length > 0 &&
          config.metrics.every(isPatternValue)
        ) {
          result.push({ id: widget.id, metrics: config.metrics });
        }
      }
    };
    for (const section of sections) {
      collectFromWidgets(section.widgets);
      for (const child of section.children ?? []) {
        collectFromWidgets(child.widgets);
      }
    }
    return result;
  }, [sections]);

  // Collect unique glob search bases and regex patterns from all pattern widgets
  const { globBases, regexPatterns } = useMemo(() => {
    const bases = new Set<string>();
    const patterns: string[] = [];
    for (const pw of patternWidgets) {
      for (const m of pw.metrics) {
        if (isGlobValue(m)) {
          const base = getGlobPattern(m).replace(/[*?]/g, "");
          if (base.length > 0) bases.add(base);
        } else if (isRegexValue(m)) {
          patterns.push(getRegexPattern(m));
        }
      }
    }
    return { globBases: Array.from(bases), regexPatterns: [...new Set(patterns)] };
  }, [patternWidgets]);

  // Respect the "Include NaN/Inf-only metrics" toggle from shared line settings.
  const { settings } = useLineSettings(organizationId, projectName, "full");
  const includeNonFiniteMetrics = settings.includeNonFiniteMetrics ?? false;

  // Fetch all metric names for selected runs (shared query)
  const { data: allMetricNames, isLoading: isLoadingMetricNames } =
    useRunMetricNames(organizationId, projectName, selectedRunIds, includeNonFiniteMetrics);

  // Fetch glob-base searches scoped to selected runs
  const globSearchResults = useQueries({
    queries:
      patternWidgets.length > 0 && selectedRunIds.length > 0
        ? globBases.map((base) =>
            trpc.runs.distinctMetricNames.queryOptions({
              organizationId,
              projectName,
              search: base,
              runIds: selectedRunIds,
              ...(includeNonFiniteMetrics ? { includeNonFiniteMetrics } : {}),
            })
          )
        : [],
  });

  // Fetch regex searches scoped to selected runs
  // Filter out re2-incompatible patterns to prevent ClickHouse CANNOT_COMPILE_REGEXP errors
  const validRegexPatterns = useMemo(
    () => regexPatterns.filter((p) => isValidRe2Regex(p)),
    [regexPatterns],
  );

  const regexSearchResults = useQueries({
    queries:
      patternWidgets.length > 0 && selectedRunIds.length > 0
        ? validRegexPatterns.map((pattern) =>
            trpc.runs.distinctMetricNames.queryOptions({
              organizationId,
              projectName,
              regex: pattern,
              runIds: selectedRunIds,
              ...(includeNonFiniteMetrics ? { includeNonFiniteMetrics } : {}),
            })
          )
        : [],
  });

  // Wait for all queries to settle before hiding anything
  const queriesSettled =
    !isLoadingMetricNames &&
    globSearchResults.every((r) => !r.isLoading) &&
    regexSearchResults.every((r) => !r.isLoading);

  const empty = useMemo(() => ({ hidden: new Set<string>(), resolved: new Map<string, string[]>() }), []);

  return useMemo(() => {
    // Never hide in edit mode
    if (isEditing) return empty;

    // No pattern widgets → nothing to hide
    if (patternWidgets.length === 0) return empty;

    // No runs selected → can't determine matches yet, don't hide (prevents
    // flash of hidden content on initial page load before runs are selected)
    if (selectedRunIds.length === 0) return empty;

    // Queries still loading → don't hide yet (prevent flash)
    if (!queriesSettled) return empty;

    // If the base metric names query returned nothing, the data source may be
    // empty or unavailable (e.g. ClickHouse MV not populated).  Don't hide
    // anything in that case — we can't distinguish "no data" from "patterns
    // genuinely don't match".
    if ((allMetricNames?.metricNames?.length ?? 0) === 0) {
      return empty;
    }

    // Build the combined available metric names set
    const available = new Set<string>();
    for (const name of allMetricNames?.metricNames ?? []) {
      available.add(name);
    }
    for (const result of globSearchResults) {
      for (const name of result.data?.metricNames ?? []) {
        available.add(name);
      }
    }
    for (const result of regexSearchResults) {
      for (const name of result.data?.metricNames ?? []) {
        available.add(name);
      }
    }

    const availableArray = Array.from(available);

    // For each pattern-only widget, resolve its patterns to actual metric names
    const hidden = new Set<string>();
    const resolved = new Map<string, string[]>();
    for (const pw of patternWidgets) {
      const names = resolveMetrics(pw.metrics, availableArray);
      resolved.set(pw.id, names);
      if (names.length === 0) {
        hidden.add(pw.id);
      }
    }
    return { hidden, resolved };
  }, [
    isEditing,
    patternWidgets,
    selectedRunIds,
    queriesSettled,
    allMetricNames,
    globSearchResults,
    regexSearchResults,
  ]);
}
