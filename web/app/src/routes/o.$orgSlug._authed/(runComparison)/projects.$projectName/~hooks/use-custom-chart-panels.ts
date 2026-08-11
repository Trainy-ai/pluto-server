import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import type { CustomChartPanel } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/group/custom-chart-view";

const NO_PANELS: CustomChartPanel[] = [];

/**
 * Migrated wandb custom-chart panels (`wandb.plot.*`) across the selected runs.
 *
 * The exporter parks these on run config rather than in the log registry, so
 * unlike every other widget on this page they cannot be discovered from
 * `groupedMetrics`. This used to mean reading configs client-side, which cost
 * one `runs.get` per run — so it sampled the first 8 and assumed the rest
 * matched. In projects where only some runs log custom charts that assumption
 * fails: the section showed only what those 8 held, changing with the selection
 * order and disappearing when none of them had panels.
 *
 * `runs.customChartPanels` does the union in one Postgres pass instead (~5ms
 * over a 771-run project), scoped to the selected runs so a chart appears when
 * a selected run actually has it — the same rule the media and table sections
 * follow.
 */
export function useCustomChartPanels(
  organizationId: string,
  projectName: string,
  runIds: string[],
): CustomChartPanel[] {
  const { data } = useQuery(
    trpc.runs.customChartPanels.queryOptions(
      { organizationId, projectName, runIds },
      {
        enabled: runIds.length > 0,
        staleTime: 30 * 1000,
        // Keeps the section mounted while a selection change refetches, rather
        // than tearing it down and remounting every chart.
        placeholderData: (prev) => prev,
      },
    ),
  );

  return (data?.panels as CustomChartPanel[] | undefined) ?? NO_PANELS;
}
