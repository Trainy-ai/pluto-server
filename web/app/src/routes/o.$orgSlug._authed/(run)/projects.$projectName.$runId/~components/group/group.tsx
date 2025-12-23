import { DropdownRegion } from "@/components/core/runs/dropdown-region/dropdown-region";
import type { LogGroup } from "@/lib/grouping/types";
import { useState, useCallback, useMemo, memo } from "react";
import { useChartSync } from "@/components/charts/hooks/use-chart-sync";
import ReactECharts from "echarts-for-react";
import { LineChartWithFetch } from "./line-chart";
import { ImagesView } from "./images";
import { AudioView } from "./audio";
import { HistogramView } from "./histogram-view";
import { VideoView } from "./video";
import { TableView } from "./table";

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
  const [loadedCharts, setLoadedCharts] = useState(0);
  const { setChartRef } = useChartSync(groupId, loadedCharts);

  const handleChartLoad = useCallback(() => {
    setLoadedCharts((prev) => prev + 1);
  }, []);

  // Memoize sorted logs to prevent unnecessary re-sorting
  const sortedLogs = useMemo(() => {
    return [...group.logs].sort((a, b) => {
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }, [group.logs]);

  // Memoize children to prevent recreation on every render
  const children = useMemo(() => {
    return sortedLogs.map((log, index) => (
      <LogView
        key={log.id}
        log={log}
        setChartRef={setChartRef}
        index={index}
        onLoad={handleChartLoad}
        tenantId={tenantId}
        projectName={projectName}
        runId={runId}
      />
    ));
  }, [sortedLogs, setChartRef, handleChartLoad, tenantId, projectName, runId]);

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
  setChartRef: (index: number) => (ref: ReactECharts | null) => void;
  index: number;
  onLoad: () => void;
  tenantId: string;
  projectName: string;
  runId: string;
}

const LogView = memo(
  ({
    log,
    setChartRef,
    index,
    onLoad,
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
          setChartRef={setChartRef}
          index={index}
          onLoad={onLoad}
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

    return (
      <div>
        {log.logName} | {log.logType}
      </div>
    );
  },
);

LogView.displayName = "LogView";
