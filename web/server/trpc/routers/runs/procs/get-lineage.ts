import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { resolveRunId } from "../../../../lib/resolve-run-id";
import { sqidEncode } from "../../../../lib/sqid";

/** Maximum lineage depth to prevent runaway queries */
const MAX_LINEAGE_DEPTH = 10;

interface LineageNode {
  runId: string;
  numericRunId: number;
  displayId: string | null;
  name: string;
  forkStep: number | null;
}

export const getLineageProcedure = protectedOrgProcedure
  .input(
    z.object({
      runId: z.string(),
      projectName: z.string(),
    })
  )
  .query(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName, organizationId } = input;

    const runId = await resolveRunId(
      ctx.prisma,
      encodedRunId,
      organizationId,
      projectName
    );

    // Fetch the current run
    const currentRun = await ctx.prisma.runs.findFirst({
      where: {
        id: BigInt(runId),
        organizationId,
        project: { name: projectName },
      },
      include: {
        project: { select: { runPrefix: true } },
      },
    });

    if (!currentRun) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Run not found",
      });
    }

    // Walk up the lineage to find ancestors
    const ancestors: LineageNode[] = [];
    let currentParentId = currentRun.forkedFromRunId;
    let depth = 0;

    while (currentParentId != null && depth < MAX_LINEAGE_DEPTH) {
      const parentRun = await ctx.prisma.runs.findFirst({
        where: {
          id: currentParentId,
          organizationId,
        },
        include: {
          project: { select: { runPrefix: true } },
        },
      });

      if (!parentRun) {
        break;
      }

      const displayId =
        parentRun.number != null && parentRun.project.runPrefix
          ? `${parentRun.project.runPrefix}-${parentRun.number}`
          : null;

      ancestors.unshift({
        runId: sqidEncode(parentRun.id),
        numericRunId: Number(parentRun.id),
        displayId,
        name: parentRun.name,
        forkStep: parentRun.forkStep != null ? Number(parentRun.forkStep) : null,
      });

      currentParentId = parentRun.forkedFromRunId;
      depth++;
    }

    // Find direct children (forks of this run)
    const childRuns = await ctx.prisma.runs.findMany({
      where: {
        forkedFromRunId: BigInt(runId),
        organizationId,
      },
      include: {
        project: { select: { runPrefix: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const children: LineageNode[] = childRuns.map((child) => {
      const displayId =
        child.number != null && child.project.runPrefix
          ? `${child.project.runPrefix}-${child.number}`
          : null;

      return {
        runId: sqidEncode(child.id),
        numericRunId: Number(child.id),
        displayId,
        name: child.name,
        forkStep: child.forkStep != null ? Number(child.forkStep) : null,
      };
    });

    const currentDisplayId =
      currentRun.number != null && currentRun.project.runPrefix
        ? `${currentRun.project.runPrefix}-${currentRun.number}`
        : null;

    return {
      current: {
        runId: sqidEncode(currentRun.id),
        numericRunId: Number(currentRun.id),
        displayId: currentDisplayId,
        name: currentRun.name,
        forkStep: currentRun.forkStep != null ? Number(currentRun.forkStep) : null,
        forkedFromRunId: currentRun.forkedFromRunId != null
          ? Number(currentRun.forkedFromRunId)
          : null,
      },
      ancestors,
      children,
    };
  });
