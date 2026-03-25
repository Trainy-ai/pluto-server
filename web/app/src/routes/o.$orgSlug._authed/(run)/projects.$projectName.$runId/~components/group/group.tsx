import { DropdownRegion } from "@/components/core/runs/dropdown-region/dropdown-region";
import type { LogGroup } from "@/lib/grouping/types";
import { useMemo, memo } from "react";
import { LineChartWithFetch } from "./line-chart";
import { ImagesView } from "./images";
import { AudioView } from "./audio";
import { HistogramView } from "./histogram-view";
import { VideoView } from "./video";
import { TableView } from "./table";
import { TextView } from "./text-view";
import { ImageStepSyncProvider } from "../../~context/image-step-sync-context";

interface DataGroupProps {
  group: LogGroup;
  tenantId: string;
  projectName: string;
  runId: string;
  boundsResetKey?: number;
  runCreatedAt?: string;
  runName?: string;
}

// Internal base component that handles the rendering logic
const DataGroupBase = ({
  group,
  tenantId,
  projectName,
  runId,
  boundsResetKey,
  runCreatedAt,
  runName,
}: DataGroupProps) => {
  const groupId = `metrics-${group.groupName}`;

  // Memoize sorted logs to prevent unnecessary re-sorting
  const sortedLogs = useMemo(() => {
    return [...group.logs].sort((a, b) => {
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }, [group.logs]);

  // Return render functions instead of elements for lazy evaluation
  // Components are only created when DropdownRegion calls the render function
  const children = useMemo(() => {
    return sortedLogs.map((log) => () => (
      <LogView
        key={log.id}
        log={log}
        tenantId={tenantId}
        projectName={projectName}
        runId={runId}
        boundsResetKey={boundsResetKey}
        runCreatedAt={runCreatedAt}
        runName={runName}
      />
    ));
  }, [sortedLogs, tenantId, projectName, runId, boundsResetKey, runCreatedAt, runName]);

  // Wrap in ImageStepSyncProvider if the group contains any logs with step navigation
  const STEP_NAV_TYPES = new Set(["IMAGE", "VIDEO", "AUDIO", "HISTOGRAM"]);
  const hasStepNavLogs = useMemo(
    () => group.logs.some((log) => STEP_NAV_TYPES.has(log.logType)),
    [group.logs],
  );

  const content = (
    <DropdownRegion
      title={group.groupName}
      components={children}
      groupId={groupId}
    />
  );

  if (hasStepNavLogs) {
    return <ImageStepSyncProvider>{content}</ImageStepSyncProvider>;
  }

  return content;
};

// Export a memoized version of the component
export const DataGroup = memo(DataGroupBase);
DataGroup.displayName = "DataGroup";

interface LogViewProps {
  log: LogGroup["logs"][number];
  tenantId: string;
  projectName: string;
  runId: string;
  boundsResetKey?: number;
  runCreatedAt?: string;
  runName?: string;
}

const LogView = memo(
  ({
    log,
    tenantId,
    projectName,
    runId,
    boundsResetKey,
    runCreatedAt,
    runName,
  }: LogViewProps) => {
    if (log.logType === "METRIC") {
      return (
        <LineChartWithFetch
          logName={log.logName}
          tenantId={tenantId}
          projectName={projectName}
          runId={runId}
          boundsResetKey={boundsResetKey}
          runCreatedAt={runCreatedAt}
          runName={runName}
        />
      );
    }

    if (log.logType === "IMAGE") {
      return (
        <ImagesView
          log={log}
          tenantId={tenantId}
          projectName={projectName}
          runId={runId}
        />
      );
    }

    if (log.logType === "AUDIO") {
      return (
        <AudioView
          log={log}
          tenantId={tenantId}
          projectName={projectName}
          runId={runId}
        />
      );
    }

    if (log.logType === "HISTOGRAM") {
      return (
        <HistogramView
          logName={log.logName}
          tenantId={tenantId}
          projectName={projectName}
          runId={runId}
        />
      );
    }

    if (log.logType === "VIDEO") {
      return (
        <VideoView
          log={log}
          tenantId={tenantId}
          projectName={projectName}
          runId={runId}
        />
      );
    }

    if (log.logType === "TABLE") {
      return (
        <TableView
          log={log}
          tenantId={tenantId}
          projectName={projectName}
          runId={runId}
        />
      );
    }

    if (
      log.logType === "TEXT" ||
      log.logType === "FILE" ||
      log.logType === "ARTIFACT"
    ) {
      return (
        <TextView
          log={log}
          tenantId={tenantId}
          projectName={projectName}
          runId={runId}
        />
      );
    }

    return (
      <div>
        {log.logName} | {log.logType}
      </div>
    );
  },
);

LogView.displayName = "LogView";
