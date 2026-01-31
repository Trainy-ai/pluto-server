import { useState, useMemo } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LineChartIcon,
  ScatterChartIcon,
  HashIcon,
  BarChart3Icon,
  FileTextIcon,
  ImageIcon,
  ArrowLeftIcon,
} from "lucide-react";
import { MetricSelector } from "./metric-selector";
import { extractMetricNames, matchMetricsByPattern } from "./pattern-matching-utils";
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
  editWidget?: Widget;
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
  editWidget,
}: AddWidgetModalProps) {
  const [step, setStep] = useState<"type" | "config">(editWidget ? "config" : "type");
  const [selectedType, setSelectedType] = useState<WidgetType | null>(
    editWidget?.type ?? null
  );
  const [config, setConfig] = useState<Partial<WidgetConfig>>(
    editWidget?.config ?? {}
  );
  const [title, setTitle] = useState(editWidget?.config.title ?? "");

  // Pattern mode state for chart widgets
  const [metricMode, setMetricMode] = useState<"specific" | "pattern">("specific");
  const [pattern, setPattern] = useState("");

  const isEditing = !!editWidget;

  // Compute all available metric names from groupedMetrics
  const allMetricNames = useMemo(
    () => extractMetricNames(groupedMetrics),
    [groupedMetrics]
  );

  // Compute matching metrics based on pattern
  const matchingMetrics = useMemo(
    () => matchMetricsByPattern(pattern, allMetricNames),
    [pattern, allMetricNames]
  );

  const handleTypeSelect = (type: WidgetType) => {
    setSelectedType(type);
    // Reset pattern mode when switching types
    setMetricMode("specific");
    setPattern("");
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

    // Handle pattern mode for chart widgets - create multiple widgets
    if (selectedType === "chart" && metricMode === "pattern" && matchingMetrics.length > 0) {
      const chartConfig = config as ChartWidgetConfig;

      // Create a widget for each matching metric
      matchingMetrics.forEach((metricName, index) => {
        const widgetConfig: ChartWidgetConfig = {
          ...chartConfig,
          metrics: [metricName],
          title: title ? `${title} - ${metricName}` : metricName,
        };

        onAdd({
          type: "chart",
          config: widgetConfig,
          layout: {
            x: (index % 2) * 6, // Alternate between left and right columns
            y: Infinity, // Will be placed at the bottom
            w: 6,
            h: 4,
          },
        });
      });
    } else {
      // Standard single widget creation
      const finalConfig = { ...config, title: title || undefined };

      onAdd({
        type: selectedType,
        config: finalConfig as WidgetConfig,
        layout: editWidget?.layout ?? {
          x: 0,
          y: Infinity, // Will be placed at the bottom
          w: selectedType === "single-value" ? 3 : 6,
          h: selectedType === "single-value" ? 2 : 4,
        },
      });
    }

    // Reset state
    setStep("type");
    setSelectedType(null);
    setConfig({});
    setTitle("");
    setMetricMode("specific");
    setPattern("");
    onOpenChange(false);
  };

  const handleClose = () => {
    setStep("type");
    setSelectedType(null);
    setConfig({});
    setTitle("");
    setMetricMode("specific");
    setPattern("");
    onOpenChange(false);
  };

  const canAdd = useMemo(() => {
    if (!selectedType) return false;

    switch (selectedType) {
      case "chart": {
        // In pattern mode, check if there are matching metrics
        if (metricMode === "pattern") {
          return matchingMetrics.length > 0;
        }
        // In specific mode, check if a metric is selected
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
  }, [selectedType, config, metricMode, matchingMetrics]);

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
                groupedMetrics={groupedMetrics}
                metricMode={metricMode}
                onModeChange={setMetricMode}
                pattern={pattern}
                onPatternChange={setPattern}
                matchingMetrics={matchingMetrics}
              />
            )}

            {selectedType === "scatter" && (
              <ScatterConfigForm
                config={config as Partial<ScatterWidgetConfig>}
                onChange={setConfig}
                groupedMetrics={groupedMetrics}
              />
            )}

            {selectedType === "single-value" && (
              <SingleValueConfigForm
                config={config as Partial<SingleValueWidgetConfig>}
                onChange={setConfig}
                groupedMetrics={groupedMetrics}
              />
            )}

            {selectedType === "histogram" && (
              <HistogramConfigForm
                config={config as Partial<HistogramWidgetConfig>}
                onChange={setConfig}
                groupedMetrics={groupedMetrics}
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
              {isEditing
                ? "Save Changes"
                : selectedType === "chart" && metricMode === "pattern" && matchingMetrics.length > 1
                  ? `Add ${matchingMetrics.length} Widgets`
                  : "Add Widget"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Chart configuration form with specific/pattern mode
function ChartConfigForm({
  config,
  onChange,
  groupedMetrics,
  metricMode,
  onModeChange,
  pattern,
  onPatternChange,
  matchingMetrics,
}: {
  config: Partial<ChartWidgetConfig>;
  onChange: (config: Partial<ChartWidgetConfig>) => void;
  groupedMetrics: GroupedMetrics;
  metricMode: "specific" | "pattern";
  onModeChange: (mode: "specific" | "pattern") => void;
  pattern: string;
  onPatternChange: (pattern: string) => void;
  matchingMetrics: string[];
}) {
  return (
    <div className="space-y-4">
      {/* Mode Toggle */}
      <div className="grid gap-2">
        <Label>Metric Selection Mode</Label>
        <Tabs value={metricMode} onValueChange={(v) => onModeChange(v as "specific" | "pattern")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="specific">Specific Metric</TabsTrigger>
            <TabsTrigger value="pattern">Match by Pattern</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Mode-specific inputs */}
      {metricMode === "specific" ? (
        <div className="grid gap-2">
          <Label>Metric</Label>
          <MetricSelector
            groupedMetrics={groupedMetrics}
            value={config.metrics?.[0] ?? ""}
            onChange={(metric) =>
              onChange({ ...config, metrics: [metric as string] })
            }
            placeholder="Select metric..."
          />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2">
            <Label>Pattern (regex)</Label>
            <Input
              placeholder="e.g., loss.*, training/.*"
              value={pattern}
              onChange={(e) => onPatternChange(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Use regex to match metrics. Example: "loss.*" matches all metrics starting with "loss".
            </p>
          </div>

          {/* Live preview of matching metrics */}
          {pattern && (
            <div className="rounded-lg border bg-muted/50 p-3">
              <p className="mb-2 text-sm font-medium">
                Matching metrics ({matchingMetrics.length}):
              </p>
              {matchingMetrics.length === 0 ? (
                <p className="text-sm text-muted-foreground">No metrics match this pattern</p>
              ) : (
                <div className="max-h-32 overflow-y-auto">
                  <ul className="space-y-1">
                    {matchingMetrics.slice(0, 20).map((metric) => (
                      <li key={metric} className="text-sm text-muted-foreground">
                        • {metric}
                      </li>
                    ))}
                    {matchingMetrics.length > 20 && (
                      <li className="text-sm font-medium text-muted-foreground">
                        ... and {matchingMetrics.length - 20} more
                      </li>
                    )}
                  </ul>
                </div>
              )}
              {matchingMetrics.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  This will create {matchingMetrics.length} chart widget{matchingMetrics.length !== 1 ? "s" : ""}.
                </p>
              )}
            </div>
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

// Scatter plot configuration form
function ScatterConfigForm({
  config,
  onChange,
  groupedMetrics,
}: {
  config: Partial<ScatterWidgetConfig>;
  onChange: (config: Partial<ScatterWidgetConfig>) => void;
  groupedMetrics: GroupedMetrics;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label>X-Axis Metric</Label>
        <MetricSelector
          groupedMetrics={groupedMetrics}
          value={config.xMetric ?? ""}
          onChange={(metric) =>
            onChange({ ...config, xMetric: metric as string })
          }
          placeholder="Select X-axis metric..."
        />
      </div>

      <div className="grid gap-2">
        <Label>Y-Axis Metric</Label>
        <MetricSelector
          groupedMetrics={groupedMetrics}
          value={config.yMetric ?? ""}
          onChange={(metric) =>
            onChange({ ...config, yMetric: metric as string })
          }
          placeholder="Select Y-axis metric..."
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
  groupedMetrics,
}: {
  config: Partial<SingleValueWidgetConfig>;
  onChange: (config: Partial<SingleValueWidgetConfig>) => void;
  groupedMetrics: GroupedMetrics;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label>Metric</Label>
        <MetricSelector
          groupedMetrics={groupedMetrics}
          value={config.metric ?? ""}
          onChange={(metric) =>
            onChange({ ...config, metric: metric as string })
          }
          placeholder="Select metric..."
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
  groupedMetrics,
}: {
  config: Partial<HistogramWidgetConfig>;
  onChange: (config: Partial<HistogramWidgetConfig>) => void;
  groupedMetrics: GroupedMetrics;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label>Metric</Label>
        <MetricSelector
          groupedMetrics={groupedMetrics}
          value={config.metric ?? ""}
          onChange={(metric) =>
            onChange({ ...config, metric: metric as string })
          }
          placeholder="Select metric..."
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
