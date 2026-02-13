import type { PrismaClient } from "@prisma/client";
import { sqidDecode } from "./sqid";

/**
 * Regex to detect display ID format: PREFIX-NUMBER (e.g., "MMP-1", "R50-42")
 * SQIDs use only [a-zA-Z0-9] (no dashes), so there's no ambiguity.
 */
const DISPLAY_ID_REGEX = /^([A-Za-z0-9]+)-(\d+)$/;

/**
 * Resolves a run identifier to a numeric run ID.
 * Accepts either:
 *   - Display ID format: "MMP-1" (prefix + number)
 *   - SQID format: "aBcD1" (encoded numeric ID)
 */
export async function resolveRunId(
  prisma: PrismaClient,
  identifier: string,
  organizationId: string,
  projectName?: string,
): Promise<number> {
  const match = identifier.match(DISPLAY_ID_REGEX);
  if (match) {
    const [, prefix, numberStr] = match;
    const run = await prisma.runs.findFirst({
      where: {
        number: parseInt(numberStr, 10),
        organizationId,
        project: {
          runPrefix: prefix.toUpperCase(),
          ...(projectName ? { name: projectName } : {}),
        },
      },
      select: { id: true },
    });
    if (!run) {
      throw new Error("Run not found");
    }
    return Number(run.id);
  }
  const decodedId = sqidDecode(identifier);
  if (decodedId === undefined) {
    throw new Error("Invalid run identifier");
  }
  return decodedId;
}
