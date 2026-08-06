import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import type { CustomChartPanel } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/group/custom-chart-view";

/**
 * How many selected runs are asked for their panel definitions.
 *
 * Panels are a property of the wandb *project* — every run in a migrated
 * project that logged a given `wandb.plot.*` chart carries the same entry — so
 * a handful of runs is enough to discover the set, and unioning a few covers
 * the case where only some runs logged a given chart. Probing all of them would
 * cost one `runs.get` per selected run, which on a 200-run project is 200
 * requests to learn nothing new.
 */
const PANEL_PROBE_RUNS = 8;

/**
 * Migrated wandb custom-chart panels (`wandb.plot.*`) across the selected runs.
 *
 * The exporter parks these on run config rather than in the log registry, so
 * unlike every other widget on this page they cannot be discovered from
 * `groupedMetrics` — they have to be read out of the runs themselves.
 */
export function useCustomChartPanels(
  organizationId: string,
  projectName: string,
  runIds: string[],
): CustomChartPanel[] {
  const probeIds = useMemo(() => runIds.slice(0, PANEL_PROBE_RUNS), [runIds]);

  const runQueries = useQueries({
    queries: probeIds.map((runId) =>
      trpc.runs.get.queryOptions({ organizationId, projectName, runId }),
    ),
  });

  const configs = runQueries.map((q) => q.data?.config);

  return useMemo(() => {
    const byKey = new Map<string, CustomChartPanel>();
    for (const config of configs) {
      const panels = (config as { wandb?: { custom_charts?: unknown } } | null | undefined)
        ?.wandb?.custom_charts;
      if (!Array.isArray(panels)) continue;
      for (const p of panels) {
        if (!p || typeof p !== "object") continue;
        const panel = p as CustomChartPanel;
        if (typeof panel.tableKey !== "string" || typeof panel.key !== "string") continue;
        if (!byKey.has(panel.key)) byKey.set(panel.key, panel);
      }
    }
    return [...byKey.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(configs.map((c) => (c as { wandb?: unknown })?.wandb ?? null))]);
}
