import { z } from "zod";
import { OrganizationRole, type Prisma } from "@prisma/client";
import { platformAdminProcedure } from "../../../../lib/trpc";
import { EDU_SUBSCRIPTION_ID, needsBillingSetup } from "../../../../lib/stripe";

const PAGE_SIZE = 50;

export const listOrganizationsProcedure = platformAdminProcedure
  .input(
    z.object({
      // Matches org name, slug or id, or the email of any member.
      search: z.string().trim().max(200).optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    const search = input.search;
    const where: Prisma.OrganizationWhereInput | undefined = search
      ? {
          OR: [
            { id: search },
            { name: { contains: search, mode: "insensitive" } },
            { slug: { contains: search, mode: "insensitive" } },
            {
              members: {
                some: {
                  user: { email: { contains: search, mode: "insensitive" } },
                },
              },
            },
          ],
        }
      : undefined;

    const organizations = await ctx.prisma.organization.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        _count: { select: { members: true } },
        members: {
          where: { role: OrganizationRole.OWNER },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { user: { select: { name: true, email: true } } },
        },
        OrganizationSubscription: {
          select: { plan: true, stripeSubscriptionId: true },
        },
      },
    });

    return organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      createdAt: organization.createdAt,
      memberCount: organization._count.members,
      owner: organization.members[0]?.user ?? null,
      plan: organization.OrganizationSubscription?.plan ?? null,
      isEducationPlan:
        organization.OrganizationSubscription?.stripeSubscriptionId ===
        EDU_SUBSCRIPTION_ID,
      needsBillingSetup: organization.OrganizationSubscription
        ? needsBillingSetup(organization.OrganizationSubscription)
        : false,
    }));
  });
