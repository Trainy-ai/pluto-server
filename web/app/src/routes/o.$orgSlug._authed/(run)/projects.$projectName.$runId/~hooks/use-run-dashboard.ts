import { useMemo } from "react";
import { getLogGroupName } from "@/lib/grouping/index";
import type { GroupedMetrics, RunStatus } from "@/lib/grouping/types";
import { useChartColors } from "@/components/ui/color-picker";
import {
  getColorForRun,
  type SelectedRunWithColor,
} from "@/routes/o.$orgSlug._authed/(runComparison)/projects.$projectName/~hooks/use-selected-runs";
import type { inferOutput } from "@trpc/tanstack-react-query";
import type { trpc } from "@/utils/trpc";

type GetRunData = inferOutput<typeof trpc.runs.get>;

/**
 * Builds GroupedMetrics and selectedRuns from a single run's data
 * for use with the project-level DashboardBuilder component.
 *
 * This transforms the run-level data (from trpc.runs.get) into the same
 * shape expected by the project-level dashboard widgets, allowing the
 * same custom dashboard views to be used at both levels.
 */
export function useRunDashboardData(
  runData: GetRunData | undefined,
  runId: string,
) {
  const chartColors = useChartColors();

  const color = useMemo(
    () => getColorForRun(runId, chartColors),
    [runId, chartColors],
  );

  const groupedMetrics = useMemo((): GroupedMetrics => {
    if (!runData?.logs) return {};

    const groups: GroupedMetrics = {};

    for (const log of runData.logs) {
      if (!log.logType) continue;

      const groupKey = getLogGroupName({
        logGroup: log.logGroup,
        logType: log.logType,
      });

      if (!groups[groupKey]) {
        groups[groupKey] = {
          metrics: [],
          groupName: groupKey,
        };
      }

      let metricGroup = groups[groupKey].metrics.find(
        (m) => m.name === log.logName && m.type === log.logType,
      );

      if (!metricGroup) {
        metricGroup = {
          name: log.logName,
          type: log.logType,
          data: [],
        };
        groups[groupKey].metrics.push(metricGroup);
      }

      metricGroup.data.push({
        runId,
        runName: runData.name,
        color,
        status: runData.status as RunStatus,
      });
    }

    return groups;
  }, [runData, runId, color]);

  const selectedRuns = useMemo((): Record<string, SelectedRunWithColor> => {
    if (!runData) return {};

    // Build a Run-compatible object. The dashboard widgets only access
    // run.name and run.status from this object; the runId comes from
    // the dictionary key. We cast to satisfy the type constraint.
    const runForDashboard = {
      ...runData,
      id: runId, // Override BigInt id with SQID-encoded string
    } as unknown as SelectedRunWithColor["run"];

    return {
      [runId]: {
        run: runForDashboard,
        color,
      },
    };
  }, [runData, runId, color]);

  return { groupedMetrics, selectedRuns, color };
}
