import { z } from "zod";
import { protectedProcedure } from "../../../../lib/trpc";

export const checkSlugAvailabilityProcedure = protectedProcedure
  .input(z.object({ slug: z.string() }))
  .query(async ({ ctx, input }) => {
    const existingOrganization = await ctx.prisma.organization.findFirst({
      where: { slug: input.slug },
    });

    return { available: !existingOrganization };
  });
