import { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LineChartIcon,
  BarChart3Icon,
  FileTextIcon,
  ImageIcon,
  VideoIcon,
  MusicIcon,
  Loader2Icon,
  CheckIcon,
  Code2,
  SparklesIcon,
  TriangleAlertIcon,
  TerminalIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { makeRegexValue, makeGlobValue, isGlobValue, getGlobPattern, isRegexValue, getRegexPattern, isPatternValue, globToRegex } from "./glob-utils";
import { useDistinctMetricNames, useRunMetricNames, useSearchMetricNames, useRegexSearchMetricNames } from "../../~queries/metric-summaries";
import { useDistinctFileLogNames, useRunFileLogNames, useSearchFileLogNames, useRegexSearchFileLogNames } from "../../~queries/file-log-names";
import { fuzzyFilter } from "@/lib/fuzzy-search";
import { SYNTHETIC_CONSOLE_ENTRIES } from "./console-log-constants";
import type {
  WidgetType,
  Widget,
  WidgetConfig,
  ChartWidgetConfig,
  FileGroupWidgetConfig,
} from "../../~types/dashboard-types";

interface AddWidgetModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (widget: Omit<Widget, "id">) => void;
  organizationId: string;
  projectName: string;
  editWidget?: Widget;
  /** Selected run IDs (SQID) for "not present" warnings in metric selector */
  selectedRunIds?: string[];
}

// For editing, determine which sub-tab we're in
function toUnifiedSubTab(type: WidgetType): "metrics" | "files" {
  return (type === "histogram" || type === "file-group") ? "files" : "metrics";
}

