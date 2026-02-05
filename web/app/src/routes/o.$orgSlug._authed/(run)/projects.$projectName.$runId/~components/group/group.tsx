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

interface DataGroupProps {
  group: LogGroup;
  tenantId: string;
  projectName: string;
  runId: string;
}

// Internal base component that handles the rendering logic
const DataGroupBase = ({
  group,
  tenantId,
  projectName,
  runId,
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
      />
    ));
  }, [sortedLogs, tenantId, projectName, runId]);

  return (
    <DropdownRegion
      title={group.groupName}
      components={children}
      groupId={groupId}
    />
  );
};

// Export a memoized version of the component
export const DataGroup = memo(DataGroupBase);
DataGroup.displayName = "DataGroup";

interface LogViewProps {
  log: LogGroup["logs"][number];
  tenantId: string;
  projectName: string;
  runId: string;
}

const LogView = memo(
  ({
    log,
    tenantId,
    projectName,
    runId,
  }: LogViewProps) => {
    if (log.logType === "METRIC") {
      return (
        <LineChartWithFetch
          logName={log.logName}
          tenantId={tenantId}
          projectName={projectName}
          runId={runId}
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
