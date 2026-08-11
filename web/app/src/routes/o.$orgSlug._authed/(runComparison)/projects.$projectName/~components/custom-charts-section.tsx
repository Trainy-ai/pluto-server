import { useMemo } from "react";
import { DropdownRegion } from "@/components/core/runs/dropdown-region/dropdown-region";
import { VirtualizedGroup } from "@/components/core/virtualized-group";
import { formatRunLabel } from "@/lib/format-run-label";
import { getDisplayIdForRun } from "../~lib/metrics-utils";
import { useCustomChartPanels } from "../~hooks/use-custom-chart-panels";
import { useRunIdsByLogName } from "../~queries/file-log-names";
import { selectOverlayRuns } from "@/lib/select-overlay-runs";
import { MultiGroupCustomChart } from "./multi-group/custom-chart";
import type { SelectedRunWithColor } from "../~hooks/use-selected-runs";

/**
 * Upper bound on how many runs one overlaid chart pulls tables for.
 *
 * Each run in an overlay costs one `runs.data.table` query, so an unbounded
 * overlay on a 200-run selection would fire 200 requests per panel. Past a
 * couple of dozen series a chart is unreadable anyway. The widget says when it
 * has truncated rather than quietly dropping runs.
 *
 * Applied AFTER narrowing to the runs that hold the panel's table — see below.
 * Slicing the raw selection instead meant a chart drew whichever of the first
 * 25 selected runs happened to have data: on migrate-final, 13 runs have
 * `roc_table` but only one sat inside the first 25, so the chart showed a
 * single line where wandb showed ten.
 */
const MAX_OVERLAY_RUNS = 25;

/** Stable empty list so the lookup's query key doesn't churn while panels load. */
const NO_TABLE_KEYS: string[] = [];

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
          displayId: getDisplayIdForRun(run),
          color,
        })),
    [selectedRuns, hiddenRunIds],
  );

  const runIds = useMemo(() => runs.map((r) => r.runId), [runs]);
  const panels = useCustomChartPanels(organizationId, projectName, runIds);

  // Which selected runs actually logged each panel's table. A panel names its
  // table (`tableKey`), and tables ARE in the log registry, so this is the same
  // one-query lookup the media widgets use.
  const tableKeys = useMemo(
    () => [...new Set(panels.map((p) => p.tableKey).filter(Boolean))],
    [panels],
  );
  const { data: runIdsByTable, isPlaceholderData: isStaleTableMap } =
    useRunIdsByLogName(
      organizationId,
      projectName,
      tableKeys.length > 0 ? tableKeys : NO_TABLE_KEYS,
      runIds,
    );

  // `placeholderData` hands back the PREVIOUS selection's mapping while the new
  // one is in flight, and `runs` has already updated — so treating it as
  // resolved would drop newly selected runs that hold the table until the
  // refetch lands. Reading it as "not resolved yet" keeps the fail-open
  // promise the filter below documents.
  const tableRunIds = isStaleTableMap ? undefined : runIdsByTable?.runIdsByLogName;

  // Render functions, not elements — DropdownRegion only calls the ones it
  // actually shows, so a collapsed section costs no table queries.
  const components = useMemo(
    () =>
      panels.map((panel) => () => {
        // Narrow to the runs holding this chart's table, THEN cap — see
        // selectOverlayRuns for why that order is the whole point. Fails open
        // until the lookup resolves, so the chart renders as it did before
        // rather than flashing empty, then re-renders narrowed.
        const { runs: overlayRuns, totalWithData } = selectOverlayRuns(
          runs,
          tableRunIds?.[panel.tableKey],
          MAX_OVERLAY_RUNS,
        );
        return (
          <MultiGroupCustomChart
            panel={panel}
            organizationId={organizationId}
            projectName={projectName}
            runs={overlayRuns}
            // Counts runs holding THIS chart, not the whole selection, so the
            // "showing N of M" caption compares like with like.
            totalRunCount={totalWithData}
            className="h-full pb-2.5"
          />
        );
      }),
    [panels, organizationId, projectName, runs, tableRunIds],
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
