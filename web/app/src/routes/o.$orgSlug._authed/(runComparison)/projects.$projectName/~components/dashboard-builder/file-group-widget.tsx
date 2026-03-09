import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import type { FileGroupWidgetConfig } from "../../~types/dashboard-types";
import type { SelectedRunWithColor } from "../../~hooks/use-selected-runs";
import { MultiHistogramView } from "../multi-group/histogram-view";
import { MultiGroupImage } from "../multi-group/image";
import { MultiGroupVideo } from "../multi-group/video";
import { MultiGroupAudio } from "../multi-group/audio";
import { resolveMetrics, isGlobValue, getGlobPattern, isRegexValue, getRegexPattern, isPatternValue } from "./glob-utils";
import { useRunFileLogNames } from "../../~queries/file-log-names";
import { formatRunLabel } from "@/lib/format-run-label";
import { getDisplayIdForRun } from "../../~lib/metrics-utils";
import { SYNTHETIC_CONSOLE_ENTRIES, isConsoleLogType } from "./console-log-constants";
import { ConsoleLogWidget } from "./console-log-widget";

/** Cap parallel pattern-resolution queries per widget to prevent request storms */
const MAX_PATTERN_QUERIES = 20;

interface FileGroupWidgetProps {
  config: FileGroupWidgetConfig;
  selectedRuns: Record<string, SelectedRunWithColor>;
  organizationId: string;
  projectName: string;
}

export function FileGroupWidget({
  config,
  selectedRuns,
  organizationId,
  projectName,
}: FileGroupWidgetProps) {
  const runs = useMemo(() => {
    return Object.entries(selectedRuns).map(([runId, { run, color }]) => ({
      runId,
      runName: formatRunLabel(run.name, getDisplayIdForRun(run)),
      color,
    }));
  }, [selectedRuns]);

  const selectedRunIds = useMemo(() => Object.keys(selectedRuns), [selectedRuns]);
  const hasPatterns = config.files?.some(isPatternValue) ?? false;

  const globBases = useMemo(() => {
    if (!config.files) return [];
    return [...new Set(
      config.files
        .filter(isGlobValue)
        .map((v) => getGlobPattern(v).replace(/[*?]/g, ""))
        .filter((base) => base.length > 0)
    )].slice(0, MAX_PATTERN_QUERIES);
  }, [config.files]);

  const regexPatterns = useMemo(() => {
    if (!config.files) return [];
    return config.files
      .filter(isRegexValue)
      .map((v) => getRegexPattern(v))
      .slice(0, MAX_PATTERN_QUERIES);
  }, [config.files]);

  const { data: allFileNames } = useRunFileLogNames(
    organizationId, projectName, selectedRunIds
  );

  const globSearchResults = useQueries({
    queries: globBases.map((base) =>
      trpc.runs.distinctFileLogNames.queryOptions({
        organizationId, projectName, search: base, runIds: selectedRunIds,
      })
    ),
  });

  const regexSearchResults = useQueries({
    queries: regexPatterns.map((pattern) =>
      trpc.runs.distinctFileLogNames.queryOptions({
        organizationId, projectName, regex: pattern, runIds: selectedRunIds,
      })
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
  }, [config.files, hasPatterns, allFileNames, globSearchResults, regexSearchResults]);

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

  // Group resolved files by type for rendering
  const grouped = new Map<string, string[]>();
  for (const file of resolvedFiles) {
    const logType = typeMap.get(file) ?? "HISTOGRAM";
    const existing = grouped.get(logType) ?? [];
    existing.push(file);
    grouped.set(logType, existing);
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      {Array.from(grouped.entries()).map(([logType, files]) =>
        files.map((logName) => (
          <div
            key={logName}
            className="shrink-0"
            style={
              isConsoleLogType(logType)
                ? { height: 400 }
                : { minHeight: logType === "HISTOGRAM" ? 300 : 250 }
            }
          >
            <FileGroupEntry
              logName={logName}
              logType={logType}
              runs={runs}
              organizationId={organizationId}
              projectName={projectName}
            />
          </div>
        ))
      )}
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
    case "HISTOGRAM":
      return (
        <MultiHistogramView
          logName={logName}
          tenantId={organizationId}
          projectName={projectName}
          runs={runs}
          className="h-full"
        />
      );
    case "IMAGE":
      return (
        <MultiGroupImage
          logName={logName}
          organizationId={organizationId}
          projectName={projectName}
          runs={runs}
          className="h-full"
        />
      );
    case "VIDEO":
      return (
        <MultiGroupVideo
          logName={logName}
          organizationId={organizationId}
          projectName={projectName}
          runs={runs}
          className="h-full"
        />
      );
    case "AUDIO":
      return (
        <MultiGroupAudio
          logName={logName}
          organizationId={organizationId}
          projectName={projectName}
          runs={runs}
          className="h-full"
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
    default:
      return (
        <div className="rounded border p-2 text-center text-sm text-muted-foreground">
          Unsupported type: {logType} ({logName})
        </div>
      );
  }
}
