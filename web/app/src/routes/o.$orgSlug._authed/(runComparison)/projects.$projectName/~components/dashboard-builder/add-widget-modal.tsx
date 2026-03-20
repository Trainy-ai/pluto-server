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
import { LineChartIcon, BarChart3Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChartConfigForm } from "./chart-config-form";
import { FilesConfigForm } from "./files-config-form";
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
  const [unifiedTab, setUnifiedTab] = useState<"metrics" | "files" | null>(
    editWidget ? toUnifiedSubTab(editWidget.type) : null
  );
  const [config, setConfig] = useState<Partial<WidgetConfig>>(() => {
    if (!editWidget) return {};
    if (editWidget.type === "histogram") {
      const hc = editWidget.config as { metric?: string };
      return { files: hc.metric ? [hc.metric] : [] } as FileGroupWidgetConfig;
    }
    return editWidget.config;
  });
  const [title, setTitle] = useState(editWidget?.config.title ?? "");

  const isEditing = !!editWidget;

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

  const resolvedWidgetType = useMemo((): WidgetType | null => {
    if (!unifiedTab) return null;
    return unifiedTab === "metrics" ? "chart" : "file-group";
  }, [unifiedTab]);

  const handleUnifiedTabChange = (tab: "metrics" | "files") => {
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
    } else {
      setConfig({ files: [] } as FileGroupWidgetConfig);
    }
  };

  const handleAdd = () => {
    if (!resolvedWidgetType) return;
    const finalConfig = { ...config, title: title || undefined };
    onAdd({
      type: resolvedWidgetType,
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
