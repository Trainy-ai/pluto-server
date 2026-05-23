import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { OrganizationRole } from "@prisma/client";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { resolveRunId } from "../../../../lib/resolve-run-id";

// ClickHouse tables that store per-run data keyed by (tenantId, projectName, runId).
// Postgres cascades handle relational children (RunLogs, RunFieldValue, etc.), but
// the time-series/blob-metadata rows in ClickHouse must be removed explicitly.
//
// We delete from both the raw source tables and their `_v2` derivatives:
//   - `mlop_metrics` is the ingest source; `mlop_metrics_v2` (ReplacingMergeTree)
//     is populated by a mirror MV (06_metrics_dedup_mv.sql) that only reacts to
//     INSERTs — an ALTER … DELETE on the source does NOT propagate to v2.
//   - `mlop_metric_summaries_v2` is refreshed from `mlop_metrics_v2 FINAL`. Its
//     refresh appends versioned rows (ReplacingMergeTree), so a stale summary row
//     for a deleted run survives unless deleted directly.
// All production reads use the `_v2` tables, so they must be cleaned to actually
// remove a deleted run's data. The legacy tables are cleaned too (source of truth
// + leaderboard hygiene).
const CLICKHOUSE_RUN_TABLES = [
  "mlop_metrics",
  "mlop_metrics_v2",
  "mlop_metric_summaries",
  "mlop_metric_summaries_v2",
  "mlop_logs",
  "mlop_data",
  "mlop_files",
] as const;

export const deleteRunsProcedure = protectedOrgProcedure
  .input(
    z.object({
      runIds: z.array(z.string()).min(1).max(1000),
      projectName: z.string(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const { runIds: encodedRunIds, projectName, organizationId } = input;

    // Resolve each identifier (SQID or display ID) to a numeric run ID,
    // ignoring ones that don't resolve so a single bad id doesn't fail the batch.
    // Resolve in parallel: SQIDs are pure computation, but display IDs hit the DB,
    // so a sequential loop over a 1000-id batch would be an N+1 bottleneck.
    const numericIds = (
      await Promise.all(
        encodedRunIds.map(async (encoded) => {
          try {
            return await resolveRunId(
              ctx.prisma,
              encoded,
              organizationId,
              projectName
            );
          } catch {
            // Skip unresolvable identifiers.
            return null;
          }
        })
      )
    ).filter((id): id is number => id !== null);

    if (numericIds.length === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No matching runs found to delete.",
      });
    }

    // Confirm the runs belong to this org + project.
    const matchedRuns = await ctx.prisma.runs.findMany({
      where: {
        id: { in: numericIds.map((id) => BigInt(id)) },
        organizationId,
        project: { name: projectName },
      },
      select: { id: true, createdById: true },
    });

    if (matchedRuns.length === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No matching runs found or you don't have access to them.",
      });
    }

    // Authorization: owners/admins can delete any run in the org; members can
    // only delete runs they created. Reject the whole batch if a member
    // included runs created by someone else, rather than silently dropping them.
    const isAdminOrOwner =
      ctx.member.role === OrganizationRole.OWNER ||
      ctx.member.role === OrganizationRole.ADMIN;

    if (!isAdminOrOwner) {
      const notOwnedByUser = matchedRuns.filter(
        (r) => r.createdById !== ctx.user.id
      );
      if (notOwnedByUser.length > 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "You can only delete runs you created. Ask an organization owner or admin to delete runs created by others.",
        });
      }
    }

    const ownedIds = matchedRuns.map((r) => r.id);

    // Delete the Postgres rows first — this is the source of truth for the runs
    // table, so the runs disappear immediately. Relational children cascade,
    // and child fork runs have forkedFromRunId set to null (onDelete: SetNull).
    const result = await ctx.prisma.runs.deleteMany({
      where: {
        id: { in: ownedIds },
        organizationId,
        project: { name: projectName },
      },
    });

    // Best-effort ClickHouse cleanup. The runs are already gone from Postgres,
    // so any orphaned time-series rows are harmless (numeric IDs are never
    // reused). We don't fail the request if a mutation can't be submitted.
    const ownedIdStrings = ownedIds.map((id) => id.toString());
    await Promise.all(
      CLICKHOUSE_RUN_TABLES.map(async (table) => {
        try {
          await ctx.clickhouse.query(
            `ALTER TABLE ${table} DELETE WHERE tenantId = {tenantId:String} AND projectName = {projectName:String} AND runId IN {runIds:Array(UInt64)}`,
            {
              tenantId: organizationId,
              projectName,
              runIds: ownedIdStrings,
            },
            { label: "deleteRuns" }
          );
        } catch (err) {
          console.error(
            `[deleteRuns] Failed to delete from ClickHouse table ${table}:`,
            err
          );
        }
      })
    );

    return { deletedCount: result.count };
  });
