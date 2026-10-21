import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { OrganizationRole } from "@prisma/client";
import { platformAdminProcedure } from "../../../../lib/trpc";
import { startProCheckout } from "../../../../lib/pro-checkout";
import { env } from "../../../../lib/env";

/**
 * Opens the same PRO checkout an org owner gets from their billing page, for
 * an org the admin is not a member of, so a promotion code can be applied on
 * the customer's behalf without adding the admin to their org.
 */
export const createCheckoutSessionProcedure = platformAdminProcedure
  .input(
    z.object({
      organizationId: z.string(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    // The Stripe customer should be the org's owner, not the admin.
    const owner = await ctx.prisma.member.findFirst({
      where: {
        organizationId: input.organizationId,
        role: OrganizationRole.OWNER,
      },
      orderBy: { createdAt: "asc" },
      select: { user: { select: { email: true } } },
    });

    if (!owner) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Organization not found or has no owner",
      });
    }

    // Come back to the admin page, under whichever org the admin is viewing it from.
    const activeOrganizationId = ctx.session.session.activeOrganizationId;
    const adminOrg = activeOrganizationId
      ? await ctx.prisma.organization.findUnique({
          where: { id: activeOrganizationId },
          select: { slug: true },
        })
      : null;
    const adminPage = adminOrg
      ? `${env.BETTER_AUTH_URL}/o/${adminOrg.slug}/settings/admin`
      : `${env.BETTER_AUTH_URL}/o`;

    console.log(
      `[platform-admin] ${ctx.user.email} opened a PRO checkout for organization ${input.organizationId}`
    );

    return startProCheckout({
      organizationId: input.organizationId,
      customerEmail: owner.user.email,
      returnUrls: (orgSlug) => ({
        successUrl: `${adminPage}?upgraded=${encodeURIComponent(orgSlug)}`,
        cancelUrl: adminPage,
      }),
    });
  });
