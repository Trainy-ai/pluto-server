import type { PrismaClient } from "@prisma/client";
import { sqidDecode } from "./sqid";

/**
 * Regex to detect display ID format: PREFIX-NUMBER (e.g., "MMP-1", "R50-42")
 * SQIDs use only [a-zA-Z0-9] (no dashes), so there's no ambiguity.
 */
const DISPLAY_ID_REGEX = /^([A-Za-z0-9]+)-(\d+)$/;

/**
 * In-memory cache for display ID → numeric ID mappings.
 * These are immutable (a run's numeric ID never changes), so no TTL needed.
 * Key format: "orgId:prefix:number" or "orgId:projectName:prefix:number"
 */
const displayIdCache = new Map<string, number>();

/**
 * Resolves a run identifier to a numeric run ID.
 * Accepts either:
 *   - Display ID format: "MMP-1" (prefix + number)
 *   - SQID format: "aBcD1" (encoded numeric ID)
 *
 * Display ID lookups are cached in-memory (immutable mapping).
 * SQID decodes are pure computation (no DB call).
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
    const cacheKey = projectName
      ? `${organizationId}:${projectName}:${prefix.toUpperCase()}:${numberStr}`
      : `${organizationId}:${prefix.toUpperCase()}:${numberStr}`;

    const cached = displayIdCache.get(cacheKey);
    if (cached !== undefined) return cached;

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
    const numericId = Number(run.id);
    displayIdCache.set(cacheKey, numericId);
    return numericId;
  }
  const decodedId = sqidDecode(identifier);
  if (decodedId === undefined) {
    throw new Error("Invalid run identifier");
  }
  return decodedId;
}

/**
 * Resolve a BATCH of run identifiers, SKIPPING any that fail to resolve
 * (deleted / unauthorized / malformed id) instead of rejecting the whole batch.
 *
 * `resolveRunId` throws on a bad id — correct for a single-run proc, but in a
 * batched proc one bad run would reject the whole `Promise.all` and 500 the
 * entire widget. Here we resolve in parallel and keep only the successes, so a
 * batch widget renders its valid runs and silently drops the bad ones.
 *
 * Returns successful `{ enc, num }` pairs only; order is not guaranteed.
 */
export async function resolveRunIdsResilient(
  prisma: PrismaClient,
  identifiers: readonly string[],
  organizationId: string,
  projectName?: string,
): Promise<Array<{ enc: string; num: number }>> {
  const settled = await Promise.allSettled(
    identifiers.map(async (enc) => ({
      enc,
      num: await resolveRunId(prisma, enc, organizationId, projectName),
    })),
  );
  const resolved: Array<{ enc: string; num: number }> = [];
  for (const r of settled) {
    if (r.status === "fulfilled") resolved.push(r.value);
  }
  return resolved;
}