export function AddWidgetModal({
  open,
  onOpenChange,
  onAdd,
  organizationId,
  projectName,
  editWidget,
  selectedRunIds,
}: AddWidgetModalProps) {
  // For unified widget: which sub-tab is active (null = not yet chosen)
  const [unifiedTab, setUnifiedTab] = useState<"metrics" | "files" | null>(
    editWidget ? toUnifiedSubTab(editWidget.type) : null
  );
  const [config, setConfig] = useState<Partial<WidgetConfig>>(() => {
    if (!editWidget) return {};
    // Convert old histogram config { metric: "x" } to file-group config { files: ["x"] }
    if (editWidget.type === "histogram") {
      const hc = editWidget.config as { metric?: string };
      return { files: hc.metric ? [hc.metric] : [] } as FileGroupWidgetConfig;
    }
    return editWidget.config;
  });
  const [title, setTitle] = useState(editWidget?.config.title ?? "");

  const isEditing = !!editWidget;

  // Sync state when editWidget changes (modal opens for editing)
  useEffect(() => {
    if (editWidget) {
      setUnifiedTab(toUnifiedSubTab(editWidget.type));
      if (editWidget.type === "histogram") {
        const hc = editWidget.config as { metric?: string };
        setConfig({ files: hc.metric ? [hc.metric] : [] } as FileGroupWidgetConfig);
      } else {
        setConfig({ ...editWidget.config });
      }
      setTitle(editWidget.config.title ?? "");
    }
  }, [editWidget]);

  // Resolve the actual WidgetType from modal state
  const resolvedWidgetType = useMemo((): WidgetType | null => {
    if (!unifiedTab) return null;
    return unifiedTab === "metrics" ? "chart" : "file-group";
  }, [unifiedTab]);

  const handleUnifiedTabChange = (tab: "metrics" | "files") => {
    // Don't reset config if clicking the already-active tab
    if (tab === unifiedTab) return;
    setUnifiedTab(tab);
    // Reset config when switching tabs
    if (tab === "metrics") {
      setConfig({
        metrics: [],
        xAxis: "step",
        yAxisScale: "linear",
        xAxisScale: "linear",
        aggregation: "LAST",
        showOriginal: false,
      } as ChartWidgetConfig);
    } else {
      setConfig({
        files: [],
      } as FileGroupWidgetConfig);
    }
  };

  const handleAdd = () => {
    if (!resolvedWidgetType) return;

    const finalConfig = { ...config, title: title || undefined };

    onAdd({
      type: resolvedWidgetType,
      config: finalConfig as WidgetConfig,
      layout: editWidget?.layout ?? {
        x: 0,
        y: 9999,
        w: 6,
        h: 4,
      },
    });

    // Reset state
    setUnifiedTab(null);
    setConfig({});
    setTitle("");
    onOpenChange(false);
  };

  const handleClose = () => {
    setUnifiedTab(null);
    setConfig({});
    setTitle("");
    onOpenChange(false);
  };

  const canAdd = useMemo(() => {
    if (!resolvedWidgetType) return false;

    switch (resolvedWidgetType) {
      case "chart": {
        const chartConfig = config as ChartWidgetConfig;
        return chartConfig.metrics && chartConfig.metrics.length > 0;
      }
      case "file-group": {
        const fileGroupConfig = config as Partial<FileGroupWidgetConfig>;
        return !!fileGroupConfig.files && fileGroupConfig.files.length > 0;
      }
      default:
        return false;
    }
  }, [resolvedWidgetType, config]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Widget" : "Choose Widget Type"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Configure the widget settings and select the data to display."
              : "Select the type of widget you want to add to your dashboard."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="grid grid-cols-2 gap-3">
            <button
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-colors hover:bg-accent",
                unifiedTab === "metrics" && "border-primary bg-accent"
              )}
              onClick={() => handleUnifiedTabChange("metrics")}
            >
              <LineChartIcon className="size-6 text-muted-foreground" />
              <div className="text-sm font-medium">Metrics</div>
              <div className="text-xs text-muted-foreground">
                Line charts from numeric data
              </div>
            </button>
            <button
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-colors hover:bg-accent",
                unifiedTab === "files" && "border-primary bg-accent"
              )}
              onClick={() => handleUnifiedTabChange("files")}
            >
              <BarChart3Icon className="size-6 text-muted-foreground" />
              <div className="text-sm font-medium">Files</div>
              <div className="text-xs text-muted-foreground">
                Logs, histograms, images, videos, audio
              </div>
            </button>
          </div>

          {unifiedTab && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="title">Widget Title (optional)</Label>
                <Input
                  id="title"
                  placeholder="Enter widget title..."
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              {unifiedTab === "metrics" && (
                <ChartConfigForm
                  config={config as Partial<ChartWidgetConfig>}
                  onChange={setConfig}
                  organizationId={organizationId}
                  projectName={projectName}
                  selectedRunIds={selectedRunIds}
                />
              )}

              {unifiedTab === "files" && (
                <FilesConfigForm
                  config={config as Partial<FileGroupWidgetConfig>}
                  onChange={setConfig}
                  organizationId={organizationId}
                  projectName={projectName}
                  selectedRunIds={selectedRunIds}
                />
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!canAdd}>
            {isEditing ? "Save Changes" : "Add Widget"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Chart configuration form with Search / Regex tabs
function ChartConfigForm({
  config,
  onChange,
  organizationId,
  projectName,
  selectedRunIds,
}: {
  config: Partial<ChartWidgetConfig>;
  onChange: (config: Partial<ChartWidgetConfig>) => void;
  organizationId: string;
  projectName: string;
  selectedRunIds?: string[];
}) {
  const [metricMode, setMetricMode] = useState<"search" | "regex">("search");
  const [regexPattern, setRegexPattern] = useState("");
  const [debouncedRegex, setDebouncedRegex] = useState("");
  const [isInvalidRegex, setIsInvalidRegex] = useState(false);

  // Debounce regex input for backend query
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

  // Validate regex client-side
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

  // Backend regex search via ClickHouse match()
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
    for (const m of regexMetrics) {
      current.add(m);
    }
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
        <RegexMetricPanel
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

      {/* Selected metrics badges (shown in both modes) */}
      {selectedValues.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedValues.slice(0, 8).map((v) => {
            const isGlobVal = isGlobValue(v);
            const isRegex = isRegexValue(v);
            const isDynamic = isGlobVal || isRegex;
            return (
              <Badge
                key={v}
                variant={isDynamic ? "default" : "secondary"}
                className={cn(
                  "max-w-[220px] cursor-pointer text-xs",
                  isDynamic && "bg-primary/90 text-primary-foreground"
                )}
                title={isGlobVal ? getGlobPattern(v) : isRegex ? getRegexPattern(v) : v}
                onClick={() => {
                  onChange({ ...config, metrics: selectedValues.filter((m) => m !== v) });
                }}
              >
                {isGlobVal && <SparklesIcon className="mr-1 size-3 shrink-0" />}
                {isRegex && <Code2 className="mr-1 size-3 shrink-0" />}
                <span className="truncate">{isGlobVal ? getGlobPattern(v) : isRegex ? getRegexPattern(v) : v}</span>
                <span className="ml-1 shrink-0">&times;</span>
              </Badge>
            );
          })}
          {selectedValues.length > 8 && (
            <Badge variant="outline" className="text-xs">
              +{selectedValues.length - 8} more
            </Badge>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>X-Axis</Label>
          <Select
            value={config.xAxis ?? "step"}
            onValueChange={(value) => onChange({ ...config, xAxis: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="step">Step</SelectItem>
              <SelectItem value="time">Time</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label>Aggregation</Label>
          <Select
            value={config.aggregation ?? "LAST"}
            onValueChange={(value) =>
              onChange({
                ...config,
                aggregation: value as ChartWidgetConfig["aggregation"],
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
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
            onValueChange={(value) =>
              onChange({
                ...config,
                yAxisScale: value as "linear" | "log",
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
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
            onValueChange={(value) =>
              onChange({
                ...config,
                xAxisScale: value as "linear" | "log",
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
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

// Shared metric results list used by both Search and Regex panels
function MetricResultsList({
  metrics,
  selectedValues,
  isLoading,
  emptyMessage,
  onToggle,
  onSelectAll,
  runMetricSet,
  footer,
  itemLabel = "metric",
  typeMap,
}: {
  metrics: string[];
  selectedValues: string[];
  isLoading: boolean;
  emptyMessage: string;
  onToggle: (metric: string) => void;
  onSelectAll?: () => void;
  runMetricSet?: Set<string> | null;
  footer?: React.ReactNode;
  /** Label for items (e.g., "metric" or "file") — used in "X metric(s)" count */
  itemLabel?: string;
  /** Map of name → logType for showing type icons (e.g., HISTOGRAM, IMAGE) */
  typeMap?: Map<string, string>;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          {isLoading ? "Searching..." : `${metrics.length}${metrics.length === 500 ? "+" : ""} ${itemLabel}${metrics.length !== 1 ? "s" : ""}`}
        </span>
        {onSelectAll && metrics.length > 0 && (
          <button
            className="text-xs font-medium text-primary hover:underline"
            onClick={onSelectAll}
          >
            Select all
          </button>
        )}
      </div>
      <div className="h-[200px] overflow-y-auto overflow-x-hidden">
        {isLoading && metrics.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Searching...
          </div>
        ) : metrics.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          metrics.map((metric) => {
            const notInRuns = runMetricSet != null && !runMetricSet.has(metric);
            return (
              <button
                key={metric}
                type="button"
                className="flex w-full min-w-0 items-center gap-1.5 overflow-hidden px-2 py-1.5 text-sm hover:bg-accent"
                onClick={() => onToggle(metric)}
              >
                {selectedValues.includes(metric) ? (
                  <CheckIcon className="size-3.5 shrink-0" />
                ) : typeMap?.has(metric) ? (
                  <FileTypeIcon logType={typeMap.get(metric)!} className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <LineChartIcon className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className={cn("w-0 flex-1 truncate text-left", notInRuns && "text-muted-foreground")} title={metric}>{metric}</span>
                {notInRuns && (
                  <span className="group/warn relative ml-auto shrink-0">
                    <TriangleAlertIcon className="size-3.5 text-amber-500" />
                    <span className="pointer-events-none absolute bottom-full right-0 z-[999] mb-1.5 hidden whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-hover/warn:block">
                      Not present in selected run(s)
                    </span>
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
      {footer}
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

  const { data: runMetrics } = useRunMetricNames(
    organizationId, projectName, selectedRunIds ?? []
  );

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

// Regex panel — server-side regex search with inline results
function RegexMetricPanel({
  regexPattern,
  onRegexChange,
  isInvalidRegex,
  isRegexSearching,
  regexMetrics,
  selectedValues,
  onToggle,
  onSelectAll,
  onApplyDynamic,
  itemLabel = "metric",
}: {
  regexPattern: string;
  onRegexChange: (v: string) => void;
  isInvalidRegex: boolean;
  isRegexSearching: boolean;
  regexMetrics: string[];
  selectedValues: string[];
  onToggle: (metric: string) => void;
  onSelectAll: () => void;
  onApplyDynamic: () => void;
  itemLabel?: string;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        <Label>Regex Pattern</Label>
        <Input
          placeholder="e.g., (train|eval)/.+, .*loss.*"
          value={regexPattern}
          onChange={(e) => onRegexChange(e.target.value)}
          className={cn(isInvalidRegex && "border-destructive text-destructive")}
        />
      </div>

      {regexPattern.trim() && !isInvalidRegex && (
        <MetricResultsList
          metrics={regexMetrics}
          selectedValues={selectedValues}
          isLoading={isRegexSearching}
          emptyMessage={`No ${itemLabel}s match this pattern.`}
          onToggle={onToggle}
          onSelectAll={onSelectAll}
          itemLabel={itemLabel}
  
          footer={
            regexMetrics.length > 0 ? (
              <div className="flex items-center gap-2 border-t px-3 py-2">
                <Code2 className="size-3 shrink-0 text-muted-foreground" />
                <span className="flex-1 text-xs text-muted-foreground">Apply as dynamic pattern</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-3 text-xs"
                  onClick={onApplyDynamic}
                  disabled={selectedValues.includes(makeRegexValue(regexPattern.trim()))}
                >
                  {selectedValues.includes(makeRegexValue(regexPattern.trim())) ? "Applied" : "Apply"}
                </Button>
              </div>
            ) : undefined
          }
        />
      )}

      {isInvalidRegex && regexPattern.trim() && (
        <p className="text-xs text-destructive">Invalid regex pattern.</p>
      )}
    </div>
  );
}

// Helper icon for file log types
function FileTypeIcon({ logType, className }: { logType: string; className?: string }) {
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

// Files configuration form with Search / Regex tabs (mirrors ChartConfigForm)
function FilesConfigForm({
  config,
  onChange,
  organizationId,
  projectName,
  selectedRunIds,
}: {
  config: Partial<FileGroupWidgetConfig>;
  onChange: (config: Partial<FileGroupWidgetConfig>) => void;
  organizationId: string;
  projectName: string;
  selectedRunIds?: string[];
}) {
  const [fileMode, setFileMode] = useState<"search" | "regex">("search");
  const [regexPattern, setRegexPattern] = useState("");
  const [debouncedRegex, setDebouncedRegex] = useState("");
  const [isInvalidRegex, setIsInvalidRegex] = useState(false);

  // Debounce regex input for backend query
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

  // Validate regex client-side
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

  // Backend regex search via PostgreSQL ~
  const { data: regexResults, isFetching: isRegexSearching } =
    useRegexSearchFileLogNames(organizationId, projectName, debouncedRegex);

  const regexFiles = useMemo(() => {
    const backendFiles = regexResults?.files?.map((f) => f.logName) ?? [];
    if (!debouncedRegex) return backendFiles;
    // Test synthetic entries against the regex client-side
    try {
      const re = new RegExp(debouncedRegex);
      const syntheticMatches = SYNTHETIC_CONSOLE_ENTRIES
        .filter((e) => re.test(e.logName))
        .map((e) => e.logName);
      return [...syntheticMatches, ...backendFiles];
    } catch { return backendFiles; }
  }, [regexResults, debouncedRegex]);
  const regexTypeMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of SYNTHETIC_CONSOLE_ENTRIES) { map.set(e.logName, e.logType); }
    for (const f of regexResults?.files ?? []) { map.set(f.logName, f.logType); }
    return map;
  }, [regexResults]);

  const selectedValues = config.files ?? [];

  const handleToggle = (file: string) => {
    const current = config.files ?? [];
    if (current.includes(file)) {
      onChange({ ...config, files: current.filter((f) => f !== file) });
    } else {
      onChange({ ...config, files: [...current, file] });
    }
  };

  const handleRegexSelectAll = () => {
    const current = new Set(config.files ?? []);
    for (const f of regexFiles) { current.add(f); }
    onChange({ ...config, files: Array.from(current) });
  };

  const handleApplyRegexDynamic = () => {
    const trimmed = regexPattern.trim();
    if (!trimmed || isInvalidRegex) return;
    const regexVal = makeRegexValue(trimmed);
    const current = config.files ?? [];
    if (!current.includes(regexVal)) {
      onChange({ ...config, files: [...current, regexVal] });
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label>File Selection Mode</Label>
        <Tabs value={fileMode} onValueChange={(v) => setFileMode(v as "search" | "regex")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="search">Search</TabsTrigger>
            <TabsTrigger value="regex">Regex</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {fileMode === "search" ? (
        <SearchFilePanel
          organizationId={organizationId}
          projectName={projectName}
          selectedRunIds={selectedRunIds}
          selectedValues={selectedValues}
          onToggle={handleToggle}
          onSelectAll={(files) => {
            const current = new Set(selectedValues);
            for (const f of files) { current.add(f); }
            onChange({ ...config, files: Array.from(current) });
          }}
          onApplyGlob={(pattern) => {
            const globVal = makeGlobValue(pattern);
            if (!selectedValues.includes(globVal)) {
              onChange({ ...config, files: [...selectedValues, globVal] });
            }
          }}
        />
      ) : (
        <RegexMetricPanel
          regexPattern={regexPattern}
          onRegexChange={setRegexPattern}
          isInvalidRegex={isInvalidRegex}
          isRegexSearching={isRegexSearching}
          regexMetrics={regexFiles}
          selectedValues={selectedValues}
          onToggle={handleToggle}
          onSelectAll={handleRegexSelectAll}
          onApplyDynamic={handleApplyRegexDynamic}
          itemLabel="file"
        />
      )}

      {/* Selected files badges (shown in both modes) */}
      {selectedValues.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedValues.slice(0, 8).map((v) => {
            const isGlobVal = isGlobValue(v);
            const isRegex = isRegexValue(v);
            const isDynamic = isGlobVal || isRegex;
            return (
              <Badge
                key={v}
                variant={isDynamic ? "default" : "secondary"}
                className={cn(
                  "max-w-[220px] cursor-pointer text-xs",
                  isDynamic && "bg-primary/90 text-primary-foreground"
                )}
                title={isGlobVal ? getGlobPattern(v) : isRegex ? getRegexPattern(v) : v}
                onClick={() => {
                  onChange({ ...config, files: selectedValues.filter((f) => f !== v) });
                }}
              >
                {isGlobVal && <SparklesIcon className="mr-1 size-3 shrink-0" />}
                {isRegex && <Code2 className="mr-1 size-3 shrink-0" />}
                <span className="truncate">{isGlobVal ? getGlobPattern(v) : isRegex ? getRegexPattern(v) : v}</span>
                <span className="ml-1 shrink-0">&times;</span>
              </Badge>
            );
          })}
          {selectedValues.length > 8 && (
            <Badge variant="outline" className="text-xs">
              +{selectedValues.length - 8} more
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

// Search panel for files — fuzzy + glob search with inline results
function SearchFilePanel({
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
  onToggle: (file: string) => void;
  onSelectAll: (files: string[]) => void;
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

  const { data: initialFiles, isLoading: isLoadingInitial } =
    useDistinctFileLogNames(organizationId, projectName);

  const { data: runFiles } = useRunFileLogNames(
    organizationId, projectName, selectedRunIds ?? []
  );

  const runFileSet = useMemo(() => {
    if (!runFiles?.files) return null;
    const set = new Set(runFiles.files.map((f) => f.logName));
    for (const e of SYNTHETIC_CONSOLE_ENTRIES) { set.add(e.logName); }
    return set;
  }, [runFiles]);

  const { data: searchResults, isFetching: isSearching } =
    useSearchFileLogNames(organizationId, projectName, debouncedSearch);

  // Build type map from all sources (+ synthetic console entries)
  const typeMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of SYNTHETIC_CONSOLE_ENTRIES) { map.set(f.logName, f.logType); }
    for (const f of initialFiles?.files ?? []) { map.set(f.logName, f.logType); }
    for (const f of searchResults?.files ?? []) { map.set(f.logName, f.logType); }
    for (const f of runFiles?.files ?? []) { map.set(f.logName, f.logType); }
    return map;
  }, [initialFiles, searchResults, runFiles]);

  const filteredFiles = useMemo(() => {
    const syntheticNames = SYNTHETIC_CONSOLE_ENTRIES.map((e) => e.logName);
    const initial = (initialFiles?.files ?? []).map((f) => f.logName);
    const searched = (searchResults?.files ?? []).map((f) => f.logName);
    const merged = Array.from(new Set([...syntheticNames, ...searched, ...initial]));
    const trimmed = search.trim();
    if (!trimmed) return merged.sort((a, b) => a.localeCompare(b));
    if (isGlob) {
      try {
        const regex = globToRegex(trimmed);
        return merged.filter((m) => regex.test(m)).sort((a, b) => a.localeCompare(b));
      } catch { return []; }
    }
    return fuzzyFilter(merged, search);
  }, [initialFiles, searchResults, search, isGlob]);

  const isLoading = isLoadingInitial || isSearching;

  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        <Label>Search Files</Label>
        <Input
          placeholder="Search files... (use * or ? for glob patterns)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Fuzzy text search. Use <code>*</code> / <code>?</code> for glob patterns (e.g., <code>distributions/*</code>).
        </p>
      </div>
      <MetricResultsList
        metrics={filteredFiles}
        selectedValues={selectedValues}
        isLoading={isLoading}
        emptyMessage="No files found."
        itemLabel="file"
        typeMap={typeMap}
        onToggle={onToggle}
        onSelectAll={() => onSelectAll(filteredFiles)}
        runMetricSet={runFileSet}

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

