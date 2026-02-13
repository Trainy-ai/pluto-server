import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { resolveRunId } from "../../../../lib/resolve-run-id";
import { sqidEncode } from "../../../../lib/sqid";

export const getRunProcedure = protectedOrgProcedure
  .input(z.object({ runId: z.string(), projectName: z.string() }))
  .query(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName, organizationId } = input;

    const runId = await resolveRunId(ctx.prisma, encodedRunId, organizationId, projectName);
    const run = await ctx.prisma.runs.findUnique({
      include: {
        // eslint-disable-next-line @mlop/no-unbounded-prisma-include -- Single run fetch, logs needed for UI
        logs: true,
        project: { select: { runPrefix: true } },
      },
      where: {
        id: runId,
        project: {
          name: projectName,
        },
      },
    });

    if (!run) {
      throw new Error("Run not found");
    }

    return {
      ...run,
      encodedId: sqidEncode(run.id),
    };
  });
