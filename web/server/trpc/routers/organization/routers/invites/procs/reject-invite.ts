import {
  protectedOrgProcedure,
  protectedProcedure,
} from "../../../../../../lib/trpc";
import { InvitationStatus } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

export const rejectInviteProcedure = protectedProcedure
  .input(z.object({ invitationId: z.string() }))
  .mutation(async ({ ctx, input }) => {
    const invitation = await ctx.prisma.invitation.findFirst({
      where: { id: input.invitationId, email: ctx.user.email },
    });

    if (!invitation) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Invalid or expired invitation",
      });
    }

    await ctx.prisma.invitation.update({
      where: { id: input.invitationId },
      data: { status: InvitationStatus.DECLINED },
    });

    return invitation;
  });
