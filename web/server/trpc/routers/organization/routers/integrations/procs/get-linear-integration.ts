import { protectedOrgProcedure } from "../../../../../../lib/trpc";

export const getLinearIntegrationProcedure = protectedOrgProcedure
  .query(async ({ ctx, input }) => {
    const integration = await ctx.prisma.integration.findUnique({
      where: {
        organizationId_provider: {
          organizationId: input.organizationId,
          provider: "linear",
        },
      },
      select: {
        id: true,
        enabled: true,
        config: true,
        createdAt: true,
      },
    });

    if (!integration) {
      return {
        configured: false,
        enabled: false,
        workspaceSlug: null as string | null,
        workspaceName: null as string | null,
      };
    }

    const config = integration.config as Record<string, unknown>;

    return {
      configured: true,
      enabled: integration.enabled,
      workspaceSlug: ((config.workspaceSlug as string) ?? null) as string | null,
      workspaceName: ((config.workspaceName as string) ?? null) as string | null,
    };
  });
