import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { OrganizationRole } from "@prisma/client";
import { protectedOrgProcedure } from "../../../../lib/trpc";

// ClickHouse tables that store per-run data keyed by (tenantId, projectName, ...).
// Same set as runs.delete (see delete-runs.ts for why the `_v2` derivatives must
// be cleaned explicitly — the dedup MVs only react to INSERTs, so an
// ALTER … DELETE on a source table does not propagate).
const CLICKHOUSE_PROJECT_TABLES = [
  "mlop_metrics",
  "mlop_metrics_v2",
  "mlop_metric_summaries",
  "mlop_metric_summaries_v2",
  "mlop_logs",
  "mlop_data",
  "mlop_files",
] as const;

export const deleteProjectProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string().min(1).max(255),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const { organizationId, projectName } = input;

    // Deleting a project wipes every run in it, including runs created by
    // other members — so unlike runs.delete there is no "own runs" carve-out;
    // only owners/admins may do it.
    const isAdminOrOwner =
      ctx.member.role === OrganizationRole.OWNER ||
      ctx.member.role === OrganizationRole.ADMIN;

    if (!isAdminOrOwner) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "Only organization owners or admins can delete projects.",
      });
    }

    const project = await ctx.prisma.projects.findUnique({
      where: {
        organizationId_name: { organizationId, name: projectName },
      },
      select: {
        id: true,
        _count: { select: { runs: true } },
      },
    });

    if (!project) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Project not found.",
      });
    }

    // Delete the Postgres rows first — they're the source of truth, so the
    // project disappears immediately. Runs must be deleted explicitly because
    // Runs.project has no onDelete action (Prisma defaults to Restrict), so a
    // bare project delete would hit a foreign-key error for any non-empty
    // project. Run children (RunLogs, graph, triggers, field values) and the
    // project's views/column keys cascade from their parents.
    await ctx.prisma.$transaction([
      ctx.prisma.runs.deleteMany({
        where: { projectId: project.id, organizationId },
      }),
      ctx.prisma.projects.delete({
        where: { id: project.id },
      }),
    ]);

    // Best-effort ClickHouse cleanup, keyed by (tenantId, projectName). The
    // project is already gone from Postgres, so orphaned time-series rows are
    // unreachable; we don't fail the request if a mutation can't be submitted.
    await Promise.all(
      CLICKHOUSE_PROJECT_TABLES.map(async (table) => {
        try {
          await ctx.clickhouse.query(
            `ALTER TABLE ${table} DELETE WHERE tenantId = {tenantId:String} AND projectName = {projectName:String}`,
            {
              tenantId: organizationId,
              projectName,
            },
            { label: "deleteProject" }
          );
        } catch (err) {
          console.error(
            `[deleteProject] Failed to delete from ClickHouse table ${table}:`,
            err
          );
        }
      })
    );

    return { deletedRunCount: project._count.runs };
  });
