import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { LRUCache } from "lru-cache";
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
 * Positive-only cache of "numeric run id N belongs to (org, project)".
 *
 * A SQID is a reversible encoding of the GLOBAL autoincrement id, so decoding
 * one proves nothing about ownership: any signed-in user can mint the SQID of
 * any run in any organization. Every decoded SQID is therefore checked against
 * the caller's organization before it is trusted. Run ids are never reused and
 * a run never moves between organizations or projects, so a positive answer
 * can be kept for the life of the process. Misses are deliberately NOT cached,
 * so a transient DB error (or a run created moments later) is not remembered
 * as "not yours". Bounded so enumerating ids cannot grow it without limit.
 */
const ownershipCache = new LRUCache<string, true>({ max: 50_000 });

function ownershipKey(
  organizationId: string,
  projectName: string | undefined,
  numericId: number,
): string {
  return `${organizationId}:${projectName ?? "*"}:${numericId}`;
}

function decodeSqid(identifier: string): number {
  const decoded = sqidDecode(identifier);
  // sqids decodes ANY alphabet-only string to some number, including values far
  // beyond the BigInt range of `runs.id`; reject those here so junk ids are a
  // 400 instead of a Postgres out-of-range error from the ownership lookup.
  if (decoded === undefined || !Number.isSafeInteger(decoded)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid run identifier" });
  }
  return decoded;
}

async function resolveDisplayId(
  prisma: PrismaClient,
  prefix: string,
  numberStr: string,
  organizationId: string,
  projectName?: string,
): Promise<number> {
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
    throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
  }
  const numericId = Number(run.id);
  displayIdCache.set(cacheKey, numericId);
  return numericId;
}

/**
 * The subset of `numericIds` that belong to (organizationId, projectName).
 * Answers from the ownership cache where it can and verifies the rest with ONE
 * query; every id the query confirms is added to the cache.
 */
async function ownedRunIds(
  prisma: PrismaClient,
  numericIds: readonly number[],
  organizationId: string,
  projectName?: string,
): Promise<Set<number>> {
  const owned = new Set<number>();
  const unverified = new Set<number>();
  for (const id of numericIds) {
    if (ownershipCache.has(ownershipKey(organizationId, projectName, id))) {
      owned.add(id);
    } else {
      unverified.add(id);
    }
  }
  if (unverified.size === 0) return owned;

  const rows = await prisma.runs.findMany({
    where: {
      id: { in: [...unverified] },
      organizationId,
      ...(projectName ? { project: { name: projectName } } : {}),
    },
    select: { id: true },
  });
  for (const row of rows) {
    const id = Number(row.id);
    ownershipCache.set(ownershipKey(organizationId, projectName, id), true);
    owned.add(id);
  }
  return owned;
}

async function assertRunsOwned(
  prisma: PrismaClient,
  numericIds: readonly number[],
  organizationId: string,
  projectName?: string,
): Promise<void> {
  const owned = await ownedRunIds(prisma, numericIds, organizationId, projectName);
  if (numericIds.some((id) => !owned.has(id))) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
  }
}

/**
 * Resolves a run identifier to a numeric run ID.
 * Accepts either:
 *   - Display ID format: "MMP-1" (prefix + number)
 *   - SQID format: "aBcD1" (encoded numeric ID)
 *
 * Both forms are resolved INSIDE the caller's organization (and project, when
 * given): a display id is looked up there, and a decoded SQID is verified to
 * belong there. This is the ownership gate for every proc that takes a run id
 * — callers may trust the returned id. Throws NOT_FOUND for a run that does
 * not exist in that scope and BAD_REQUEST for a malformed identifier.
 *
 * Positive answers are cached in memory (both mappings are immutable), so the
 * hot path stays DB-free for ids seen before.
 */
export async function resolveRunId(
  prisma: PrismaClient,
  identifier: string,
  organizationId: string,
  projectName?: string,
): Promise<number> {
  const match = identifier.match(DISPLAY_ID_REGEX);
  if (match) {
    return resolveDisplayId(prisma, match[1], match[2], organizationId, projectName);
  }
  const decodedId = decodeSqid(identifier);
  await assertRunsOwned(prisma, [decodedId], organizationId, projectName);
  return decodedId;
}

/**
 * Batch form of `resolveRunId`: same contract, applied to every identifier.
 * Returns numeric ids in input order and rejects (NOT_FOUND / BAD_REQUEST) if
 * ANY identifier fails to resolve — for procs where a partial answer would be
 * wrong. All uncached SQIDs are verified with a single query, so a 200-run
 * chart request costs at most one round trip rather than one per run.
 */
export async function resolveRunIds(
  prisma: PrismaClient,
  identifiers: readonly string[],
  organizationId: string,
  projectName?: string,
): Promise<number[]> {
  const resolved = new Array<number>(identifiers.length);
  const displayIds: Array<{ index: number; prefix: string; numberStr: string }> = [];
  const sqids: number[] = [];
  identifiers.forEach((identifier, index) => {
    const match = identifier.match(DISPLAY_ID_REGEX);
    if (match) {
      displayIds.push({ index, prefix: match[1], numberStr: match[2] });
    } else {
      // Throws synchronously on a malformed id, before any DB work starts.
      resolved[index] = decodeSqid(identifier);
      sqids.push(resolved[index]);
    }
  });

  await Promise.all([
    assertRunsOwned(prisma, sqids, organizationId, projectName),
    ...displayIds.map(async ({ index, prefix, numberStr }) => {
      resolved[index] = await resolveDisplayId(prisma, prefix, numberStr, organizationId, projectName);
    }),
  ]);
  return resolved;
}

/**
 * Resolve a BATCH of run identifiers, SKIPPING any that fail to resolve
 * (deleted / unauthorized / malformed id) instead of rejecting the whole batch.
 *
 * `resolveRunIds` rejects on a bad id — correct for a proc that needs every
 * run, but in a widget proc one bad run would 500 the entire widget. Here a
 * batch widget renders its valid runs and silently drops the bad ones. Only
 * per-id failures are swallowed; a DB error still rejects.
 *
 * Returns successful `{ enc, num }` pairs only; order is not guaranteed.
 */
export async function resolveRunIdsResilient(
  prisma: PrismaClient,
  identifiers: readonly string[],
  organizationId: string,
  projectName?: string,
): Promise<Array<{ enc: string; num: number }>> {
  const candidates: Array<{ enc: string; num: number }> = [];
  const displayLookups: Array<Promise<{ enc: string; num: number } | null>> = [];
  for (const enc of identifiers) {
    const match = enc.match(DISPLAY_ID_REGEX);
    if (match) {
      displayLookups.push(
        resolveDisplayId(prisma, match[1], match[2], organizationId, projectName).then(
          (num) => ({ enc, num }),
          () => null,
        ),
      );
      continue;
    }
    try {
      candidates.push({ enc, num: decodeSqid(enc) });
    } catch {
      // Malformed SQID — skip it.
    }
  }

  const [owned, fromDisplayIds] = await Promise.all([
    ownedRunIds(prisma, candidates.map((c) => c.num), organizationId, projectName),
    Promise.all(displayLookups),
  ]);
  const resolved = candidates.filter((c) => owned.has(c.num));
  for (const r of fromDisplayIds) {
    if (r) resolved.push(r);
  }
  return resolved;
}
