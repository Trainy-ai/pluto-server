import { useState, useMemo, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { globToRegex } from "./glob-utils";
import {
  useEligiblePrefixesForRuns,
  useRunFileLogNames,
} from "../../~queries/file-log-names";
import { fuzzyFilter } from "@/lib/fuzzy-search";
import type {
  DistributionsWidgetConfig,
  DistributionsEntry,
} from "../../~types/dashboard-types";
import { MetricResultsList } from "./metric-results-list";
import { SelectedBadges } from "./selected-badges";
import {
  encodeBarsEntry,
  decodeBarsEntry,
  isBarsEntry,
} from "./bars-entry-encoding";
import { isValidRe2Regex } from "../../~lib/validate-re2-regex";

interface DistributionsConfigFormProps {
  config: Partial<DistributionsWidgetConfig>;
  onChange: (config: Partial<DistributionsWidgetConfig>) => void;
  organizationId: string;
  projectName: string;
  selectedRunIds?: string[];
}

// Mirrors the FilesConfigForm / ChartConfigForm layout: Search/Regex
// tabs over a shared MetricResultsList. Entries flow into
// config.entries[] tagged with the right `kind`:
//   • {bars} rollups (encoded as `${prefix}{bars}` in the picker) →
//     { kind: "bars", prefix, ... defaults }
//   • HISTOGRAM-type metrics                                      →
//     { kind: "histogram", metric, ... defaults }
//
// We bypass server-side regex / fuzzy procs because the candidate set
// is bounded (eligible prefixes + HISTOGRAM file names per run) and
// fits comfortably in memory. Both Search and Regex filter the merged
// list locally.
export function DistributionsConfigForm({
  config,
  onChange,
  organizationId,
  projectName,
  selectedRunIds,
}: DistributionsConfigFormProps) {
  const entries: DistributionsEntry[] = config.entries ?? [];

  const [mode, setMode] = useState<"search" | "regex">("search");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [regexPattern, setRegexPattern] = useState("");
  const [debouncedRegex, setDebouncedRegex] = useState("");
  const [isInvalidRegex, setIsInvalidRegex] = useState(false);
  const isGlob = search.includes("*") || search.includes("?");

  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedSearch(isGlob ? search.replace(/[*?]/g, "") : search),
      300,
    );
    return () => clearTimeout(timer);
  }, [search, isGlob]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (regexPattern.trim() && !isInvalidRegex) {
        setDebouncedRegex(regexPattern.trim());
      } else {
        setDebouncedRegex("");
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [regexPattern, isInvalidRegex]);

  useEffect(() => {
    if (!regexPattern.trim()) {
      setIsInvalidRegex(false);
      return;
    }
    setIsInvalidRegex(!isValidRe2Regex(regexPattern.trim()));
  }, [regexPattern]);

  // ── Data sources ────────────────────────────────────────────────
  const { data: eligiblePrefixes = [], isLoading: isLoadingPrefixes } =
    useEligiblePrefixesForRuns(
      organizationId,
      projectName,
      selectedRunIds ?? [],
    );
  const { data: fileLogNames, isLoading: isLoadingFiles } = useRunFileLogNames(
    organizationId,
    projectName,
    selectedRunIds ?? [],
  );

  // Encoded picker values: bars entries surface as `${prefix}{bars}`
  // (so they share the namespace with the rest of the list and the
  // selectedValues set lookup is a string compare). Histograms surface
  // by their raw metric name.
  const barsDisplays = useMemo(
    () =>
      eligiblePrefixes.map((e: { prefix: string }) => encodeBarsEntry(e.prefix)),
    [eligiblePrefixes],
  );
  const histogramDisplays = useMemo(
    () =>
      (fileLogNames?.files ?? [])
        .filter((f) => f.logType === "HISTOGRAM")
        .map((f) => f.logName),
    [fileLogNames],
  );

  const allAvailable = useMemo(
    () => Array.from(new Set([...barsDisplays, ...histogramDisplays])),
    [barsDisplays, histogramDisplays],
  );

  // Decorate each display value with its source type so MetricResultsList
  // renders the right icon (BARS vs HISTOGRAM) per row.
  const typeMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of barsDisplays) m.set(d, "BARS");
    for (const d of histogramDisplays) m.set(d, "HISTOGRAM");
    return m;
  }, [barsDisplays, histogramDisplays]);

  // ── selectedValues ──────────────────────────────────────────────
  const selectedValues = useMemo(() => {
    return entries.map((e) =>
      e.kind === "bars" ? encodeBarsEntry(e.prefix) : e.metric,
    );
  }, [entries]);

  // ── Toggle / persistence ────────────────────────────────────────
  const toggleValue = (value: string) => {
    if (isBarsEntry(value)) {
      const prefix = decodeBarsEntry(value);
      const exists = entries.some((e) => e.kind === "bars" && e.prefix === prefix);
      if (exists) {
        onChange({
          ...config,
          entries: entries.filter(
            (e) => !(e.kind === "bars" && e.prefix === prefix),
          ),
        });
        return;
      }
      onChange({
        ...config,
        entries: [
          ...entries,
          {
            kind: "bars",
            prefix,
            viewMode: "ridgeline",
            depthAxis: "step",
            ignoreOutliers: true,
            stepsOnX: false,
          },
        ],
      });
      return;
    }
    // Treated as a numeric histogram metric.
    const exists = entries.some(
      (e) => e.kind === "histogram" && e.metric === value,
    );
    if (exists) {
      onChange({
        ...config,
        entries: entries.filter(
          (e) => !(e.kind === "histogram" && e.metric === value),
        ),
      });
      return;
    }
    onChange({
      ...config,
      entries: [
        ...entries,
        {
          kind: "histogram",
          metric: value,
          viewMode: "ridgeline",
          ignoreOutliers: true,
          stepsOnX: false,
        },
      ],
    });
  };

  const selectAll = (values: string[]) => {
    let next = entries.slice();
    for (const v of values) {
      if (selectedValues.includes(v)) continue;
      if (isBarsEntry(v)) {
        next = [
          ...next,
          {
            kind: "bars",
            prefix: decodeBarsEntry(v),
            viewMode: "ridgeline",
            depthAxis: "step",
            ignoreOutliers: true,
            stepsOnX: false,
          },
        ];
      } else {
        next = [
          ...next,
          {
            kind: "histogram",
            metric: v,
            viewMode: "ridgeline",
            ignoreOutliers: true,
            stepsOnX: false,
          },
        ];
      }
    }
    onChange({ ...config, entries: next });
  };

  // ── Filtered list per mode ──────────────────────────────────────
  const filtered = useMemo(() => {
    if (mode === "regex") {
      if (!debouncedRegex) return allAvailable.slice().sort((a, b) => a.localeCompare(b));
      try {
        const re = new RegExp(debouncedRegex);
        return allAvailable
          .filter((v) => re.test(v))
          .sort((a, b) => a.localeCompare(b));
      } catch {
        return [] as string[];
      }
    }
    const trimmed = search.trim();
    if (!trimmed) return allAvailable.slice().sort((a, b) => a.localeCompare(b));
    if (isGlob) {
      try {
        const re = globToRegex(trimmed);
        return allAvailable
          .filter((v) => re.test(v))
          .sort((a, b) => a.localeCompare(b));
      } catch {
        return [];
      }
    }
    return fuzzyFilter(allAvailable, debouncedSearch || search);
  }, [allAvailable, mode, search, debouncedSearch, debouncedRegex, isGlob]);

  const isLoadingInitial = isLoadingPrefixes || isLoadingFiles;

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label>Distribution Selection Mode</Label>
        <Tabs value={mode} onValueChange={(v) => setMode(v as "search" | "regex")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="search">Search</TabsTrigger>
            <TabsTrigger value="regex">Regex</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {mode === "search" ? (
        <div className="space-y-3">
          <div className="grid gap-2">
            <Label>Search Distributions</Label>
            <Input
              data-testid="add-widget-distributions-search"
              placeholder="Search... (use * or ? for glob patterns)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Fuzzy text search. Use <code>*</code> / <code>?</code> for glob
              patterns (e.g., <code>distributions/*</code>).
            </p>
          </div>
          <MetricResultsList
            metrics={filtered}
            showSkeleton={isLoadingInitial}
            selectedValues={selectedValues}
            isLoading={isLoadingInitial}
            emptyMessage="No distributions found."
            itemLabel="distribution"
            typeMap={typeMap}
            onToggle={toggleValue}
            onSelectAll={() => selectAll(filtered)}
          />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2">
            <Label>Regex Pattern</Label>
            <Input
              data-testid="add-widget-distributions-regex"
              placeholder="e.g. ^normal/.*"
              value={regexPattern}
              onChange={(e) => setRegexPattern(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {isInvalidRegex
                ? "Invalid pattern."
                : "RE2-compatible regex. Filters the list as you type."}
            </p>
          </div>
          <MetricResultsList
            metrics={filtered}
            showSkeleton={isLoadingInitial}
            selectedValues={selectedValues}
            isLoading={isLoadingInitial}
            emptyMessage="No matches."
            itemLabel="distribution"
            typeMap={typeMap}
            onToggle={toggleValue}
            onSelectAll={() => selectAll(filtered)}
          />
        </div>
      )}

      <SelectedBadges values={selectedValues} onRemove={toggleValue} />
    </div>
  );
}
