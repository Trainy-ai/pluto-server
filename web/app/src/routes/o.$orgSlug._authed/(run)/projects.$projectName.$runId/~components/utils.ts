import type { inferOutput } from "@trpc/tanstack-react-query";
import { trpc } from "@/utils/trpc";
import type { LogGroup } from "@/lib/grouping/types";
import { flattenAndSortLogGroups, getLogGroupName } from "@/lib/grouping/index";

type RunData = NonNullable<inferOutput<typeof trpc.runs.get>>;

export interface ProcessedLogGroup extends LogGroup {
  logs: RunData["logs"];
}

export const processLogsIntoGroups = (logs: RunData["logs"]) => {
  const logGroups: Record<string, ProcessedLogGroup> = {};

  logs.forEach((log) => {
    const logGroup = getLogGroupName(log);

    if (logGroup) {
      if (!logGroups[logGroup]) {
        logGroups[logGroup] = {
          groupName: logGroup,
          logs: [],
        };
      }

      logGroups[logGroup].logs.push(log);
    }
  });

  const sortedLogGroups = flattenAndSortLogGroups(logGroups);

  return sortedLogGroups;
};
