import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import {
  ChartsLayoutConfigSchema,
  createEmptyChartsLayoutConfig,
} from "../../../../lib/charts-layout-types";

/**
 * Fetch the shared layout overlay for a project's default Charts view.
 * Returns an empty (no-op) layout when the project has none saved yet, so the
 * client can always rely on a well-formed config.
 */
export const getLayoutProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
    })
  )
  .query(async ({ ctx, input }) => {
    const { organizationId, projectName } = input;

    // Single query: unknown project and no-saved-layout both fall through to
    // the empty config, so the project row itself is never needed here.
    const layout = await ctx.prisma.chartsLayout.findFirst({
      where: {
        organizationId,
        project: { name: projectName },
      },
    });

    if (!layout) {
      return { config: createEmptyChartsLayoutConfig(), updatedAt: null };
    }

    return {
      config: ChartsLayoutConfigSchema.parse(layout.config),
      updatedAt: layout.updatedAt,
    };
  });
