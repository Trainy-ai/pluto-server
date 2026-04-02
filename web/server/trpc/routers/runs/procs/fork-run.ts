import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { RunStatus } from "@prisma/client";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { resolveRunId } from "../../../../lib/resolve-run-id";
import { sqidEncode } from "../../../../lib/sqid";
import { resolveForkParent, validateForkStep } from "../../../../lib/fork-helpers";

export const forkRunProcedure = protectedOrgProcedure
  .input(
    z.object({
      runId: z.string(),
      projectName: z.string(),
      forkStep: z.number().int().min(0),
      newRunName: z.string().optional(),
      inheritConfig: z.boolean().default(true),
      inheritTags: z.boolean().default(false),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const {
      runId: encodedRunId,
      projectName,
      organizationId,
      forkStep,
      newRunName,
      inheritConfig,
      inheritTags,
    } = input;

    const requestedParentId = await resolveRunId(
      ctx.prisma,
      encodedRunId,
      organizationId,
      projectName
    );

    // Fetch requested parent run with project info
    const requestedParent = await ctx.prisma.runs.findFirst({
      where: {
        id: BigInt(requestedParentId),
        organizationId,
        project: { name: projectName },
      },
      include: {
        project: { select: { id: true, name: true, runPrefix: true } },
      },
    });

    if (!requestedParent) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Parent run not found",
      });
    }

    // Resolve lineage: walk up to find the ancestor that owns the forkStep
    const resolvedParent = await resolveForkParent(
      ctx.prisma, requestedParent, forkStep, organizationId
    );

    // Validate forkStep against the resolved parent's actual max step
    const validationError = await validateForkStep(
      ctx.clickhouse, organizationId, projectName, resolvedParent.id, forkStep
    );
    if (validationError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: validationError });
    }

    // Build child run data from the resolved parent
    const childConfig = inheritConfig ? resolvedParent.config : undefined;
    const childTags = inheritTags ? resolvedParent.tags : [];
    const childName =
      newRunName || `${requestedParent.name}-fork-${Date.now().toString(36)}`;

    // Atomically increment project run counter
    const updatedProject = await ctx.prisma.projects.update({
      where: { id: requestedParent.project.id },
      data: { nextRunNumber: { increment: 1 } },
      select: { nextRunNumber: true },
    });
    const runNumber = updatedProject.nextRunNumber - 1;

    // Create the forked run pointing to the resolved parent
    const childRun = await ctx.prisma.runs.create({
      data: {
        name: childName,
        number: runNumber,
        projectId: requestedParent.project.id,
        organizationId,
        tags: childTags,
        status: RunStatus.RUNNING,
        config: childConfig ?? undefined,
        systemMetadata: requestedParent.systemMetadata ?? undefined,
        createdById: ctx.user.id,
        creatorApiKeyId: requestedParent.creatorApiKeyId,
        forkedFromRunId: resolvedParent.id,
        forkStep: BigInt(forkStep),
      },
      select: { id: true, number: true },
    });

    const encodedId = sqidEncode(childRun.id);
    const displayId =
      childRun.number != null && requestedParent.project.runPrefix
        ? `${requestedParent.project.runPrefix}-${childRun.number}`
        : null;

    return {
      runId: encodedId,
      numericRunId: Number(childRun.id),
      displayId,
      name: childName,
      forkedFromRunId: Number(resolvedParent.id),
      forkStep,
    };
  });
