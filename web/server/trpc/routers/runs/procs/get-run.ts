import { z } from "zod";
import { TRPCError } from "@trpc/server";
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
        // resolveRunId already verified ownership; re-scoping here keeps the
        // read correct even if a caller ever bypasses the resolver. Project
        // names are unique per org, NOT globally, so `organizationId` is
        // load-bearing.
        organizationId,
        project: {
          name: projectName,
        },
      },
    });

    if (!run) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
    }

    return {
      ...run,
      encodedId: sqidEncode(run.id),
    };
  });
