import { useMemo } from "react";
import { DropdownRegion } from "@/components/core/runs/dropdown-region/dropdown-region";
import { VirtualizedGroup } from "@/components/core/virtualized-group";
import { formatRunLabel } from "@/lib/format-run-label";
import { getDisplayIdForRun } from "../~lib/metrics-utils";
import { useCustomChartPanels } from "../~hooks/use-custom-chart-panels";
import { MultiGroupCustomChart } from "./multi-group/custom-chart";
import type { SelectedRunWithColor } from "../~hooks/use-selected-runs";

/**
 * Upper bound on how many runs one overlaid chart pulls tables for.
 *
 * Each run in an overlay costs one `runs.data.table` query, so an unbounded
 * overlay on a 200-run selection would fire 200 requests per panel. Past a
 * couple of dozen series a chart is unreadable anyway. The widget says when it
 * has truncated rather than quietly dropping runs.
 */
const MAX_OVERLAY_RUNS = 25;

interface CustomChartsSectionProps {
  organizationId: string;
  projectName: string;
  selectedRuns: Record<string, SelectedRunWithColor>;
  hiddenRunIds?: Set<string>;
  /** Keeps the section mounted while the layout editor is open. */
  disabled?: boolean;
}

/**
 * The "custom charts" section of the all-runs page.
 *
 * Its own section rather than a branch of the log-type dispatch in
 * `multi-group.tsx`: these panels are read off run *config*, not the log
 * registry, so they never appear in `groupedMetrics` and have no `logName` to
 * be grouped under. Renders nothing when the selected runs carry no panels,
 * which is every project that wasn't migrated from wandb.
 */
export function CustomChartsSection({
  organizationId,
  projectName,
  selectedRuns,
  hiddenRunIds,
  disabled,
}: CustomChartsSectionProps) {
  const runs = useMemo(
    () =>
      Object.entries(selectedRuns)
        .filter(([runId]) => !hiddenRunIds?.has(runId))
        .map(([runId, { run, color }]) => ({
          runId,
          runName: formatRunLabel(run.name, getDisplayIdForRun(run)),
          color,
        })),
    [selectedRuns, hiddenRunIds],
  );

  const runIds = useMemo(() => runs.map((r) => r.runId), [runs]);
  const panels = useCustomChartPanels(organizationId, projectName, runIds);

  const overlayRuns = useMemo(() => runs.slice(0, MAX_OVERLAY_RUNS), [runs]);

  // Render functions, not elements — DropdownRegion only calls the ones it
  // actually shows, so a collapsed section costs no table queries.
  const components = useMemo(
    () =>
      panels.map((panel) => () => (
        <MultiGroupCustomChart
          panel={panel}
          organizationId={organizationId}
          projectName={projectName}
          runs={overlayRuns}
          totalRunCount={runs.length}
          className="h-full pb-2.5"
        />
      )),
    [panels, organizationId, projectName, overlayRuns, runs.length],
  );

  const itemKeys = useMemo(() => panels.map((p) => p.key), [panels]);

  if (panels.length === 0) return null;

  return (
    <VirtualizedGroup
      groupId={`${projectName}-custom-charts`}
      groupTitle="custom charts"
      metricCount={panels.length}
      disabled={disabled}
    >
      <DropdownRegion
        title="custom charts"
        components={components}
        groupId={`${projectName}-custom-charts`}
        itemKeys={itemKeys}
      />
    </VirtualizedGroup>
  );
}
