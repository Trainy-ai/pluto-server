/**
 * Dedup correctness — engine-level FINAL on mlop_metrics_v2 + the refreshable
 * mlop_metric_summaries_v2 MV.
 *
 * Walks the spec in three phases against a single (run, metric, step) tuple:
 *
 *   DD.1 — insert (step=1, value=1) → chart read returns 1
 *   DD.2 — overwrite (step=1, value=-1) with strictly later `time` → chart
 *           read returns -1 (mlop_metrics_v2 ReplacingMergeTree(time) keeps
 *           the row with max `time` per primary key; FINAL applies the
 *           collapse at query time before merges land)
 *   DD.3 — SYSTEM REFRESH + poll → summary aggregates show MIN=MAX=AVG=-1,
 *           count=1 (refreshable MV recomputes from v2 FINAL, so the
 *           leaderboard never doubles `count`/`sum` or latches onto the
 *           overwritten value)
 *
 * Without dedup, DD.3 would observe MIN=-1, MAX=1, AVG=0, count=2 — exactly
 * the leaderboard-corruption behavior the v2 + refreshable MV swap fixes.
 *
 * Inserts go through `mlop_metrics`; the mirror MV `mlop_metrics_v2_mv`
 * propagates synchronously, so the test never writes to v2 directly.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createClient, type ClickHouseClient } from "@clickhouse/client-web";
import { queryRunMetricsBatchBucketedByLogName } from "../lib/queries";
import { queryMetricSummariesBatch } from "../lib/queries/metric-summaries";
import { clickhouse } from "../lib/clickhouse";

const TEST_ORG_SLUG = process.env.TEST_ORG_SLUG || "smoke-test-org";
const TEST_PROJECT_NAME = process.env.TEST_PROJECT_NAME || "smoke-test-project";
const RUN_NAME = "dedup-correctness-smoke";
const LOG_NAME = "dedup/y";
const LOG_GROUP = "dedup";
const STEP = 1;

// Picked timestamps far enough apart that DateTime64(3) rounding can't tie them.
const FIRST_TIME = new Date("2026-05-01T00:00:00.000Z");
const SECOND_TIME = new Date("2026-05-01T00:00:01.000Z");

const prisma = new PrismaClient();

// Raw client for INSERT / ALTER / SYSTEM REFRESH. The exported `clickhouse`
// singleton in lib/clickhouse.ts only exposes .query() — see setup.ts for
// the same split-client pattern.
let rawCh: ClickHouseClient | null = null;

let orgId: string | null = null;
let runId: number | null = null;
let fixturesAvailable = false;

function chTime(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}

async function insertMetric(value: number, time: Date): Promise<void> {
  await rawCh!.insert({
    table: "mlop_metrics",
    values: [
      {
        tenantId: orgId!,
        projectName: TEST_PROJECT_NAME,
        runId: runId!,
        logGroup: LOG_GROUP,
        logName: LOG_NAME,
        time: chTime(time),
        step: STEP,
        value,
      },
    ],
    format: "JSONEachRow",
  });
}

async function readBucketedValueAtStep(): Promise<number | null | undefined> {
  const grouped = await queryRunMetricsBatchBucketedByLogName(clickhouse, {
    organizationId: orgId!,
    projectName: TEST_PROJECT_NAME,
    runIds: [runId!],
    logName: LOG_NAME,
    buckets: 1000,
  });
  const points = grouped[runId!];
  if (!points || points.length === 0) return undefined;
  // Bounds CTE falls back to (0, 1000) when no summary row exists yet (DD.1
  // / DD.2 both run before the refresh in DD.3), giving bucketWidth=1 — so
  // step=1 maps to its own bucket and `point.step` matches STEP exactly.
  const point = points.find((p) => p.step === STEP);
  return point?.value ?? null;
}

async function refreshSummariesAndWait(): Promise<void> {
  await rawCh!.command({
    query: "SYSTEM REFRESH VIEW mlop_metric_summaries_v2_refresh_mv",
  });
  // Cap at 60s — refresh on test-scale fixture data is sub-second, but on
  // a dev stack with a populated CH (millions of v2 rows from prior work)
  // the cold first refresh can take 10-15s. Anything over 60s is a real
  // problem, not just slow cluster.
  for (let attempt = 0; attempt < 240; attempt++) {
    const r = await rawCh!.query({
      query:
        "SELECT status FROM system.view_refreshes WHERE view = 'mlop_metric_summaries_v2_refresh_mv'",
      format: "JSONEachRow",
    });
    const rows = (await r.json()) as Array<{ status: string }>;
    if (rows[0]?.status && rows[0].status !== "Running") return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("mlop_metric_summaries_v2_refresh_mv refresh timed out after 60s");
}

beforeAll(async () => {
  try {
    if (!process.env.CLICKHOUSE_URL) {
      console.log("[dedup] CLICKHOUSE_URL not set — skipping");
      return;
    }
    rawCh = createClient({
      url: process.env.CLICKHOUSE_URL,
      username: process.env.CLICKHOUSE_USER || "default",
      password: process.env.CLICKHOUSE_PASSWORD || "",
    });

    const org = await prisma.organization.findUnique({ where: { slug: TEST_ORG_SLUG } });
    if (!org) {
      console.log("[dedup] Org missing — skipping (run setup.ts first)");
      return;
    }
    orgId = org.id;

    const project = await prisma.projects.findUnique({
      where: { organizationId_name: { organizationId: org.id, name: TEST_PROJECT_NAME } },
      select: { id: true },
    });
    if (!project) return;

    let run = await prisma.runs.findFirst({
      where: { projectId: project.id, organizationId: org.id, name: RUN_NAME },
      select: { id: true },
    });
    if (!run) {
      const apiKey = await prisma.apiKey.findFirst({ where: { organizationId: org.id } });
      const user = await prisma.user.findFirst();
      if (!apiKey || !user) {
        console.log("[dedup] No apiKey/user available — skipping");
        return;
      }
      run = await prisma.runs.create({
        data: {
          name: RUN_NAME,
          organizationId: org.id,
          projectId: project.id,
          createdById: user.id,
          creatorApiKeyId: apiKey.id,
          status: "COMPLETED",
        },
        select: { id: true },
      });
    }
    runId = Number(run.id);

    await prisma.runLogs.upsert({
      where: { runId_logName: { runId: BigInt(runId), logName: LOG_NAME } },
      update: {},
      create: { runId: BigInt(runId), logName: LOG_NAME, logGroup: LOG_GROUP, logType: "METRIC" },
    });

    // Reset CH state so the test is deterministic across re-runs. The mirror
    // MV doesn't propagate DELETEs, so we wipe raw mlop_metrics, mlop_metrics_v2,
    // and the v2 summary row.
    const where = `tenantId = '${orgId}' AND projectName = '${TEST_PROJECT_NAME}' AND runId = ${runId} AND logName = '${LOG_NAME}'`;
    await rawCh.command({
      query: `ALTER TABLE mlop_metrics DELETE WHERE ${where} SETTINGS mutations_sync = 2`,
    });
    await rawCh.command({
      query: `ALTER TABLE mlop_metrics_v2 DELETE WHERE ${where} SETTINGS mutations_sync = 2`,
    });
    await rawCh.command({
      query: `ALTER TABLE mlop_metric_summaries_v2 DELETE WHERE ${where} SETTINGS mutations_sync = 2`,
    });

    fixturesAvailable = true;
  } catch (e) {
    console.log("[dedup] Fixture bootstrap failed (skipping tests):", e);
  }
});

afterAll(async () => {
  await rawCh?.close();
  await prisma.$disconnect();
});

describe("Dedup correctness (mlop_metrics_v2 FINAL + refreshable summaries MV)", () => {
  it("Test DD.1: chart query returns the inserted value for a fresh (run, metric, step)", async () => {
    if (!fixturesAvailable) {
      console.log("   Fixtures missing — skipping");
      return;
    }
    await insertMetric(1.0, FIRST_TIME);
    const value = await readBucketedValueAtStep();
    expect(value).toBe(1.0);
  });

  it("Test DD.2: overwrite at the same step with later `time` is reflected immediately (FINAL dedup)", async () => {
    if (!fixturesAvailable) return;
    await insertMetric(-1.0, SECOND_TIME);
    const value = await readBucketedValueAtStep();
    expect(value).toBe(-1.0);
  });

  // 90s timeout: refreshSummariesAndWait caps at 60s of polling, plus query
  // overhead. Test-cluster refresh is sub-second; dev-cluster cold refresh
  // can hit 10-15s; the cap absorbs both.
  it("Test DD.3: refreshed summary aggregates use deduped values (MIN=MAX=AVG=-1, not -1/1/0)", async () => {
    if (!fixturesAvailable) return;
    await refreshSummariesAndWait();

    const summaries = await queryMetricSummariesBatch(clickhouse, {
      organizationId: orgId!,
      projectName: TEST_PROJECT_NAME,
      metrics: [
        { logName: LOG_NAME, aggregation: "MIN" },
        { logName: LOG_NAME, aggregation: "MAX" },
        { logName: LOG_NAME, aggregation: "AVG" },
        { logName: LOG_NAME, aggregation: "LAST" },
      ],
      runIds: [runId!],
    });

    const runMap = summaries.get(runId!);
    expect(runMap).toBeDefined();
    expect(runMap!.get(`${LOG_NAME}|MIN`)).toBe(-1.0);
    expect(runMap!.get(`${LOG_NAME}|MAX`)).toBe(-1.0);
    expect(runMap!.get(`${LOG_NAME}|AVG`)).toBe(-1.0);
    expect(runMap!.get(`${LOG_NAME}|LAST`)).toBe(-1.0);
  }, 90_000);
});
