import type {
  Widget,
  ChartWidgetConfig,
  HistogramWidgetConfig,
  FileGroupWidgetConfig,
  DistributionsWidgetConfig,
  HistogramViewMode,
  HistogramDepthAxis,
} from "../../~types/dashboard-types";
import type { GroupedMetrics } from "@/lib/grouping/types";
import type { SelectedRunWithColor } from "../../~hooks/use-selected-runs";
import { ChartWidget } from "./chart-widget";
import { HistogramWidget } from "./histogram-widget";
import { FileGroupWidget } from "./file-group-widget";
import { DistributionsWidget } from "./distributions-widget";

interface WidgetRendererProps {
  widget: Widget;
  groupedMetrics: GroupedMetrics;
  selectedRuns: Record<string, SelectedRunWithColor>;
  organizationId: string;
  projectName: string;
  /** When provided, reads line settings from this runId instead of the "full" key */
  settingsRunId?: string;
  /** Externally-stored Y zoom range for persistence across mini/fullscreen */
  yZoomRange?: [number, number] | null;
  /** Called when user drags to zoom Y axis, or null on reset */
  onYZoomRangeChange?: (range: [number, number] | null) => void;
  // Distributions-widget per-entry persistence. Each callback is keyed
  // by the entry's INDEX in config.entries[] — bars/histogram entries
  // are positional inside the widget and the same prefix/metric could
  // theoretically appear twice, so index-keying is the safest target.
  onUpdateDistributionsEntryViewMode?: (
    widgetId: string,
    index: number,
    mode: HistogramViewMode,
  ) => void;
  onUpdateDistributionsEntryDepthAxis?: (
    widgetId: string,
    index: number,
    axis: HistogramDepthAxis,
  ) => void;
  onUpdateDistributionsEntryBinRange?: (
    widgetId: string,
    index: number,
    range: { start: number; end: number },
  ) => void;
  onUpdateDistributionsEntryIgnoreOutliers?: (
    widgetId: string,
    index: number,
    next: boolean,
  ) => void;
  onUpdateDistributionsEntryStepsOnX?: (
    widgetId: string,
    index: number,
    next: boolean,
  ) => void;
  /** Mirror of compactBarsChrome — dynamic sections emit single-entry
   *  distributions widgets where the outer chrome owns the buttons. */
  compactDistributionsChrome?: boolean;
  /**
   * Fires from inside legacy file-group widgets once their file-type
   * query resolves with the list of HISTOGRAM-type entries. Wired only
   * from the static-section render path — dynamic-section widgets
   * pass nothing so the save handler never tries to rewrite a widget
   * that doesn't live in `section.widgets[]`. See the save-time
   * auto-lift in dashboard-builder.
   */
  onFileGroupHistogramsDetected?: (widgetId: string, fileNames: string[]) => void;
}

export function WidgetRenderer({
  widget,
  groupedMetrics,
  selectedRuns,
  organizationId,
  projectName,
  settingsRunId,
  yZoomRange,
  onYZoomRangeChange,
  onUpdateDistributionsEntryViewMode,
  onUpdateDistributionsEntryDepthAxis,
  onUpdateDistributionsEntryBinRange,
  onUpdateDistributionsEntryIgnoreOutliers,
  onUpdateDistributionsEntryStepsOnX,
  compactDistributionsChrome,
  onFileGroupHistogramsDetected,
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
          settingsRunId={settingsRunId}
          yZoomRange={yZoomRange}
          onYZoomRangeChange={onYZoomRangeChange}
        />
      );
    case "histogram":
      // LEGACY PARSE ONLY. Standalone histogram widgets get migrated to
      // distributions on read (see migrateStandaloneHistogram in
      // use-dashboard-config), so the UI never persists this shape
      // anymore. This case stays as a render-time safety net while
      // dashboards still in the wild carry the old type; once every
      // dashboard has been opened-and-resaved, drop this whole case,
      // the `histogram` enum entry, and HistogramWidget itself.
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
          onHistogramsDetected={
            onFileGroupHistogramsDetected
              ? (fileNames) =>
                  onFileGroupHistogramsDetected(widget.id, fileNames)
              : undefined
          }
        />
      );
    case "distributions":
      return (
        <DistributionsWidget
          config={widget.config as DistributionsWidgetConfig}
          selectedRuns={selectedRuns}
          organizationId={organizationId}
          projectName={projectName}
          onEntryViewModeChange={
            onUpdateDistributionsEntryViewMode
              ? (idx, mode) =>
                  onUpdateDistributionsEntryViewMode(widget.id, idx, mode)
              : undefined
          }
          onEntryDepthAxisChange={
            onUpdateDistributionsEntryDepthAxis
              ? (idx, axis) =>
                  onUpdateDistributionsEntryDepthAxis(widget.id, idx, axis)
              : undefined
          }
          onEntryBinRangeChange={
            onUpdateDistributionsEntryBinRange
              ? (idx, range) =>
                  onUpdateDistributionsEntryBinRange(widget.id, idx, range)
              : undefined
          }
          onEntryIgnoreOutliersChange={
            onUpdateDistributionsEntryIgnoreOutliers
              ? (idx, next) =>
                  onUpdateDistributionsEntryIgnoreOutliers(
                    widget.id,
                    idx,
                    next,
                  )
              : undefined
          }
          onEntryStepsOnXChange={
            onUpdateDistributionsEntryStepsOnX
              ? (idx, next) =>
                  onUpdateDistributionsEntryStepsOnX(widget.id, idx, next)
              : undefined
          }
          compactChrome={compactDistributionsChrome}
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
