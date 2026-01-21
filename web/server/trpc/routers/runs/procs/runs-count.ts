import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { countRunsWithSearch } from "../../../../lib/run-search";

export const countRunsProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
      search: z.string().optional(),
      tags: z.array(z.string()).optional(),
      status: z.array(z.enum(["RUNNING", "COMPLETED", "FAILED", "TERMINATED", "CANCELLED"])).optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    // If search is provided, use search count
    if (input.search && input.search.trim()) {
      return countRunsWithSearch(ctx.prisma, {
        organizationId: input.organizationId,
        projectName: input.projectName,
        search: input.search.trim(),
        tags: input.tags,
        status: input.status,
      });
    }

    // Standard count without search
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
