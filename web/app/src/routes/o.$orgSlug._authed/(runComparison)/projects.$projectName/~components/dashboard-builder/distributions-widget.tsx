import { useMemo } from "react";
import type {
  DistributionsWidgetConfig,
  DistributionsEntry,
  HistogramViewMode,
  HistogramDepthAxis,
} from "../../~types/dashboard-types";
import type { SelectedRunWithColor } from "../../~hooks/use-selected-runs";
import { MultiRunCategoricalView } from "../multi-group/categorical-view";
import { MultiHistogramView } from "../multi-group/histogram-view";
import { useHiddenRunIds } from "@/hooks/use-hidden-run-ids";
import { formatRunLabel } from "@/lib/format-run-label";
import { getDisplayIdForRun } from "../../~lib/metrics-utils";

interface DistributionsWidgetProps {
  config: DistributionsWidgetConfig;
  selectedRuns: Record<string, SelectedRunWithColor>;
  organizationId: string;
  projectName: string;
  // Persistence callbacks keyed by entry INDEX. Index-keying keeps the
  // wiring tractable when the same prefix or metric is repeated and
  // sidesteps the "rename the key" rebuild dance the chart-widget bars
  // map used. Updaters in use-dashboard-config target the index too.
  onEntryViewModeChange?: (index: number, mode: HistogramViewMode) => void;
  onEntryDepthAxisChange?: (index: number, axis: HistogramDepthAxis) => void;
  onEntryBinRangeChange?: (
    index: number,
    range: { start: number; end: number },
  ) => void;
  onEntryIgnoreOutliersChange?: (index: number, next: boolean) => void;
  onEntryStepsOnXChange?: (index: number, next: boolean) => void;
  /**
   * Set by dynamic-section-grid: a single-entry widget where the outer
   * dynamic-section chrome already owns Camera + Settings + Fullscreen.
   * Inner panel renders only its mode/depth toggles in that case.
   */
  compactChrome?: boolean;
}

