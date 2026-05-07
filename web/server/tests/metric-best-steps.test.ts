/**
 * Unit tests for the nearest-snap + tolerance cap behavior in
 * queryArgminArgmaxSteps / queryArgminArgmaxStepsPerImageLog.
 *
 * These tests import the query functions directly (no HTTP/tRPC round-trip)
 * and hit the ClickHouse + Postgres instances that the containerized test
 * env provides (.env.test / tests/setup.ts).
 *
 * Fixture runs are created by `tests/setup.ts` section 5f.2:
 *
 *   tol-test-run-offset
 *     - metric `train/loss` at steps {0,10,...,100}, parabola min at step 50 (0.1)
 *     - image `images/samples` at steps {5,15,...,95}
 *     - No exact overlap. Nearest image to metric step 50 is step 45 or 55
 *       (both distance 5). Tie-break prefers later step → 55.
 *
 *   tol-test-run-hard
 *     - metric `train/loss` at [(500, 0.01), (1002, 0.02), (200, 0.5), (800, 0.4)]
 *     - image `images/samples` at {0, 1000, 1001, 1003}
 *     - True argmin (step 500) is 500 steps away from any image, so with
 *       default K=20 it gets filtered out. Step 1002 (0.02) wins: nearest
 *       images at 1001 and 1003 (both distance 1). Tie-break → 1003.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  queryArgminArgmaxSteps,
  queryArgminArgmaxStepsPerImageLog,
} from "../lib/queries/metric-summaries";
import { clickhouse } from "../lib/clickhouse";

const TEST_ORG_SLUG = process.env.TEST_ORG_SLUG || "smoke-test-org";
const TEST_PROJECT_NAME = process.env.TEST_PROJECT_NAME || "smoke-test-project";

const prisma = new PrismaClient();

let offsetRunId: number | null = null;
let hardRunId: number | null = null;
let orgId: string | null = null;
let fixturesAvailable = false;

beforeAll(async () => {
  try {
    const org = await prisma.organization.findUnique({ where: { slug: TEST_ORG_SLUG } });
    if (!org) return;
    orgId = org.id;

    const project = await prisma.projects.findUnique({
      where: { organizationId_name: { organizationId: org.id, name: TEST_PROJECT_NAME } },
    });
    if (!project) return;

    const runs = await prisma.runs.findMany({
      where: {
        projectId: project.id,
        organizationId: org.id,
        name: { in: ["tol-test-run-offset", "tol-test-run-hard"] },
      },
      select: { id: true, name: true },
    });
    const byName = new Map(runs.map((r) => [r.name, Number(r.id)]));
    offsetRunId = byName.get("tol-test-run-offset") ?? null;
    hardRunId = byName.get("tol-test-run-hard") ?? null;

    fixturesAvailable = offsetRunId !== null && hardRunId !== null;
  } catch (e) {
    console.log("[best-step] Fixture bootstrap failed (skipping tests):", e);
  }
});

describe("Best-step: nearest-snap + K tolerance", () => {
  describe("queryArgminArgmaxSteps (single-step-per-run variant)", () => {
    it("Test BS.1: returns plain metric argmin/argmax with null image fields", async () => {
      if (!fixturesAvailable || !orgId || !offsetRunId) {
        console.log("   Fixtures missing — skipping");
        return;
      }
      const result = await queryArgminArgmaxSteps(clickhouse, {
        organizationId: orgId,
        projectName: TEST_PROJECT_NAME,
        logName: "train/loss",
        runIds: [offsetRunId],
      });
      const entry = result.get(offsetRunId);
      expect(entry).toBeDefined();
      expect(entry!.argmin.metricStep).toBe(50);
      // Parabola is symmetric → argmax at the endpoints (step 0 or 100).
      expect([0, 100]).toContain(entry!.argmax.metricStep);
      // No image coupling → image fields are null.
      expect(entry!.argmin.imageStep).toBeNull();
      expect(entry!.argmin.distance).toBeNull();
      expect(entry!.argmin.tiedAlternativeImageStep).toBeNull();
      expect(entry!.argmax.imageStep).toBeNull();
      expect(entry!.argmax.distance).toBeNull();
      expect(entry!.argmax.tiedAlternativeImageStep).toBeNull();
    });

    it("Test BS.6: batches multiple runs in one query", async () => {
      if (!fixturesAvailable || !orgId || !offsetRunId || !hardRunId) return;
      const result = await queryArgminArgmaxSteps(clickhouse, {
        organizationId: orgId,
        projectName: TEST_PROJECT_NAME,
        logName: "train/loss",
        runIds: [offsetRunId, hardRunId],
      });
      expect(result.size).toBe(2);
      expect(result.get(offsetRunId)!.argmin.metricStep).toBe(50);
      // Hard fixture's true argmin is step 500 (value 0.01) — no image
      // coupling on this path means we don't filter by tolerance.
      expect(result.get(hardRunId)!.argmin.metricStep).toBe(500);
    });
  });

  describe("queryArgminArgmaxStepsPerImageLog (per-widget variant)", () => {
    it("Test BS.7: per-widget offset cadence matches single-step case for the only image log", async () => {
      if (!fixturesAvailable || !orgId || !offsetRunId) return;
      const rows = await queryArgminArgmaxStepsPerImageLog(clickhouse, {
        organizationId: orgId,
        projectName: TEST_PROJECT_NAME,
        logName: "train/loss",
        runIds: [offsetRunId],
        toleranceSteps: 20,
      });
      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(row.imageLogName).toBe("images/samples");
      expect(row.argmin.metricStep).toBe(50);
      expect(row.argmin.imageStep).toBe(55);
      expect(row.argmin.distance).toBe(5);
    });

    it("Test BS.8: per-widget hard case — K=20 excludes true argmin", async () => {
      if (!fixturesAvailable || !orgId || !hardRunId) return;
      const rows = await queryArgminArgmaxStepsPerImageLog(clickhouse, {
        organizationId: orgId,
        projectName: TEST_PROJECT_NAME,
        logName: "train/loss",
        runIds: [hardRunId],
        toleranceSteps: 20,
      });
      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(row.imageLogName).toBe("images/samples");
      expect(row.argmin.metricStep).toBe(1002);
      expect(row.argmin.imageStep).toBe(1003);
      expect(row.argmin.distance).toBe(1);
    });

    it("Test BS.9: per-widget hard case — K=500 includes true argmin", async () => {
      if (!fixturesAvailable || !orgId || !hardRunId) return;
      const rows = await queryArgminArgmaxStepsPerImageLog(clickhouse, {
        organizationId: orgId,
        projectName: TEST_PROJECT_NAME,
        logName: "train/loss",
        runIds: [hardRunId],
        toleranceSteps: 500,
      });
      expect(rows.length).toBe(1);
      expect(rows[0].argmin.metricStep).toBe(500);
      expect(rows[0].argmin.imageStep).toBe(1000);
      expect(rows[0].argmin.distance).toBe(500);
    });

    it("Test BS.10: per-widget with K=0 and no exact overlap returns empty", async () => {
      if (!fixturesAvailable || !orgId || !offsetRunId) return;
      const rows = await queryArgminArgmaxStepsPerImageLog(clickhouse, {
        organizationId: orgId,
        projectName: TEST_PROJECT_NAME,
        logName: "train/loss",
        runIds: [offsetRunId],
        toleranceSteps: 0,
      });
      expect(rows.length).toBe(0);
    });
  });
});
