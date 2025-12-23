import type { inferOutput } from "@trpc/tanstack-react-query";
import { trpc } from "@/utils/trpc";

export type RunLog = inferOutput<typeof trpc.runs.get>["logs"][number];
export type RunLogType = RunLog["logType"];
export type LogGroupName = string;

export interface LogGroup {
  groupName: LogGroupName;
  logs: RunLog[];
}

export interface GroupedMetrics {
  [key: LogGroupName]: {
    metrics: Array<{
      name: string;
      type: RunLogType;
      data: Array<{
        runId: string;
        runName: string;
        color: string;
      }>;
    }>;
    groupName: LogGroupName;
  };
}
