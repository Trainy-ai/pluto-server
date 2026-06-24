import { useMemo, useState, useEffect, useRef } from "react";
import { useHiddenRunIds } from "@/hooks/use-hidden-run-ids";
import { useQueries } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import type {
  FileGroupWidgetConfig,
  HistogramViewMode,
} from "../../~types/dashboard-types";
import type { SelectedRunWithColor } from "../../~hooks/use-selected-runs";
import { MultiGroupImage } from "../multi-group/image";
import { MultiGroupVideo } from "../multi-group/video";
import { MultiGroupAudio } from "../multi-group/audio";
import { MultiHistogramView } from "../multi-group/histogram-view";
import {
  resolveMetrics,
  isGlobValue,
  getGlobPattern,
  isRegexValue,
  getRegexPattern,
  isPatternValue,
} from "./glob-utils";
import { useRunFileLogNames } from "../../~queries/file-log-names";
import { formatRunLabel } from "@/lib/format-run-label";
import { getDisplayIdForRun } from "../../~lib/metrics-utils";
import {
  SYNTHETIC_CONSOLE_ENTRIES,
  isConsoleLogType,
} from "./console-log-constants";
import { ConsoleLogWidget } from "./console-log-widget";

/** Cap parallel pattern-resolution queries per widget to prevent request storms */
const MAX_PATTERN_QUERIES = 20;

interface FileGroupWidgetProps {
  config: FileGroupWidgetConfig;
  selectedRuns: Record<string, SelectedRunWithColor>;
  organizationId: string;
  projectName: string;
  /**
   * Called once the file-types query resolves with the names of every
   * HISTOGRAM entry in this widget's `files[]`. Powers the save-time
   * auto-lift in dashboard-builder: that handler caches the detection
   * per-widget and rewrites the dashboard config (file-group → file-
   * group + distributions) right before the next Save mutation, so
   * legacy file-group histograms migrate transparently the first time
   * the user saves. Dynamic-section widgets don't pass this callback —
   * they aren't in `section.widgets[]`, so the save handler has no
   * widget to rewrite.
   */
  onHistogramsDetected?: (fileNames: string[]) => void;
}

export function FileGroupWidget({
  config,
  selectedRuns,
  organizationId,
  projectName,
  onHistogramsDetected,
}: FileGroupWidgetProps) {
  const hiddenRunIds = useHiddenRunIds();

  const runs = useMemo(() => {
    return Object.entries(selectedRuns)
      .filter(([runId]) => !hiddenRunIds.has(runId))
      .map(([runId, { run, color }]) => ({
        runId,
        runName: formatRunLabel(run.name, getDisplayIdForRun(run)),
        color,
      }));
  }, [selectedRuns, hiddenRunIds]);

  const selectedRunIds = useMemo(
    () => Object.keys(selectedRuns),
    [selectedRuns],
  );
  const hasPatterns = config.files?.some(isPatternValue) ?? false;

  const globBases = useMemo(() => {
    if (!config.files) return [];
    return [
      ...new Set(
        config.files
          .filter(isGlobValue)
          .map((v) => getGlobPattern(v).replace(/[*?]/g, ""))
          .filter((base) => base.length > 0),
      ),
    ].slice(0, MAX_PATTERN_QUERIES);
  }, [config.files]);

  const regexPatterns = useMemo(() => {
    if (!config.files) return [];
    return config.files
      .filter(isRegexValue)
      .map((v) => getRegexPattern(v))
      .slice(0, MAX_PATTERN_QUERIES);
  }, [config.files]);

  const { data: allFileNames } = useRunFileLogNames(
    organizationId,
    projectName,
    selectedRunIds,
  );

  const globSearchResults = useQueries({
    queries: globBases.map((base) =>
      trpc.runs.distinctFileLogNames.queryOptions({
        organizationId,
        projectName,
        search: base,
        runIds: selectedRunIds,
      }),
    ),
  });

  const regexSearchResults = useQueries({
    queries: regexPatterns.map((pattern) =>
      trpc.runs.distinctFileLogNames.queryOptions({
        organizationId,
        projectName,
        regex: pattern,
        runIds: selectedRunIds,
      }),
    ),
  });

  const { resolvedFiles, typeMap } = useMemo(() => {
    const tMap = new Map<string, string>();
    const available = new Set<string>();

    for (const e of SYNTHETIC_CONSOLE_ENTRIES) {
      available.add(e.logName);
      tMap.set(e.logName, e.logType);
    }

    for (const f of allFileNames?.files ?? []) {
      available.add(f.logName);
      tMap.set(f.logName, f.logType);
    }
    for (const result of globSearchResults) {
      for (const f of result.data?.files ?? []) {
        available.add(f.logName);
        tMap.set(f.logName, f.logType);
      }
    }
    for (const result of regexSearchResults) {
      for (const f of result.data?.files ?? []) {
        available.add(f.logName);
        tMap.set(f.logName, f.logType);
      }
    }

    if (!config.files || config.files.length === 0) {
      return { resolvedFiles: [] as string[], typeMap: tMap };
    }

    if (!hasPatterns) {
      return { resolvedFiles: config.files, typeMap: tMap };
    }

    const resolved = resolveMetrics(config.files, Array.from(available));
    return { resolvedFiles: resolved, typeMap: tMap };
  }, [
    config.files,
    hasPatterns,
    allFileNames,
    globSearchResults,
    regexSearchResults,
  ]);

  // Save-time auto-lift detection. When the file-types query resolves
  // and we know which of our `files[]` are HISTOGRAM, report them up so
  // the dashboard-builder's save handler can rewrite the dashboard
  // config (file-group → file-group + distributions) just before the
  // next Save. We fire only on a content change (compared via the
  // sorted list) so the parent doesn't churn re-renders on every
  // mount. Dynamic-section widgets pass `onHistogramsDetected =
  // undefined`, so the effect is a no-op there — they aren't in
  // section.widgets[] for the save handler to rewrite anyway.
  const lastReportedRef = useRef<string>("");
  useEffect(() => {
    if (!onHistogramsDetected) return;
    const histograms = (resolvedFiles ?? [])
      .filter((f) => typeMap.get(f) === "HISTOGRAM")
      .sort();
    const sig = histograms.join("");
    if (sig === lastReportedRef.current) return;
    lastReportedRef.current = sig;
    onHistogramsDetected(histograms);
  }, [resolvedFiles, typeMap, onHistogramsDetected]);

  if (!resolvedFiles || resolvedFiles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p>No files configured</p>
        </div>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p>No runs selected</p>
          <p className="text-xs">Select runs from the list to view data</p>
        </div>
      </div>
    );
  }

  // Group resolved files by type for rendering. HISTOGRAM type files used
  // to render here too; they've moved to the distributions widget. Any
  // legacy file-group with a HISTOGRAM file still in `files[]` gets a
  // visible placeholder pointing the user at the new widget.
  const grouped = new Map<string, string[]>();
  for (const file of resolvedFiles) {
    const logType = typeMap.get(file) ?? "UNKNOWN";
    const existing = grouped.get(logType) ?? [];
    existing.push(file);
    grouped.set(logType, existing);
  }

  type GroupItem = { kind: "file"; logName: string; logType: string };
  const items: GroupItem[] = [];
  for (const [logType, files] of grouped.entries()) {
    for (const logName of files)
      items.push({ kind: "file", logName, logType });
  }

  const renderItem = (item: GroupItem) => (
    <FileGroupEntry
      key={item.logName}
      logName={item.logName}
      logType={item.logType}
      runs={runs}
      organizationId={organizationId}
      projectName={projectName}
    />
  );

  // Single-entry: render flush so the inner sticky footer sits against the
  // widget border (matches Distributions / Charts widgets). Skips the
  // minHeight + overflow-y-auto wrapper the multi-entry path needs.
  if (items.length === 1) {
    return <div className="h-full">{renderItem(items[0])}</div>;
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      {items.map((item) => {
        const minHeight = isConsoleLogType(item.logType) ? undefined : 250;
        const height = isConsoleLogType(item.logType) ? 400 : undefined;
        return (
          <div
            key={item.logName}
            className="shrink-0"
            style={{ minHeight, height }}
          >
            {renderItem(item)}
          </div>
        );
      })}
    </div>
  );
}

