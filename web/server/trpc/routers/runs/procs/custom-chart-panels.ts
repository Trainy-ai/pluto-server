import { protectedOrgProcedure } from "../../../../lib/trpc";
import { sqidDecode } from "../../../../lib/sqid";
import { getCached, setCached, buildBatchCacheKey } from "../../../../lib/cache";
import { customChartPanelsInput } from "./custom-chart-panels.schema";

/** Fixed 30s TTL — mirrors distinctFileLogNamesProcedure, the sibling discovery
 *  proc for the other sections on this page. */
const PANELS_TTL = 30 * 1000;

/** A migrated wandb `wandb.plot.*` panel definition. Mirrors the frontend's
 *  CustomChartPanel; extra keys ride along untouched. */
interface CustomChartPanel {
  key: string;
  tableKey: string;
  [k: string]: unknown;
}

/**
 * Custom-chart panels across the selected runs.
 *
 * Every other section on the comparison page is discovered from a registry —
 * metrics from mlop_metric_summaries, media/tables/histograms from run_logs.
 * Custom charts have no registry row: they are panel DEFINITIONS (a Vega spec
 * plus a table pointer) that wandb's exporter parks in `config.wandb
 * .custom_charts`, so they can only be found by reading run configs.
 *
 * The frontend used to do that itself and, because one `runs.get` per selected
 * run is untenable, sampled the first 8 — assuming every run in a migrated
 * project carries the same list. Projects where only some runs log custom
 * charts broke that assumption: the section showed whatever those 8 happened to
 * hold, so it gained and lost charts as the selection order changed, and
 * vanished entirely when none of the 8 had any.
 *
 * One indexed pass over the selection replaces the sample. Scoped to the
 * selected runs (not the project) to match every other section: a chart appears
 * when a selected run actually has it.
 */
export const customChartPanelsProcedure = protectedOrgProcedure
  .input(customChartPanelsInput)
  .query(async ({ ctx, input }) => {
    const numericRunIds = input.runIds
      .map((sqid) => sqidDecode(sqid))
      .filter((id): id is number => Number.isFinite(id));

    const cacheKey = buildBatchCacheKey("customChartPanels", {
      orgId: input.organizationId,
      projectName: input.projectName,
      runIds: numericRunIds,
    });

    const cached = await getCached<{ panels: CustomChartPanel[] }>(cacheKey);
    if (cached) return cached;

    const project = await ctx.prisma.projects.findFirst({
      where: { name: input.projectName, organizationId: input.organizationId },
      select: { id: true },
    });

    if (!project || numericRunIds.length === 0) return { panels: [] };

    // DISTINCT ON dedupes by panel key the way the old client-side union did:
    // every run carrying a panel repeats the same definition.
    const rows = await ctx.prisma.$queryRawUnsafe<{ panel: CustomChartPanel }[]>(
      `
      SELECT DISTINCT ON (e->>'key') e AS panel
      FROM runs r
      INNER JOIN projects p ON r."projectId" = p.id,
      LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(r.config->'wandb'->'custom_charts') = 'array'
          THEN r.config->'wandb'->'custom_charts'
          ELSE '[]'::jsonb
        END
      ) e
      WHERE p.id = $1
        AND r."organizationId" = $2
        AND r.id = ANY($3::bigint[])
        AND e->>'key' IS NOT NULL
        AND e->>'tableKey' IS NOT NULL
      ORDER BY e->>'key'
      `,
      project.id,
      input.organizationId,
      numericRunIds.map((id) => BigInt(id)),
    );

    const panels = rows
      .map((row) => row.panel)
      .filter(
        (p): p is CustomChartPanel =>
          !!p && typeof p.key === "string" && typeof p.tableKey === "string",
      );

    const result = { panels };
    await setCached(cacheKey, result, PANELS_TTL);
    return result;
  });
