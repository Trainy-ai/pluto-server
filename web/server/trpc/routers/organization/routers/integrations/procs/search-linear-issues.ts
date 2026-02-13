import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { decrypt } from "../../../../../../lib/encryption";
import { searchIssues } from "../../../../../../lib/linear-client";

export const searchLinearIssuesProcedure = protectedOrgProcedure
  .input(
    z.object({
      query: z.string().min(1),
      limit: z.number().min(1).max(50).default(10),
    })
  )
  .query(async ({ ctx, input }) => {
    const integration = await ctx.prisma.integration.findUnique({
      where: {
        organizationId_provider: {
          organizationId: input.organizationId,
          provider: "linear",
        },
      },
    });

    if (!integration || !integration.enabled) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Linear integration is not configured",
      });
    }

    const token = decrypt(integration.encryptedToken);
    const issues = await searchIssues(token, input.query, input.limit);

    return issues.map((issue) => ({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      stateName: issue.state.name,
      stateColor: issue.state.color,
      teamKey: issue.team.key,
    }));
  });
