import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { sqidEncode } from "../../../../lib/sqid";

export const latestRunsProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string().optional(),
      limit: z.number().min(1).max(100).default(10),
    })
  )
  .query(async ({ ctx, input }) => {
    const { projectName, organizationId, limit } = input;

    const runs = await ctx.prisma.runs.findMany({
      select: {
        project: {
          select: {
            name: true,
          },
        },
        id: true,
        createdAt: true,
        name: true,
        status: true,
        updatedAt: true,
        statusUpdated: true,
      },
      where: {
        project: {
          name: projectName,
          organizationId: organizationId,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: limit,
    });

    // for all the runs, encode the id and return the runs with the encoded id
    const encodedRuns = runs.map((run) => ({
      ...run,
      id: sqidEncode(run.id),
    }));

    return encodedRuns;
  });