export function DistributionsWidget({
  config,
  selectedRuns,
  organizationId,
  projectName,
  onEntryViewModeChange,
  onEntryDepthAxisChange,
  onEntryBinRangeChange,
  onEntryIgnoreOutliersChange,
  onEntryStepsOnXChange,
  compactChrome = false,
}: DistributionsWidgetProps) {
  const hiddenRunIds = useHiddenRunIds();
  const entries = config.entries ?? [];

  // Runs shape used by MultiRunCategoricalView. We filter hidden runs
  // here (parity with chart-widget's bars panel) — the categorical view
  // doesn't know about the hidden-runs hook.
  const barsRuns = useMemo(() => {
    if (entries.length === 0) return [];
    return Object.entries(selectedRuns)
      .filter(([runId]) => !hiddenRunIds.has(runId))
      .map(([runId, { run, color }]) => ({
        runId,
        runName: formatRunLabel(run.name, getDisplayIdForRun(run)),
        color,
      }));
  }, [entries.length, selectedRuns, hiddenRunIds]);

  // Runs shape used by MultiHistogramView. Same fields, but the
  // histogram view does its own hidden-runs handling — match the
  // existing HistogramWidget's unfiltered shape so behavior stays
  // identical to the old standalone widget.
  const histogramRuns = useMemo(() => {
    if (entries.length === 0) return [];
    return Object.entries(selectedRuns).map(([runId, { run, color }]) => ({
      runId,
      runName: formatRunLabel(run.name, getDisplayIdForRun(run)),
      color,
    }));
  }, [entries.length, selectedRuns]);

  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p>No entries configured</p>
          <p className="text-xs">
            Add a histogram metric or a {"{bars}"} rollup to this widget
          </p>
        </div>
      </div>
    );
  }

  if (Object.keys(selectedRuns).length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p>No runs selected</p>
          <p className="text-xs">Select runs from the list to view data</p>
        </div>
      </div>
    );
  }

  const renderEntry = (entry: DistributionsEntry, index: number) => {
    if (entry.kind === "bars") {
      return (
        <MultiRunCategoricalView
          orgId={organizationId}
          projectName={projectName}
          pathPrefix={entry.prefix}
          runs={barsRuns}
          initialMode={entry.viewMode}
          initialDepthAxis={entry.depthAxis}
          binRange={entry.binRange}
          initialIgnoreOutliers={entry.ignoreOutliers ?? true}
          initialStepsOnX={entry.stepsOnX ?? false}
          onModeChange={
            onEntryViewModeChange
              ? (m) => onEntryViewModeChange(index, m)
              : undefined
          }
          onDepthAxisChange={
            onEntryDepthAxisChange
              ? (a) => onEntryDepthAxisChange(index, a)
              : undefined
          }
          onBinRangeChange={
            onEntryBinRangeChange
              ? (r) => onEntryBinRangeChange(index, r)
              : undefined
          }
          onIgnoreOutliersChange={
            onEntryIgnoreOutliersChange
              ? (next) => onEntryIgnoreOutliersChange(index, next)
              : undefined
          }
          onStepsOnXChange={
            onEntryStepsOnXChange
              ? (next) => onEntryStepsOnXChange(index, next)
              : undefined
          }
          compactChrome={compactChrome}
        />
      );
    }
    // entry.kind === "histogram"
    return (
      <MultiHistogramView
        logName={entry.metric}
        tenantId={organizationId}
        projectName={projectName}
        runs={histogramRuns}
        mode={entry.viewMode ?? "step"}
        // Show the per-entry mode toggle so users (and E2E tests) can
        // switch Step / Ridgeline / Heatmap on each histogram entry,
        // mirroring the bars-entry path. Wire the change handler
        // through to the dashboard config so the toggle actually
        // persists.
        onModeChange={
          onEntryViewModeChange
            ? (next) => onEntryViewModeChange(index, next)
            : undefined
        }
        // In multi-entry mode the distributions widget renders its own
        // uniform top-left title above every panel — suppress the
        // histogram-view's internal one so we don't double up.
        hideTitle={entries.length > 1}
        ignoreOutliers={entry.ignoreOutliers ?? true}
        onIgnoreOutliersChange={
          onEntryIgnoreOutliersChange
            ? (next) => onEntryIgnoreOutliersChange(index, next)
            : undefined
        }
        // Experimental: histogram entries can now expose Steps-on-X
        // through the same settings popover the bars entries use. The
        // numeric canvas implementation is naive (heatmap transposes,
        // ridgeline leaves a watermark) — tracked as a follow-up.
        initialStepsOnX={entry.stepsOnX ?? false}
        onStepsOnXChange={
          onEntryStepsOnXChange
            ? (next) => onEntryStepsOnXChange(index, next)
            : undefined
        }
        // Flush p-0 so the sticky footer hits the widget border, same
        // as the bars panel below it (categorical-view also p-0).
        className="p-0"
      />
    );
  };

  // Bars entry title format: `<prefix>/*` (e.g. `training/dataset/*`).
  // Matches the outer-widget title's `getWidgetTitle` so multi-entry
  // panels read consistently with their parent widget header.
  const titleForEntry = (entry: DistributionsEntry): string =>
    entry.kind === "bars"
      ? `${entry.prefix.replace(/\/$/, "")}/*`
      : entry.metric;

  // Single entry → flush, full-height. Matches the historic
  // single-widget feel for both bars and histograms.
  if (entries.length === 1) {
    return (
      <div
        className="h-full"
        data-testid="distributions-widget"
        data-entry-count={1}
      >
        <div
          data-testid="distributions-entry"
          data-entry-kind={entries[0].kind}
          data-entry-index={0}
          className="h-full"
        >
          {renderEntry(entries[0], 0)}
        </div>
      </div>
    );
  }

  // Multi-entry → stacked-scrollable, one panel per entry. minHeights
  // mirror the file-group + chart-widget conventions so each canvas
  // has enough room to render meaningfully. Each panel gets a uniform
  // top-left title (white in dark / black in light, font-mono text-xs,
  // matching the line-chart title style) so the user can tell entries
  // apart at a glance. The histogram-view's internal title is
  // suppressed via hideTitle to avoid a double-stack.
  return (
    <div
      className="flex h-full flex-col gap-4 overflow-y-auto"
      data-testid="distributions-widget"
      data-entry-count={entries.length}
    >
      {entries.map((entry, i) => {
        const title = titleForEntry(entry);
        return (
          <div
            key={`${entry.kind}:${entry.kind === "bars" ? entry.prefix : entry.metric}:${i}`}
            className="flex shrink-0 flex-col"
            style={{ minHeight: 420 }}
            data-testid="distributions-entry"
            data-entry-kind={entry.kind}
            data-entry-index={i}
          >
            <div
              className="shrink-0 truncate pl-3 pt-1 font-mono text-xs text-black dark:text-white"
              title={title}
            >
              {title}
            </div>
            <div className="min-h-0 flex-1">{renderEntry(entry, i)}</div>
          </div>
        );
      })}
    </div>
  );
}
