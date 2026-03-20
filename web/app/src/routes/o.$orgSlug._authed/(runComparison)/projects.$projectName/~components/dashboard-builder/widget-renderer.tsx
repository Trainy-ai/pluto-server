import type {
  Widget,
  ChartWidgetConfig,
  HistogramWidgetConfig,
  FileGroupWidgetConfig,
} from "../../~types/dashboard-types";
import type { GroupedMetrics } from "@/lib/grouping/types";
import type { SelectedRunWithColor } from "../../~hooks/use-selected-runs";
import { ChartWidget } from "./chart-widget";
import { HistogramWidget } from "./histogram-widget";
import { FileGroupWidget } from "./file-group-widget";

interface WidgetRendererProps {
  widget: Widget;
  groupedMetrics: GroupedMetrics;
  selectedRuns: Record<string, SelectedRunWithColor>;
  organizationId: string;
  projectName: string;
  /** Callback fired when chart data range is computed (for clipping detection) */
  onDataRange?: (dataMin: number, dataMax: number) => void;
  /** Callback fired on double-click to reset Y-axis bounds for this chart */
  onResetBounds?: () => void;
  /** When provided, reads line settings from this runId instead of the "full" key */
  settingsRunId?: string;
  /** Externally-stored Y zoom range for persistence across mini/fullscreen */
  yZoomRange?: [number, number] | null;
  /** Called when user drags to zoom Y axis, or null on reset */
  onYZoomRangeChange?: (range: [number, number] | null) => void;
}

export function WidgetRenderer({
  widget,
  groupedMetrics,
  selectedRuns,
  organizationId,
  projectName,
  onDataRange,
  onResetBounds,
  settingsRunId,
  yZoomRange,
  onYZoomRangeChange,
}: WidgetRendererProps) {
  switch (widget.type) {
    case "chart":
      return (
        <ChartWidget
          config={widget.config as ChartWidgetConfig}
          groupedMetrics={groupedMetrics}
          selectedRuns={selectedRuns}
          organizationId={organizationId}
          projectName={projectName}
          onDataRange={onDataRange}
          onResetBounds={onResetBounds}
          settingsRunId={settingsRunId}
          yZoomRange={yZoomRange}
          onYZoomRangeChange={onYZoomRangeChange}
        />
      );
    case "histogram":
      return (
        <HistogramWidget
          config={widget.config as HistogramWidgetConfig}
          selectedRuns={selectedRuns}
          organizationId={organizationId}
          projectName={projectName}
        />
      );
    case "file-group":
      return (
        <FileGroupWidget
          config={widget.config as FileGroupWidgetConfig}
          selectedRuns={selectedRuns}
          organizationId={organizationId}
          projectName={projectName}
        />
      );
    default:
      return (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          Unknown widget type
        </div>
      );
  }
}
