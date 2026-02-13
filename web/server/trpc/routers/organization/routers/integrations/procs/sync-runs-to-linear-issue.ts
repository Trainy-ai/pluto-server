import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { syncRunsToLinearIssue } from "../../../../../../lib/linear-sync";

export const syncRunsToLinearIssueProcedure = protectedOrgProcedure
  .input(
    z.object({
      issueIdentifier: z.string().min(1),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const result = await syncRunsToLinearIssue({
      prisma: ctx.prisma,
      organizationId: input.organizationId,
      issueIdentifier: input.issueIdentifier,
    });

    if (!result.success) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: result.error ?? "Failed to sync to Linear",
      });
    }

    return { success: true };
  });
