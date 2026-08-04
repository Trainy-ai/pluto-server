import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import {
  buildProjectWhere,
  MAX_PROJECT_SEARCH_LENGTH,
} from "../../../../lib/project-search";

export const projectCountProcedure = protectedOrgProcedure
  .input(
    z.object({
      organizationId: z.string(),
      /** Case-insensitive substring filter on project name. */
      search: z.string().max(MAX_PROJECT_SEARCH_LENGTH).optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    const count = await ctx.prisma.projects.count({
      // Shared with projects.list so the pager's page count matches the rows.
      where: buildProjectWhere({
        organizationId: input.organizationId,
        search: input.search,
      }),
    });
    return count;
  });
