import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { resolveRunId } from "../../../../lib/resolve-run-id";
import { sqidEncode } from "../../../../lib/sqid";

export const getByIdsProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
      runIds: z.array(z.string()).max(50),
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

    return {
      runs: runs.map((r) => ({ ...r, id: sqidEncode(r.id) })),
    };
  });