function FileGroupEntry({
  logName,
  logType,
  runs,
  organizationId,
  projectName,
}: {
  logName: string;
  logType: string;
  runs: { runId: string; runName: string; color: string }[];
  organizationId: string;
  projectName: string;
}) {
  switch (logType) {
    case "IMAGE":
      return (
        <MultiGroupImage
          logName={logName}
          organizationId={organizationId}
          projectName={projectName}
          runs={runs}
          className="h-full p-0"
        />
      );
    case "VIDEO":
      return (
        <MultiGroupVideo
          logName={logName}
          organizationId={organizationId}
          projectName={projectName}
          runs={runs}
          className="h-full p-0"
        />
      );
    case "AUDIO":
      return (
        <MultiGroupAudio
          logName={logName}
          organizationId={organizationId}
          projectName={projectName}
          runs={runs}
          className="h-full p-0"
        />
      );
    case "CONSOLE_STDOUT":
    case "CONSOLE_STDERR":
      return (
        <ConsoleLogWidget
          logType={logType as "CONSOLE_STDOUT" | "CONSOLE_STDERR"}
          runs={runs}
          organizationId={organizationId}
          projectName={projectName}
        />
      );
    case "HISTOGRAM":
      // Legacy path — histograms now belong in distributions widgets,
      // but file-group widgets created before the split may still list
      // them in `files[]`. Render via the same MultiHistogramView the
      // distributions widget uses so the user sees no break. Per-file
      // settings (viewMode, ignoreOutliers) live in local component
      // state here since the FileGroupWidgetConfig per-file maps that
      // used to persist them were dropped with the schema cleanup —
      // changes survive the session but not a reload.
      return (
        <LegacyHistogramFileEntry
          logName={logName}
          organizationId={organizationId}
          projectName={projectName}
          runs={runs}
        />
      );
    default:
      return (
        <div className="rounded border p-2 text-center text-sm text-muted-foreground">
          Unsupported type: {logType} ({logName})
        </div>
      );
  }
}

// Legacy histogram entry inside file-group widgets. Pre-distributions
// dashboards stored histograms as file entries; this preserves the
// rendering so existing dashboards keep working. New histograms should
// be created in distributions widgets — once the user re-creates them
// there, the file-group entry can be removed.
function LegacyHistogramFileEntry({
  logName,
  organizationId,
  projectName,
  runs,
}: {
  logName: string;
  organizationId: string;
  projectName: string;
  runs: { runId: string; runName: string; color: string }[];
}) {
  const [viewMode, setViewMode] = useState<HistogramViewMode>("ridgeline");
  const [ignoreOutliers, setIgnoreOutliers] = useState(true);
  return (
    <MultiHistogramView
      logName={logName}
      tenantId={organizationId}
      projectName={projectName}
      runs={runs}
      className="h-full p-0"
      mode={viewMode}
      onModeChange={setViewMode}
      ignoreOutliers={ignoreOutliers}
      onIgnoreOutliersChange={setIgnoreOutliers}
    />
  );
}
