import { z } from "zod";
import { OrganizationRole, PrismaClient } from "@prisma/client";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { TRPCError } from "@trpc/server";

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export const transferOwnershipProcedure = protectedOrgProcedure
  .input(
    z.object({
      newOwnerId: z.string(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    // Start a transaction
    return await ctx.prisma.$transaction(async (tx: TransactionClient) => {
      // Check if current user is the owner
      const currentOwner = await tx.member.findFirst({
        where: {
          organizationId: input.organizationId,
          userId: ctx.user.id,
          role: OrganizationRole.OWNER,
        },
      });

      if (!currentOwner) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the organization owner can transfer ownership",
        });
      }

      // Check if new owner exists and is currently an admin
      const newOwner = await tx.member.findFirst({
        where: {
          organizationId: input.organizationId,
          userId: input.newOwnerId,
          role: OrganizationRole.ADMIN,
        },
        include: {
          user: true,
        },
      });

      if (!newOwner) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "New owner must be an existing admin in the organization",
        });
      }

      // Update the roles in a transaction
      const [formerOwner, newOwnerUpdated] = await Promise.all([
        // Demote current owner to admin
        tx.member.update({
          where: {
            id: currentOwner.id,
          },
          data: {
            role: OrganizationRole.ADMIN,
          },
          include: {
            user: true,
          },
        }),
        // Promote new owner
        tx.member.update({
          where: {
            id: newOwner.id,
          },
          data: {
            role: OrganizationRole.OWNER,
          },
          include: {
            user: true,
          },
        }),
      ]);

      return {
        success: true,
        previousOwner: formerOwner,
        newOwner: newOwnerUpdated,
      };
    });
  });
