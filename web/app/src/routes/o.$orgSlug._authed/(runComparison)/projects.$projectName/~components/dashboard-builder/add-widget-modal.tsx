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
  ScatterChartIcon,
  HashIcon,
  BarChart3Icon,
  FileTextIcon,
  ImageIcon,
  ArrowLeftIcon,
  Loader2Icon,
  CheckIcon,
  Code2,
  SparklesIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { MetricSelector } from "./metric-selector";
import { makeRegexValue, makeGlobValue, isGlobValue, getGlobPattern, isRegexValue, getRegexPattern, isPatternValue, globToRegex } from "./glob-utils";
import { useDistinctMetricNames, useRunMetricNames, useSearchMetricNames, useRegexSearchMetricNames } from "../../~queries/metric-summaries";
import { fuzzyFilter } from "@/lib/fuzzy-search";
import type { GroupedMetrics } from "@/lib/grouping/types";
import type {
  WidgetType,
  Widget,
  WidgetConfig,
  ChartWidgetConfig,
  ScatterWidgetConfig,
  SingleValueWidgetConfig,
  HistogramWidgetConfig,
  LogsWidgetConfig,
  FileSeriesWidgetConfig,
} from "../../~types/dashboard-types";

interface AddWidgetModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (widget: Omit<Widget, "id">) => void;
  groupedMetrics: GroupedMetrics;
  organizationId: string;
  projectName: string;
  editWidget?: Widget;
  /** Selected run IDs (SQID) for "not present" warnings in metric selector */
  selectedRunIds?: string[];
}

const WIDGET_TYPES: {
  type: WidgetType;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    type: "chart",
    label: "Chart",
    description: "Line graph to visualize metrics against time",
    icon: LineChartIcon,
  },
  {
    type: "scatter",
    label: "Scatter Plot",
    description: "Visualize the relationship between metrics",
    icon: ScatterChartIcon,
  },
  {
    type: "single-value",
    label: "Single Value",
    description: "Visualize any single value (float, string)",
    icon: HashIcon,
  },
  {
    type: "histogram",
    label: "Histogram",
    description: "Visualize distributions across steps",
    icon: BarChart3Icon,
  },
  {
    type: "logs",
    label: "Logs",
    description: "Display string series",
    icon: FileTextIcon,
  },
  {
    type: "file-series",
    label: "File Series",
    description: "Visualize a file at different steps",
    icon: ImageIcon,
  },
];


