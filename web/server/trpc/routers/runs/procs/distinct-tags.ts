import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";

/**
 * Get all distinct tags across all runs in a project.
 * Uses PostgreSQL UNNEST to efficiently extract unique tags from array column.
 */
export const distinctTagsProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
    })
  )
  .query(async ({ ctx, input }) => {
    // Get the project
    const project = await ctx.prisma.projects.findFirst({
      where: {
        name: input.projectName,
        organizationId: input.organizationId,
      },
      select: { id: true },
    });

    if (!project) {
      return { tags: [] };
    }

    // Use raw SQL to efficiently get distinct tags across all runs
    // PostgreSQL's UNNEST expands array into rows, then we get distinct values
    const results = await ctx.prisma.$queryRaw<{ tag: string }[]>`
      SELECT DISTINCT UNNEST(tags) as tag
      FROM "runs"
      WHERE "organizationId" = ${input.organizationId}
        AND "projectId" = ${project.id}
        AND tags IS NOT NULL
        AND array_length(tags, 1) > 0
      ORDER BY tag
    `;

    return {
      tags: results.map((r) => r.tag),
    };
  });
