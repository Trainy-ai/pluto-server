import { getLogGroupName } from "@/lib/grouping/index";
import type { GroupedMetrics } from "@/lib/grouping/types";
import type { inferOutput } from "@trpc/tanstack-react-query";
import type { trpc } from "@/utils/trpc";

type Run = inferOutput<typeof trpc.runs.list>["runs"][number];

/**
 * Groups metrics from selected runs by their log groups
 * 
 * This function takes selected runs with their assigned colors and organizes
 * their metrics into groups based on log type and group. Each metric within
 * a group includes reference to the runs it belongs to with their colors.
 *
 * @param selectedRunsWithColors - Record of selected runs with their assigned colors
 * @returns Grouped metrics organized by log group
 */
export const groupMetrics = (
  selectedRunsWithColors: Record<string, { run: Run; color: string }>,
): GroupedMetrics => {
  const groups: GroupedMetrics = {};

  Object.values(selectedRunsWithColors).forEach(({ run, color }) => {
    run.logs.forEach((log) => {
      if (!log.logType) return;

      const groupKey = getLogGroupName({
        logGroup: log.logGroup,
        logType: log.logType,
      });
      const metricName = log.logName;
      const logType = log.logType;

      if (!groups[groupKey]) {
        groups[groupKey] = {
          metrics: [],
          groupName: groupKey,
        };
      }

      let metricGroup = groups[groupKey].metrics.find(
        (metric) => metric.name === metricName && metric.type === logType,
      );

      if (!metricGroup) {
        metricGroup = {
          name: metricName,
          type: logType,
          data: [],
        };
        groups[groupKey].metrics.push(metricGroup);
      }

      metricGroup.data.push({
        runId: run.id,
        runName: run.name,
        color,
      });
    });
  });

  return groups;
};