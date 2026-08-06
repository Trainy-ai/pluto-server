import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { parseSweepBlock, type SweepMeta } from "../sweep-config";
import {
  summarizeStatuses,
  deriveState,
  gridTotal,
  type SweepState,
} from "../sweep-progress";

/**
 * A sweep as it appears in the project list.
 *
 * `method`/`metric` are optional because only *migrated* sweeps carry their
 * search space: `pluto.sweep()` keeps the config client-side in `~/.pluto/sweeps`
 * and injects nothing but the sampled combination, so a native sweep is known to
 * the server purely by its tag. Everything here is therefore derived from data
 * that exists for both kinds, with the wandb block filling in extras when present.
 */
export interface SweepSummary {
  sweepId: string;
  runCount: number;
  lastRun: Date;
  /** True when any run carries `import:wandb` — i.e. migrated rather than native. */
  fromWandb: boolean;
  name?: string;
  method?: string;
  metric?: { name: string; goal: string };
  /** RUNNING while any run is; derived, since there is no sweep entity. */
  state: SweepState;
  /** Total configurations for a grid sweep; null when the space is unbounded. */
  gridTotal: number | null;
}

interface SweepRow {
  sweepId: string;
  runCount: bigint;
  lastRun: Date;
  fromWandb: boolean;
  sweepBlock: unknown;
  statuses: string[];
}

/**
 * List every sweep in a project, one row per distinct `sweep:<id>` tag.
 *
 * Runs are grouped in SQL rather than in JS: a project can hold thousands of
 * runs and we only ever want the per-sweep aggregate, so pulling every row back
 * to count them would be wasteful. `unnest(tags)` turns the array column into
 * one row per tag, which is what lets us GROUP BY the tag itself.
 */
export const listSweepsProcedure = protectedOrgProcedure
  .input(z.object({ projectName: z.string() }))
  .query(async ({ ctx, input }): Promise<{ sweeps: SweepSummary[] }> => {
    const project = await ctx.prisma.projects.findFirst({
      where: { name: input.projectName, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!project) {
      return { sweeps: [] };
    }

    const rows = await ctx.prisma.$queryRawUnsafe<SweepRow[]>(
      `
      SELECT
        t                                        AS "sweepId",
        count(*)                                 AS "runCount",
        max(r."createdAt")                       AS "lastRun",
        bool_or('import:wandb' = ANY(r.tags))    AS "fromWandb",
        array_agg(r.status::text)                AS "statuses",
        -- The declared spec, from whichever key this producer used: wandb
        -- nests it under config.wandb.sweep, the native SDK puts it at
        -- config.sweep. Every run in a sweep carries the same one, so the
        -- first is representative.
        (array_agg(COALESCE(r.config -> 'wandb' -> 'sweep', r.config -> 'sweep'))
           FILTER (WHERE COALESCE(r.config -> 'wandb' -> 'sweep',
                                  r.config -> 'sweep') IS NOT NULL))[1]
                                                 AS "sweepBlock"
      FROM runs r, unnest(r.tags) AS t
      WHERE r."projectId" = $1
        AND r."organizationId" = $2
        AND t LIKE 'sweep:%'
      GROUP BY t
      ORDER BY max(r."createdAt") DESC
      `,
      project.id,
      input.organizationId,
    );

    return {
      sweeps: rows.map((row) => {
        const meta: SweepMeta = parseSweepBlock(row.sweepBlock);
        const statuses = summarizeStatuses(row.statuses ?? []);
        const total = gridTotal(meta.method, meta.parameters);
        return {
          // The tag is `sweep:<id>`; the id alone is what the URL and the
          // client-side registry use.
          sweepId: row.sweepId.slice("sweep:".length),
          runCount: Number(row.runCount),
          lastRun: row.lastRun,
          fromWandb: row.fromWandb,
          state: deriveState(statuses, total),
          gridTotal: total,
          // Field by field, not `...meta`: spreading also shipped the whole
          // declared search space to a list page that never reads it.
          name: meta.name,
          method: meta.method,
          metric: meta.metric,
        };
      }),
    };
  });
