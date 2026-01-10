import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { sqidEncode } from "../../../../lib/sqid";

export const listRunsProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
      tags: z.array(z.string()).optional(),
      status: z.array(z.enum(["RUNNING", "COMPLETED", "FAILED", "TERMINATED", "CANCELLED"])).optional(),
      limit: z.number().min(1).max(200).default(10),
      cursor: z.number().optional(),
      direction: z.enum(["forward", "backward"]).default("forward"),
    })
  )
  .query(async ({ ctx, input }) => {
    let runs = await ctx.prisma.runs.findMany({
      include: {
        logs: true,
      },
      where: {
        project: {
          name: input.projectName,
        },
        organizationId: input.organizationId,
        ...(input.tags && input.tags.length > 0
          ? { tags: { hasSome: input.tags } }
          : {}),
        ...(input.status && input.status.length > 0
          ? { status: { in: input.status } }
          : {}),
      },
      orderBy: {
        createdAt: input.direction === "forward" ? "desc" : "asc",
      },
      take: input.limit,
      cursor: input.cursor ? { id: input.cursor } : undefined,
    });

    const nextCursor =
      runs.length === input.limit ? runs[runs.length - 1].id : null;

    // for all the runs, encode the id and return the runs with the encoded id
    const encodedRuns = runs.map((run) => ({
      ...run,
      id: sqidEncode(run.id),
    }));

    return {
      runs: encodedRuns,
      nextCursor,
    };
  });
