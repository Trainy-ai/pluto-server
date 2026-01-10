import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";

export const countRunsProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
      tags: z.array(z.string()).optional(),
      status: z.array(z.enum(["RUNNING", "COMPLETED", "FAILED", "TERMINATED", "CANCELLED"])).optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    const runs = await ctx.prisma.runs.count({
      where: {
        project: {
          name: input.projectName,
        },
        organizationId: input.organizationId,
        ...(input.tags && input.tags.length > 0 && {
          tags: {
            hasSome: input.tags,
          },
        }),
        ...(input.status && input.status.length > 0 && {
          status: {
            in: input.status,
          },
        }),
      },
    });

    return runs;
  });
