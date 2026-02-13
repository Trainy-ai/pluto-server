import { TRPCError } from "@trpc/server";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";

export const removeLinearIntegrationProcedure = protectedOrgProcedure
  .mutation(async ({ ctx, input }) => {
    if (ctx.member.role !== "OWNER" && ctx.member.role !== "ADMIN") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only admins can manage integrations",
      });
    }

    await ctx.prisma.integration.deleteMany({
      where: {
        organizationId: input.organizationId,
        provider: "linear",
      },
    });

    return { success: true };
  });