export function AddWidgetModal({
  open,
  onOpenChange,
  onAdd,
  groupedMetrics,
  organizationId,
  projectName,
  editWidget,
  selectedRunIds,
}: AddWidgetModalProps) {
  const [step, setStep] = useState<"type" | "config">(editWidget ? "config" : "type");
  const [selectedType, setSelectedType] = useState<WidgetType | null>(
    editWidget?.type ?? null
  );
  const [config, setConfig] = useState<Partial<WidgetConfig>>(
    editWidget?.config ?? {}
  );
  const [title, setTitle] = useState(editWidget?.config.title ?? "");

  const isEditing = !!editWidget;

  const handleTypeSelect = (type: WidgetType) => {
    setSelectedType(type);
    // Initialize default config based on type
    switch (type) {
      case "chart":
        setConfig({
          metrics: [],
          xAxis: "step",
          yAxisScale: "linear",
          xAxisScale: "linear",
          aggregation: "LAST",
          showOriginal: false,
        } as ChartWidgetConfig);
        break;
      case "scatter":
        setConfig({
          xMetric: "",
          yMetric: "",
          xScale: "linear",
          yScale: "linear",
          xAggregation: "LAST",
          yAggregation: "LAST",
        } as ScatterWidgetConfig);
        break;
      case "single-value":
        setConfig({
          metric: "",
          aggregation: "LAST",
        } as SingleValueWidgetConfig);
        break;
      case "histogram":
        setConfig({
          metric: "",
          bins: 50,
          step: "last",
        } as HistogramWidgetConfig);
        break;
      case "logs":
        setConfig({
          logName: "",
          maxLines: 100,
        });
        break;
      case "file-series":
        setConfig({
          logName: "",
          mediaType: "IMAGE",
        } as FileSeriesWidgetConfig);
        break;
    }
    setStep("config");
  };

  const handleAdd = () => {
    if (!selectedType) return;

    const finalConfig = { ...config, title: title || undefined };

    onAdd({
      type: selectedType,
      config: finalConfig as WidgetConfig,
      layout: editWidget?.layout ?? {
        x: 0,
        y: 9999, // Large value — react-grid-layout's compactor will place it at the bottom
        w: selectedType === "single-value" ? 3 : 6,
        h: selectedType === "single-value" ? 2 : 4,
      },
    });

    // Reset state
    setStep("type");
    setSelectedType(null);
    setConfig({});
    setTitle("");
    onOpenChange(false);
  };

  const handleClose = () => {
    setStep("type");
    setSelectedType(null);
    setConfig({});
    setTitle("");
    onOpenChange(false);
  };

  const canAdd = useMemo(() => {
    if (!selectedType) return false;

    switch (selectedType) {
      case "chart": {
        const chartConfig = config as ChartWidgetConfig;
        return chartConfig.metrics && chartConfig.metrics.length > 0;
      }
      case "scatter": {
        const scatterConfig = config as ScatterWidgetConfig;
        return !!scatterConfig.xMetric && !!scatterConfig.yMetric;
      }
      case "single-value":
      case "histogram": {
        const metricConfig = config as { metric?: string };
        return !!metricConfig.metric;
      }
      case "logs": {
        const logsConfig = config as { logName?: string };
        return !!logsConfig.logName;
      }
      case "file-series": {
        const fileConfig = config as Partial<FileSeriesWidgetConfig>;
        return !!fileConfig.logName && !!fileConfig.mediaType;
      }
      default:
        return false;
    }
  }, [selectedType, config]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Widget" : step === "type" ? "Choose Widget Type" : "Configure Widget"}
          </DialogTitle>
          <DialogDescription>
            {step === "type"
              ? "Select the type of widget you want to add to your dashboard."
              : "Configure the widget settings and select the metrics to display."}
          </DialogDescription>
        </DialogHeader>

        {step === "type" ? (
          <div className="grid grid-cols-3 gap-4 py-4">
            {WIDGET_TYPES.map((widget) => (
              <button
                key={widget.type}
                className="flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors hover:bg-accent"
                onClick={() => handleTypeSelect(widget.type)}
              >
                <widget.icon className="size-8 text-muted-foreground" />
                <div className="font-medium">{widget.label}</div>
                <div className="text-xs text-muted-foreground">
                  {widget.description}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-6 py-4">
            {!isEditing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep("type")}
                className="mb-2"
              >
                <ArrowLeftIcon className="mr-2 size-4" />
                Back to Widget Types
              </Button>
            )}

            {/* Common title field */}
            <div className="grid gap-2">
              <Label htmlFor="title">Widget Title (optional)</Label>
              <Input
                id="title"
                placeholder="Enter widget title..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {/* Type-specific configuration */}
            {selectedType === "chart" && (
              <ChartConfigForm
                config={config as Partial<ChartWidgetConfig>}
                onChange={setConfig}
                organizationId={organizationId}
                projectName={projectName}
                selectedRunIds={selectedRunIds}
              />
            )}

            {selectedType === "scatter" && (
              <ScatterConfigForm
                config={config as Partial<ScatterWidgetConfig>}
                onChange={setConfig}
                organizationId={organizationId}
                projectName={projectName}
                selectedRunIds={selectedRunIds}
              />
            )}

            {selectedType === "single-value" && (
              <SingleValueConfigForm
                config={config as Partial<SingleValueWidgetConfig>}
                onChange={setConfig}
                organizationId={organizationId}
                projectName={projectName}
                selectedRunIds={selectedRunIds}
              />
            )}

            {selectedType === "histogram" && (
              <HistogramConfigForm
                config={config as Partial<HistogramWidgetConfig>}
                onChange={setConfig}
                organizationId={organizationId}
                projectName={projectName}
                selectedRunIds={selectedRunIds}
              />
            )}

            {selectedType === "logs" && (
              <LogsConfigForm
                config={config as Partial<LogsWidgetConfig>}
                onChange={setConfig}
              />
            )}

            {selectedType === "file-series" && (
              <FileSeriesConfigForm
                config={config as Partial<FileSeriesWidgetConfig>}
                onChange={setConfig}
                groupedMetrics={groupedMetrics}
              />
            )}
          </div>
        )}

        {step === "config" && (
          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={!canAdd}>
              {isEditing ? "Save Changes" : "Add Widget"}
            </Button>
          </DialogFooter>
        )}
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
                  "cursor-pointer text-xs",
                  isDynamic && "bg-primary/90 text-primary-foreground"
                )}
                onClick={() => {
                  onChange({ ...config, metrics: selectedValues.filter((m) => m !== v) });
                }}
              >
                {isGlobVal && <SparklesIcon className="mr-1 size-3" />}
                {isRegex && <Code2 className="mr-1 size-3" />}
                {isGlobVal ? getGlobPattern(v) : isRegex ? getRegexPattern(v) : v}
                <span className="ml-1">&times;</span>
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
}: {
  metrics: string[];
  selectedValues: string[];
  isLoading: boolean;
  emptyMessage: string;
  onToggle: (metric: string) => void;
  onSelectAll?: () => void;
  runMetricSet?: Set<string> | null;
  footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          {isLoading ? "Searching..." : `${metrics.length} metric${metrics.length !== 1 ? "s" : ""}`}
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
      <div className="max-h-[200px] overflow-y-auto">
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
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
                onClick={() => onToggle(metric)}
              >
                <CheckIcon
                  className={cn(
                    "size-4 shrink-0",
                    selectedValues.includes(metric) ? "opacity-100" : "opacity-0"
                  )}
                />
                <span className={cn("truncate", notInRuns && "text-muted-foreground")}>{metric}</span>
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
          emptyMessage="No metrics match this pattern."
          onToggle={onToggle}
          onSelectAll={onSelectAll}
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

// Scatter plot configuration form
function ScatterConfigForm({
  config,
  onChange,
  organizationId,
  projectName,
  selectedRunIds,
}: {
  config: Partial<ScatterWidgetConfig>;
  onChange: (config: Partial<ScatterWidgetConfig>) => void;
  organizationId: string;
  projectName: string;
  selectedRunIds?: string[];
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label>X-Axis Metric</Label>
        <MetricSelector
          organizationId={organizationId}
          projectName={projectName}
          value={config.xMetric ?? ""}
          onChange={(metric) =>
            onChange({ ...config, xMetric: metric as string })
          }
          placeholder="Select X-axis metric..."
          selectedRunIds={selectedRunIds}
        />
      </div>

      <div className="grid gap-2">
        <Label>Y-Axis Metric</Label>
        <MetricSelector
          organizationId={organizationId}
          projectName={projectName}
          value={config.yMetric ?? ""}
          onChange={(metric) =>
            onChange({ ...config, yMetric: metric as string })
          }
          placeholder="Select Y-axis metric..."
          selectedRunIds={selectedRunIds}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>X-Axis Scale</Label>
          <Select
            value={config.xScale ?? "linear"}
            onValueChange={(value) =>
              onChange({ ...config, xScale: value as "linear" | "log" })
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
          <Label>Y-Axis Scale</Label>
          <Select
            value={config.yScale ?? "linear"}
            onValueChange={(value) =>
              onChange({ ...config, yScale: value as "linear" | "log" })
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

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>X-Axis Aggregation</Label>
          <Select
            value={config.xAggregation ?? "LAST"}
            onValueChange={(value) =>
              onChange({
                ...config,
                xAggregation: value as ScatterWidgetConfig["xAggregation"],
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
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label>Y-Axis Aggregation</Label>
          <Select
            value={config.yAggregation ?? "LAST"}
            onValueChange={(value) =>
              onChange({
                ...config,
                yAggregation: value as ScatterWidgetConfig["yAggregation"],
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
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

// Single value configuration form
function SingleValueConfigForm({
  config,
  onChange,
  organizationId,
  projectName,
  selectedRunIds,
}: {
  config: Partial<SingleValueWidgetConfig>;
  onChange: (config: Partial<SingleValueWidgetConfig>) => void;
  organizationId: string;
  projectName: string;
  selectedRunIds?: string[];
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label>Metric</Label>
        <MetricSelector
          organizationId={organizationId}
          projectName={projectName}
          value={config.metric ?? ""}
          onChange={(metric) =>
            onChange({ ...config, metric: metric as string })
          }
          placeholder="Select metric..."
          selectedRunIds={selectedRunIds}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Aggregation</Label>
          <Select
            value={config.aggregation ?? "LAST"}
            onValueChange={(value) =>
              onChange({
                ...config,
                aggregation: value as SingleValueWidgetConfig["aggregation"],
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

        <div className="grid gap-2">
          <Label>Format (optional)</Label>
          <Input
            placeholder="e.g., 0.0000"
            value={config.format ?? ""}
            onChange={(e) => onChange({ ...config, format: e.target.value || undefined })}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Prefix (optional)</Label>
          <Input
            placeholder="e.g., $"
            value={config.prefix ?? ""}
            onChange={(e) => onChange({ ...config, prefix: e.target.value || undefined })}
          />
        </div>

        <div className="grid gap-2">
          <Label>Suffix (optional)</Label>
          <Input
            placeholder="e.g., %"
            value={config.suffix ?? ""}
            onChange={(e) => onChange({ ...config, suffix: e.target.value || undefined })}
          />
        </div>
      </div>
    </div>
  );
}

// Histogram configuration form
function HistogramConfigForm({
  config,
  onChange,
  organizationId,
  projectName,
  selectedRunIds,
}: {
  config: Partial<HistogramWidgetConfig>;
  onChange: (config: Partial<HistogramWidgetConfig>) => void;
  organizationId: string;
  projectName: string;
  selectedRunIds?: string[];
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label>Metric</Label>
        <MetricSelector
          organizationId={organizationId}
          projectName={projectName}
          value={config.metric ?? ""}
          onChange={(metric) =>
            onChange({ ...config, metric: metric as string })
          }
          placeholder="Select metric..."
          selectedRunIds={selectedRunIds}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Number of Bins</Label>
          <Input
            type="number"
            min={10}
            max={200}
            value={config.bins ?? 50}
            onChange={(e) =>
              onChange({ ...config, bins: parseInt(e.target.value) || 50 })
            }
          />
        </div>

        <div className="grid gap-2">
          <Label>Step</Label>
          <Select
            value={config.step ?? "last"}
            onValueChange={(value) =>
              onChange({
                ...config,
                step: value as HistogramWidgetConfig["step"],
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="first">First</SelectItem>
              <SelectItem value="last">Last</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

// Logs configuration form
function LogsConfigForm({
  config,
  onChange,
}: {
  config: Partial<LogsWidgetConfig>;
  onChange: (config: Partial<LogsWidgetConfig>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label>Log Name</Label>
        <Input
          placeholder="Enter log name..."
          value={config.logName ?? ""}
          onChange={(e) => onChange({ ...config, logName: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          The name of the log stream to display.
        </p>
      </div>

      <div className="grid gap-2">
        <Label>Max Lines</Label>
        <Input
          type="number"
          min={10}
          max={1000}
          value={config.maxLines ?? 100}
          onChange={(e) =>
            onChange({ ...config, maxLines: parseInt(e.target.value) || 100 })
          }
        />
        <p className="text-xs text-muted-foreground">
          Maximum number of log lines to display (10-1000).
        </p>
      </div>
    </div>
  );
}

// File series configuration form
function FileSeriesConfigForm({
  config,
  onChange,
  groupedMetrics,
}: {
  config: Partial<FileSeriesWidgetConfig>;
  onChange: (config: Partial<FileSeriesWidgetConfig>) => void;
  groupedMetrics: GroupedMetrics;
}) {
  // Extract available media logs from groupedMetrics
  const mediaLogs = useMemo(() => {
    const logs: Array<{ logName: string; mediaType: "IMAGE" | "VIDEO" | "AUDIO"; groupName: string }> = [];

    for (const [groupName, group] of Object.entries(groupedMetrics)) {
      for (const metric of group.metrics) {
        if (metric.type === "IMAGE" || metric.type === "VIDEO" || metric.type === "AUDIO") {
          logs.push({
            logName: metric.name,
            mediaType: metric.type,
            groupName: groupName,
          });
        }
      }
    }

    return logs;
  }, [groupedMetrics]);

  const selectedLog = mediaLogs.find(
    (log) => log.logName === config.logName && log.mediaType === config.mediaType
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label>Media Log</Label>
        {mediaLogs.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-center text-muted-foreground">
            <ImageIcon className="mx-auto mb-2 size-8" />
            <p className="text-sm">No media logs found</p>
            <p className="text-xs mt-1">
              Media logs are created when you log images, videos, or audio files to your runs.
            </p>
          </div>
        ) : (
          <Select
            value={selectedLog ? `${selectedLog.mediaType}:${selectedLog.logName}` : ""}
            onValueChange={(value) => {
              const [mediaType, ...nameParts] = value.split(":");
              const logName = nameParts.join(":"); // Handle colons in log names
              onChange({
                ...config,
                logName,
                mediaType: mediaType as "IMAGE" | "VIDEO" | "AUDIO",
              });
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select media log..." />
            </SelectTrigger>
            <SelectContent>
              {mediaLogs.map((log) => (
                <SelectItem
                  key={`${log.mediaType}:${log.logName}`}
                  value={`${log.mediaType}:${log.logName}`}
                >
                  <div className="flex items-center gap-2">
                    {log.mediaType === "IMAGE" && <ImageIcon className="size-4" />}
                    {log.mediaType === "VIDEO" && <FileTextIcon className="size-4" />}
                    {log.mediaType === "AUDIO" && <FileTextIcon className="size-4" />}
                    <span>{log.groupName ? `${log.groupName}/${log.logName}` : log.logName}</span>
                    <span className="text-xs text-muted-foreground">({log.mediaType.toLowerCase()})</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <p className="text-xs text-muted-foreground">
          Select a media log to display images, videos, or audio files across steps.
        </p>
      </div>
    </div>
  );
}
