import { useState, useMemo, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SparklesIcon } from "lucide-react";
import { makeRegexValue, makeGlobValue, globToRegex } from "./glob-utils";
import { useDistinctMetricNames, useRunMetricNames, useSearchMetricNames, useRegexSearchMetricNames } from "../../~queries/metric-summaries";
import { fuzzyFilter } from "@/lib/fuzzy-search";
import type { ChartWidgetConfig } from "../../~types/dashboard-types";
import { MetricResultsList } from "./metric-results-list";
import { RegexSearchPanel } from "./regex-search-panel";
import { SelectedBadges } from "./selected-badges";
import { XAxisSelector } from "./x-axis-selector";

interface ChartConfigFormProps {
  config: Partial<ChartWidgetConfig>;
  onChange: (config: Partial<ChartWidgetConfig>) => void;
  organizationId: string;
  projectName: string;
  selectedRunIds?: string[];
}

export function ChartConfigForm({
  config,
  onChange,
  organizationId,
  projectName,
  selectedRunIds,
}: ChartConfigFormProps) {
  const [metricMode, setMetricMode] = useState<"search" | "regex">("search");
  const [regexPattern, setRegexPattern] = useState("");
  const [debouncedRegex, setDebouncedRegex] = useState("");
  const [isInvalidRegex, setIsInvalidRegex] = useState(false);

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
    try {
      new RegExp(regexPattern.trim());
      setIsInvalidRegex(false);
    } catch {
      setIsInvalidRegex(true);
    }
  }, [regexPattern]);

  const { data: regexResults, isFetching: isRegexSearching } =
    useRegexSearchMetricNames(organizationId, projectName, debouncedRegex);

  const regexMetrics = regexResults?.metricNames ?? [];
  const selectedValues = config.metrics ?? [];

  const handleRegexToggle = (metric: string) => {
    const current = config.metrics ?? [];
    if (current.includes(metric)) {
      onChange({ ...config, metrics: current.filter((m) => m !== metric) });
    } else {
      onChange({ ...config, metrics: [...current, metric] });
    }
  };

  const handleRegexSelectAll = () => {
    const current = new Set(config.metrics ?? []);
    for (const m of regexMetrics) { current.add(m); }
    onChange({ ...config, metrics: Array.from(current) });
  };

  const handleApplyRegexDynamic = () => {
    const trimmed = regexPattern.trim();
    if (!trimmed || isInvalidRegex) return;
    const regexVal = makeRegexValue(trimmed);
    const current = config.metrics ?? [];
    if (!current.includes(regexVal)) {
      onChange({ ...config, metrics: [...current, regexVal] });
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label>Metric Selection Mode</Label>
        <Tabs value={metricMode} onValueChange={(v) => setMetricMode(v as "search" | "regex")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="search">Search</TabsTrigger>
            <TabsTrigger value="regex">Regex</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {metricMode === "search" ? (
        <SearchMetricPanel
          organizationId={organizationId}
          projectName={projectName}
          selectedRunIds={selectedRunIds}
          selectedValues={selectedValues}
          onToggle={handleRegexToggle}
          onSelectAll={(metrics) => {
            const current = new Set(selectedValues);
            for (const m of metrics) { current.add(m); }
            onChange({ ...config, metrics: Array.from(current) });
          }}
          onApplyGlob={(pattern) => {
            const globVal = makeGlobValue(pattern);
            if (!selectedValues.includes(globVal)) {
              onChange({ ...config, metrics: [...selectedValues, globVal] });
            }
          }}
        />
      ) : (
        <RegexSearchPanel
          regexPattern={regexPattern}
          onRegexChange={setRegexPattern}
          isInvalidRegex={isInvalidRegex}
          isRegexSearching={isRegexSearching}
          regexMetrics={regexMetrics}
          selectedValues={selectedValues}
          onToggle={handleRegexToggle}
          onSelectAll={handleRegexSelectAll}
          onApplyDynamic={handleApplyRegexDynamic}
        />
      )}

      <SelectedBadges
        values={selectedValues}
        onRemove={(v) => onChange({ ...config, metrics: selectedValues.filter((m) => m !== v) })}
      />

      <XAxisSelector
        value={config.xAxis ?? "step"}
        onChange={(value) => onChange({ ...config, xAxis: value })}
        yMetrics={config.metrics ?? []}
        organizationId={organizationId}
        projectName={projectName}
        selectedRunIds={selectedRunIds}
      />

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Aggregation</Label>
          <Select
            value={config.aggregation ?? "LAST"}
            onValueChange={(value) =>
              onChange({ ...config, aggregation: value as ChartWidgetConfig["aggregation"] })
            }
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="LAST">Last</SelectItem>
              <SelectItem value="AVG">Average</SelectItem>
              <SelectItem value="MIN">Min</SelectItem>
              <SelectItem value="MAX">Max</SelectItem>
              <SelectItem value="VARIANCE">Variance</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Y-Axis Scale</Label>
          <Select
            value={config.yAxisScale ?? "linear"}
            onValueChange={(value) => onChange({ ...config, yAxisScale: value as "linear" | "log" })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="linear">Linear</SelectItem>
              <SelectItem value="log">Logarithmic</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>X-Axis Scale</Label>
          <Select
            value={config.xAxisScale ?? "linear"}
            onValueChange={(value) => onChange({ ...config, xAxisScale: value as "linear" | "log" })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="linear">Linear</SelectItem>
              <SelectItem value="log">Logarithmic</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

// Search panel — fuzzy + glob search with inline results
function SearchMetricPanel({
  organizationId,
  projectName,
  selectedRunIds,
  selectedValues,
  onToggle,
  onSelectAll,
  onApplyGlob,
}: {
  organizationId: string;
  projectName: string;
  selectedRunIds?: string[];
  selectedValues: string[];
  onToggle: (metric: string) => void;
  onSelectAll: (metrics: string[]) => void;
  onApplyGlob: (pattern: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const isGlob = search.includes("*") || search.includes("?");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(isGlob ? search.replace(/[*?]/g, "") : search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, isGlob]);

  const { data: initialMetrics, isLoading: isLoadingInitial } =
    useDistinctMetricNames(organizationId, projectName);
  const { data: runMetrics } = useRunMetricNames(organizationId, projectName, selectedRunIds ?? []);
  const runMetricSet = useMemo(() => {
    if (!runMetrics?.metricNames) return null;
    return new Set(runMetrics.metricNames);
  }, [runMetrics]);
  const { data: searchResults, isFetching: isSearching } =
    useSearchMetricNames(organizationId, projectName, debouncedSearch);

  const filteredMetrics = useMemo(() => {
    const initial = initialMetrics?.metricNames ?? [];
    const searched = searchResults?.metricNames ?? [];
    const merged = Array.from(new Set([...searched, ...initial]));
    const trimmed = search.trim();
    if (!trimmed) return merged.sort((a, b) => a.localeCompare(b));
    if (isGlob) {
      try {
        const regex = globToRegex(trimmed);
        return merged.filter((m) => regex.test(m)).sort((a, b) => a.localeCompare(b));
      } catch { return []; }
    }
    return fuzzyFilter(merged, search);
  }, [initialMetrics, searchResults, search, isGlob]);

  const isLoading = isLoadingInitial || isSearching;

  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        <Label>Search Metrics</Label>
        <Input
          placeholder="Search metrics... (use * or ? for glob patterns)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Fuzzy text search. Use <code>*</code> / <code>?</code> for glob patterns (e.g., <code>train/*</code>).
        </p>
      </div>
      <MetricResultsList
        metrics={filteredMetrics}
        selectedValues={selectedValues}
        isLoading={isLoading}
        emptyMessage="No metrics found."
        onToggle={onToggle}
        onSelectAll={() => onSelectAll(filteredMetrics)}
        runMetricSet={runMetricSet}
        footer={
          isGlob && search.trim() ? (
            <div className="flex items-center gap-2 border-t px-3 py-2">
              <SparklesIcon className="size-3 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-xs text-muted-foreground">Apply as dynamic pattern</span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-3 text-xs"
                onClick={() => onApplyGlob(search.trim())}
                disabled={selectedValues.includes(makeGlobValue(search.trim()))}
              >
                {selectedValues.includes(makeGlobValue(search.trim())) ? "Applied" : "Apply"}
              </Button>
            </div>
          ) : undefined
        }
      />
    </div>
  );
}
