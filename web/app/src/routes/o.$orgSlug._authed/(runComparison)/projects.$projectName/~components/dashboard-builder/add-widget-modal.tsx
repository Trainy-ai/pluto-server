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
import { LineChartIcon, BarChart3Icon, LayersIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChartConfigForm } from "./chart-config-form";
import { FilesConfigForm } from "./files-config-form";
import { useDistinctFileLogNames } from "../../~queries/file-log-names";
import { DistributionsConfigForm } from "./distributions-config-form";
import type {
  WidgetType,
  Widget,
  WidgetConfig,
  ChartWidgetConfig,
  FileGroupWidgetConfig,
  DistributionsWidgetConfig,
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

type UnifiedTab = "metrics" | "distributions" | "files";

function toUnifiedSubTab(type: WidgetType): UnifiedTab {
  switch (type) {
    case "distributions":
      return "distributions";
    case "histogram":
    case "file-group":
      return "files";
    default:
      return "metrics";
  }
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
  const [unifiedTab, setUnifiedTab] = useState<UnifiedTab | null>(
    editWidget ? toUnifiedSubTab(editWidget.type) : null,
  );
  const [config, setConfig] = useState<Partial<WidgetConfig>>(() => {
    if (!editWidget) return {};
    if (editWidget.type === "histogram") {
      const hc = editWidget.config as { metric?: string };
      return { files: hc.metric ? [hc.metric] : [] } as FileGroupWidgetConfig;
    }
    // A string-series widget stores one `metric`; the Metrics tab's form works
    // in `metrics[]`. Convert on the way in, and handleAdd converts back.
    if (editWidget.type === "string-series") {
      const sc = editWidget.config as { metric?: string };
      return { metrics: sc.metric ? [sc.metric] : [] } as ChartWidgetConfig;
    }
    return editWidget.config;
  });
  const [title, setTitle] = useState(editWidget?.config.title ?? "");

  const isEditing = !!editWidget;

  const { data: fileLogNames, isPending: isStringMetricsPending } =
    useDistinctFileLogNames(organizationId, projectName);
  const stringMetricNames = useMemo(
    () => (fileLogNames?.files ?? []).filter((f) => f.logType === "DATA").map((f) => f.logName),
    [fileLogNames],
  );
  // Until this query settles, `stringMetricNames` is empty and every metric
  // looks numeric — adding then would silently produce a chart widget holding
  // a string metric ("No data received yet"). Settled, not successful: on
  // error we let the user through rather than disabling the button forever.
  const stringMetricsSettled = !isStringMetricsPending;

  // Which of the currently-picked metrics are string metrics. Used both to
  // decide the widget type on save and to block selections that cannot be
  // expressed as a single widget while editing.
  const pickedMetrics = useMemo(
    () => (config as ChartWidgetConfig).metrics ?? [],
    [config],
  );
  const pickedStringMetrics = useMemo(
    () => pickedMetrics.filter((m) => stringMetricNames.includes(m)),
    [pickedMetrics, stringMetricNames],
  );

  /**
   * Adding fans a mixed pick out into one widget per string metric plus one
   * chart for the numerics. Editing cannot: it replaces exactly one widget, so
   * there is nowhere for the extras to go. Rather than silently dropping them
   * — or worse, writing string metrics into a chart widget that renders "No
   * data received yet" — the save is blocked and the reason is shown.
   */
  const editSelectionUnrepresentable =
    isEditing &&
    // "metrics" is the tab that resolves to the `chart` widget type; compared
    // here rather than via resolvedWidgetType, which is declared below.
    unifiedTab === "metrics" &&
    (pickedStringMetrics.length > 1 ||
      (pickedStringMetrics.length > 0 &&
        pickedStringMetrics.length !== pickedMetrics.length));

  useEffect(() => {
    if (editWidget) {
      setUnifiedTab(toUnifiedSubTab(editWidget.type));
      if (editWidget.type === "histogram") {
        const hc = editWidget.config as { metric?: string };
        setConfig({ files: hc.metric ? [hc.metric] : [] } as FileGroupWidgetConfig);
      } else if (editWidget.type === "string-series") {
        const sc = editWidget.config as { metric?: string };
        setConfig({ metrics: sc.metric ? [sc.metric] : [] } as ChartWidgetConfig);
      } else {
        setConfig({ ...editWidget.config });
      }
      setTitle(editWidget.config.title ?? "");
    }
  }, [editWidget]);

  const resolvedWidgetType = useMemo((): WidgetType | null => {
    if (!unifiedTab) return null;
    switch (unifiedTab) {
      case "metrics":
        return "chart";
      case "distributions":
        return "distributions";
      case "files":
        return "file-group";
    }
  }, [unifiedTab]);

  const handleUnifiedTabChange = (tab: UnifiedTab) => {
    if (tab === unifiedTab) return;
    setUnifiedTab(tab);
    if (tab === "metrics") {
      setConfig({
        metrics: [],
        xAxis: "step",
        yAxisScale: "linear",
        xAxisScale: "linear",
        aggregation: "LAST",
        showOriginal: false,
      } as ChartWidgetConfig);
    } else if (tab === "distributions") {
      setConfig({ entries: [] } as DistributionsWidgetConfig);
    } else {
      setConfig({ files: [] } as FileGroupWidgetConfig);
    }
  };

  const handleAdd = () => {
    if (!resolvedWidgetType) return;
    // Defensive: canAdd already blocks both of these. Guarding here too means
    // a future caller (or an Enter keypress wired past the button) still can't
    // write string metrics into a chart widget.
    if (editSelectionUnrepresentable) return;
    if (resolvedWidgetType === "chart" && !stringMetricsSettled) return;

    let finalType = resolvedWidgetType;
    let finalConfig: Partial<WidgetConfig> = { ...config, title: title || undefined };

    // The Metrics tab lists string metrics alongside numeric ones, because
    // that is what they are. They need a different widget though: a chart
    // widget would plot a list of labels as a number line. Detected by name
    // rather than by a separate tab, so the user never has to know which kind
    // a metric is before looking for it.
    if (resolvedWidgetType === "chart") {
      const strings = pickedStringMetrics;
      const numbers = pickedMetrics.filter((m) => !stringMetricNames.includes(m));

      // Several numeric metrics share one chart because they share a y axis.
      // String metrics can't: each has its own list of labels, so two of them
      // in one widget would need two unrelated y axes. Pick 4 and you get 4
      // widgets — the alternative was one chart widget that silently rendered
      // "No data received yet", since a string metric has no rows in
      // `mlop_metrics` for a chart widget to read.
      //
      // Add-only: an edit replaces exactly one widget, so it has nowhere to
      // put the extras. `editSelectionUnrepresentable` stops such a selection
      // from reaching here, which leaves editing with at most one string
      // metric and nothing else — handled by the single-metric branch below.
      if (strings.length > 0 && !isEditing) {
        for (const metric of strings) {
          onAdd({
            type: "string-series",
            config: { metric, title: strings.length === 1 ? title || undefined : undefined } as WidgetConfig,
            layout: { x: 0, y: 9999, w: 6, h: 4 },
          });
        }
        if (numbers.length > 0) {
          onAdd({
            type: "chart",
            config: { ...(config as ChartWidgetConfig), metrics: numbers, title: title || undefined } as WidgetConfig,
            layout: { x: 0, y: 9999, w: 6, h: 4 },
          });
        }
        setUnifiedTab(null);
        setConfig({});
        setTitle("");
        onOpenChange(false);
        return;
      }

      if (pickedMetrics.length === 1 && strings.length === 1) {
        finalType = "string-series";
        finalConfig = { metric: pickedMetrics[0], title: title || undefined };
      } else if (
        // Editing a string-series widget while discovery failed/returned
        // empty: `pickedStringMetrics` is empty so the branch above misses,
        // and falling through would rewrite the widget as `chart` (numeric
        // path — "No data received yet"). Keep the known type instead.
        isEditing &&
        editWidget?.type === "string-series" &&
        pickedMetrics.length === 1 &&
        stringMetricNames.length === 0
      ) {
        finalType = "string-series";
        finalConfig = { metric: pickedMetrics[0], title: title || undefined };
      }
    }

    onAdd({
      type: finalType,
      config: finalConfig as WidgetConfig,
      layout: editWidget?.layout ?? { x: 0, y: 9999, w: 6, h: 4 },
    });
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
        if (pickedMetrics.length === 0) return false;
        // Which widget type this becomes depends on knowing which of the
        // picked metrics are string metrics, so don't let it be saved before
        // that is known, or on a selection an edit can't represent.
        return stringMetricsSettled && !editSelectionUnrepresentable;
      }
      case "distributions": {
        const distConfig = config as Partial<DistributionsWidgetConfig>;
        return !!distConfig.entries && distConfig.entries.length > 0;
      }
      case "file-group": {
        const fileGroupConfig = config as Partial<FileGroupWidgetConfig>;
        return !!fileGroupConfig.files && fileGroupConfig.files.length > 0;
      }
      default:
        return false;
    }
  }, [
    resolvedWidgetType,
    config,
    pickedMetrics,
    stringMetricsSettled,
    editSelectionUnrepresentable,
  ]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
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
          <div className="grid grid-cols-3 gap-3">
            <button
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-colors hover:bg-accent",
                unifiedTab === "metrics" && "border-primary bg-accent",
              )}
              data-testid="add-widget-tab-metrics"
              onClick={() => handleUnifiedTabChange("metrics")}
            >
              <LineChartIcon className="size-6 text-muted-foreground" />
              <div className="text-sm font-medium">Metrics</div>
              <div className="text-xs text-muted-foreground">
                Line charts from scalar metrics
              </div>
            </button>
            <button
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-colors hover:bg-accent",
                unifiedTab === "distributions" && "border-primary bg-accent",
              )}
              data-testid="add-widget-tab-distributions"
              onClick={() => handleUnifiedTabChange("distributions")}
            >
              <BarChart3Icon className="size-6 text-muted-foreground" />
              <div className="text-sm font-medium">Distributions</div>
              <div className="text-xs text-muted-foreground">
                Categorical bar charts and numeric histograms
              </div>
            </button>
            <button
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-colors hover:bg-accent",
                unifiedTab === "files" && "border-primary bg-accent",
              )}
              data-testid="add-widget-tab-files"
              onClick={() => handleUnifiedTabChange("files")}
            >
              <LayersIcon className="size-6 text-muted-foreground" />
              <div className="text-sm font-medium">Files</div>
              <div className="text-xs text-muted-foreground">
                Logs, images, videos, audio
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

              {unifiedTab === "distributions" && (
                <DistributionsConfigForm
                  config={config as Partial<DistributionsWidgetConfig>}
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

        <DialogFooter className="sm:items-center">
          {/* A disabled Save with no reason reads as a broken dialog. */}
          {editSelectionUnrepresentable && (
            <p
              className="mr-auto max-w-sm text-left text-xs text-muted-foreground"
              data-testid="add-widget-string-metric-hint"
            >
              A string metric needs its own widget, so one widget can hold either
              a single string metric or any number of numeric ones. Narrow the
              selection, or cancel and add them separately.
            </p>
          )}
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!canAdd} data-testid="add-widget-confirm">
            {isEditing ? "Save Changes" : "Add Widget"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
