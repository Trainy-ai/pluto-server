import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { resolveRunId } from "../../../../lib/resolve-run-id";
import { sqidEncode } from "../../../../lib/sqid";

export const getByIdsProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
      runIds: z.array(z.string()).max(100),
    }),
  )
  .query(async ({ ctx, input }) => {
    const { projectName, organizationId, runIds } = input;

    if (runIds.length === 0) {
      return { runs: [] };
    }

    // Resolve all IDs (handles both SQID and display ID formats)
    const numericIds = await Promise.all(
      runIds.map((id) =>
        resolveRunId(ctx.prisma, id, organizationId, projectName).catch(
          () => null,
        ),
      ),
    );
    const validIds = numericIds.filter((id): id is number => id !== null);

    if (validIds.length === 0) {
      return { runs: [] };
    }

    const runs = await ctx.prisma.runs.findMany({
      where: {
        id: { in: validIds },
        project: { name: projectName },
        organizationId,
      },
      select: {
        id: true,
        name: true,
        number: true,
        status: true,
        statusUpdated: true,
        createdAt: true,
        updatedAt: true,
        tags: true,
        notes: true,
        externalId: true,
        creator: { select: { name: true, email: true } },
        project: { select: { runPrefix: true } },
      },
    });

    // Enrich with field values so custom columns render immediately
    const fieldRows = await ctx.prisma.runFieldValue.findMany({
      where: { runId: { in: runs.map((r) => r.id) } },
      select: { runId: true, source: true, key: true, textValue: true, numericValue: true },
    });
    const byRun = new Map<number, { config: Record<string, unknown>; systemMetadata: Record<string, unknown> }>();
    for (const row of fieldRows) {
      let entry = byRun.get(Number(row.runId));
      if (!entry) {
        entry = { config: {}, systemMetadata: {} };
        byRun.set(Number(row.runId), entry);
      }
      const value = row.numericValue ?? row.textValue ?? null;
      if (row.source === "config") entry.config[row.key] = value;
      else if (row.source === "systemMetadata") entry.systemMetadata[row.key] = value;
    }

    return {
      runs: runs.map((r) => {
        const fv = byRun.get(Number(r.id));
        return {
          ...r,
          id: sqidEncode(r.id),
          ...(fv ? { _flatConfig: fv.config, _flatSystemMetadata: fv.systemMetadata } : {}),
        };
      }),
    };
  });
