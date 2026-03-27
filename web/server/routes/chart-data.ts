/**
 * Raw Hono endpoint for heavy chart data queries.
 * Bypasses tRPC/superjson serialization which adds ~2s overhead on 7+ MB responses.
 * Uses native JSON.stringify instead.
 */
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { clickhouse } from "../lib/clickhouse";
import { resolveRunId } from "../lib/resolve-run-id";
import { queryRunMetricsMultiMetricBatchBucketed, toColumnar } from "../lib/queries";
import { getCached, setCached, getTTLForStatus, type RunStatus } from "../lib/cache";

const app = new Hono();

const inputSchema = z.object({
  organizationId: z.string(),
  projectName: z.string(),
  runIds: z.array(z.string()).min(1).max(200),
  logNames: z.array(z.string()).min(1).max(200),
  buckets: z.number().int().min(10).max(20000).optional(),
  stepMin: z.number().int().nonnegative().optional(),
  stepMax: z.number().int().nonnegative().optional(),
});

app.get("/multi-metric-batch-bucketed", async (c) => {
  // Session auth
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Parse input from query param
  const raw = c.req.query("input");
  if (!raw) {
    return c.json({ error: "Missing input parameter" }, 400);
  }

  let input: z.infer<typeof inputSchema>;
  try {
    input = inputSchema.parse(JSON.parse(raw));
  } catch (e) {
    return c.json({ error: "Invalid input" }, 400);
  }

  const { organizationId, projectName, runIds: encodedRunIds, logNames, buckets, stepMin, stepMax } = input;

  // Verify org membership
  const member = await prisma.member.findFirst({
    where: {
      organizationId,
      userId: session.user.id,
    },
  });
  if (!member) {
    return c.json({ error: "Not a member of this organization" }, 403);
  }

  // Cache key
  const sortedRuns = [...encodedRunIds].sort().join(",");
  const sortedMetrics = [...logNames].sort().join(",");
  const cacheKey = `mlop:graphMultiMetricBatch:${organizationId}:${projectName}:r=${sortedRuns}:m=${sortedMetrics}:b=${buckets ?? ""}:s=${stepMin ?? ""}-${stepMax ?? ""}`;

  // Check cache — return pre-stringified JSON directly
  const cached = await getCached<string>(cacheKey + ":raw");
  if (cached) {
    return new Response(cached, {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Resolve run IDs
  const numericRunIds = await Promise.all(
    encodedRunIds.map((id) => resolveRunId(prisma, id, organizationId, projectName))
  );

  const numericToEncoded = new Map<number, string>();
  encodedRunIds.forEach((encoded, i) => {
    numericToEncoded.set(numericRunIds[i], encoded);
  });

  const grouped = await queryRunMetricsMultiMetricBatchBucketed(clickhouse, {
    organizationId,
    projectName,
    runIds: numericRunIds,
    logNames,
    buckets,
    stepMin,
    stepMax,
  });

  // Re-key by encoded run ID and convert to columnar format
  const result: Record<string, Record<string, unknown>> = {};
  for (const [logName, byNumericRun] of Object.entries(grouped)) {
    const byEncodedRun: Record<string, unknown> = {};
    for (const [numericId, points] of Object.entries(byNumericRun)) {
      const encoded = numericToEncoded.get(Number(numericId));
      if (encoded) {
        byEncodedRun[encoded] = toColumnar(points);
      }
    }
    result[logName] = byEncodedRun;
  }

  // Native JSON.stringify — no superjson overhead
  const json = JSON.stringify(result);

  // Cache the raw JSON string
  const runs = await prisma.runs.findMany({
    where: { id: { in: numericRunIds } },
    select: { status: true },
  });
  const ttl = Math.min(...runs.map((r) => getTTLForStatus(r.status as RunStatus)));
  await setCached(cacheKey + ":raw", json, ttl);

  return new Response(json, {
    headers: { "Content-Type": "application/json" },
  });
});

export default app;
