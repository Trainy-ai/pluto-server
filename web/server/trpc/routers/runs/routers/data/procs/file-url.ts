import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";
import { getRunFileUrl } from "../../../../../../lib/queries";

export const fileUrlProcedure = protectedOrgProcedure
  .input(
    z.object({
      runId: z.string(),
      projectName: z.string(),
      logName: z.string(),
      fileName: z.string(),
    })
  )
  .query(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName, organizationId, logName, fileName } = input;

    const runId = await resolveRunId(ctx.prisma, encodedRunId, organizationId, projectName);

    const url = await getRunFileUrl({
      organizationId,
      projectName,
      runId,
      logName,
      fileName,
    });

    return { url };
  });
