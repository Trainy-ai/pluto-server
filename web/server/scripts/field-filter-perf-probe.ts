/**
 * Perf regression gate for negated field filters (Buildkite: "Field-Filter
 * Query Perf Test").
 *
 * Executes queryFieldFilteredRunIds — the exact code path behind
 * /api/runs/list `filter=` and the runs-table field filters — against the
 * perf-seeded project (scripts/seed-field-filter-perf.sql, ~170K runs) and
 * fails if any probe exceeds its budget.
 *
 * Guards the 2026-07-09 incident: a negated filter compiled as a correlated
 * NOT EXISTS anti-join degraded to a nested-loop-with-Materialize plan at
 * ~500s per query on a 168K-run project, starving the Prisma connection pool
 * (P2024 storm). The uncorrelated NOT IN shape runs in well under a second at
 * this scale; the budget leaves headroom for CI hardware, not for a
 * reintroduced per-row plan.
 *
 * Env: DATABASE_URL (stack default), FIELD_FILTER_PERF_BUDGET_MS (default 5000).
 */
import { PrismaClient } from "@prisma/client";
import { queryFieldFilteredRunIds, buildFieldFilterConditions } from "../trpc/routers/runs/procs/list-runs";

const ORG_ID = "field-filter-perf-org";
const PROJECT_ID = 999001n;
const BUDGET_MS = Number(process.env.FIELD_FILTER_PERF_BUDGET_MS ?? 5000);

// The incident shape (negated text filter) plus the other uncorrelated-NOT-IN
// operator, and one positive filter as a semi-join canary.
const PROBES = [
  {
    label: 'negated text filter ("is none of") — the P2024 incident shape',
    filter: { source: "config", key: "username", dataType: "option", operator: "is none of", values: [["user-1", "user-2"]] },
    // 8/10 of the username values remain + runs without the key.
    expectMin: 100_000,
  },
  {
    label: '"not exists" (field absent)',
    filter: { source: "config", key: "only_on_some_runs", dataType: "text", operator: "not exists", values: [] },
    expectMin: 100_000,
  },
  {
    label: 'positive filter ("is any of") — semi-join canary',
    filter: { source: "config", key: "username", dataType: "option", operator: "is any of", values: [["user-1", "user-2"]] },
    expectMin: 10_000,
  },
] as const;

async function main() {
  const prisma = new PrismaClient();
  let failed = false;

  const seeded = await prisma.runs.count({ where: { organizationId: ORG_ID, projectId: PROJECT_ID } });
  if (seeded < 100_000) {
    throw new Error(`perf project not seeded (found ${seeded} runs) — run seed-field-filter-perf.sql first`);
  }
  console.log(`perf project: ${seeded} runs; budget ${BUDGET_MS}ms per query`);

  for (const probe of PROBES) {
    // Two timed executions: first exercises planning, second the cached plan
    // (Prisma reuses prepared statements — the incident bit the cached path too).
    const timings: number[] = [];
    let rows = 0;
    for (let i = 0; i < 2; i++) {
      const t0 = performance.now();
      const ids = await queryFieldFilteredRunIds(prisma, {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        fieldFilters: [probe.filter as any],
      });
      timings.push(performance.now() - t0);
      rows = ids.length;
    }
    const worst = Math.max(...timings);
    const ok = worst <= BUDGET_MS && rows >= probe.expectMin;
    console.log(
      `${ok ? "PASS" : "FAIL"}: ${probe.label} — ${timings.map((t) => `${t.toFixed(0)}ms`).join(", ")} (${rows} rows, expected >= ${probe.expectMin})`,
    );
    if (!ok) failed = true;
  }

  // ── Planner-level checks ─────────────────────────────────────────────
  // The timing probes above can pass even with a bad query shape when the CI
  // database has fresh statistics (the incident shape planned fine at this
  // scale with good stats — it needed a planner misestimate to melt down).
  // These two checks make POSTGRES the oracle instead of our own SQL text:
  //
  //  1. Plan shape: EXPLAIN the real generated query and require the negated
  //     filter to be evaluated as a `hashed SubPlan` — the strategy that is
  //     O(inner scan + per-row hash probe) by construction.
  //  2. Hostile-planner differential: execute the real query with every join
  //     and index scan method disabled (SET LOCAL) under a statement_timeout.
  //     The pre-fix correlated NOT EXISTS shape provably cannot finish here
  //     (>60s measured at this scale — the prod P2024 plan); the uncorrelated
  //     NOT IN completes in ~100ms because the hashed SubPlan is independent
  //     of join planning. This is the incident reproduced as a CI assertion.
  const conditions: string[] = [`r."organizationId" = $1`, `r."projectId" = $2`];
  const params: unknown[] = [ORG_ID, PROJECT_ID];
  buildFieldFilterConditions(conditions, params as any[], [
    { source: "config", key: "username", dataType: "option", operator: "is none of", values: [["user-1", "user-2"]] } as any,
  ], { organizationId: ORG_ID, projectId: PROJECT_ID });
  const negatedSql = `SELECT r.id FROM "runs" r WHERE ${conditions.join(" AND ")}`;

  const planRows = (await prisma.$queryRawUnsafe(
    `EXPLAIN (FORMAT JSON) ${negatedSql}`,
    ...params,
  )) as { "QUERY PLAN": unknown }[];
  const planText = JSON.stringify(planRows);
  const planOk = planText.includes("hashed SubPlan");
  console.log(
    `${planOk ? "PASS" : "FAIL"}: plan shape — negated filter ${planOk ? "is" : "is NOT"} a hashed SubPlan`,
  );
  if (!planOk) {
    console.error(`plan was:\n${JSON.stringify(planRows, null, 1).slice(0, 4000)}`);
    failed = true;
  }

  // Run `sql` on one pinned connection with every join and index-scan method
  // disabled, bounded by statement_timeout. Returns elapsed ms, or null if
  // Postgres killed the statement at the timeout (SQLSTATE 57014).
  const HOSTILE_TIMEOUT = "15s";
  async function runHostile(sql: string, sqlParams: unknown[]): Promise<number | null> {
    try {
      return await prisma.$transaction(
        async (tx) => {
          for (const knob of ["enable_hashjoin", "enable_mergejoin", "enable_indexscan", "enable_indexonlyscan", "enable_bitmapscan"]) {
            await tx.$executeRawUnsafe(`SET LOCAL ${knob} = off`);
          }
          await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${HOSTILE_TIMEOUT}'`);
          const t0 = performance.now();
          await tx.$queryRawUnsafe(sql, ...sqlParams);
          return performance.now() - t0;
        },
        { timeout: 30_000, maxWait: 10_000 },
      );
    } catch (e) {
      if (String(e).includes("57014") || String(e).includes("statement timeout")) return null;
      throw e;
    }
  }

  const currentHostileMs = await runHostile(negatedSql, params);
  if (currentHostileMs != null) {
    console.log(`PASS: hostile-planner differential — negated filter survived with all join/scan methods disabled (${currentHostileMs.toFixed(0)}ms)`);
  } else {
    console.log(`FAIL: hostile-planner differential — query did not finish within ${HOSTILE_TIMEOUT} with join/scan methods disabled (the pre-fix per-row plan behaves exactly like this)`);
    failed = true;
  }

  // Positive control: the PRE-#533 correlated NOT EXISTS shape (verbatim, as
  // main compiled it before the fix — the query behind the 2026-07-09 P2024
  // storm) must DIE under the same hostile conditions. This makes every CI run
  // an explicit legacy-vs-current latency comparison (legacy > the 15s kill
  // switch — ~500s uncapped at this scale — vs current in the hundreds of ms)
  // and proves the hostile harness still has teeth: if the seed shrinks or the
  // knobs stop being lethal, the legacy shape completes and this check fails.
  const legacySql = `SELECT r.id FROM "runs" r WHERE r."organizationId" = $1 AND r."projectId" = $2 AND NOT EXISTS (SELECT 1 FROM "run_field_values" fv0 WHERE fv0."runId" = r.id AND fv0."projectId" = r."projectId" AND fv0."source" = $3 AND fv0."key" = $4 AND fv0."textValue" = ANY($5::text[]))`;
  const legacyParams = [ORG_ID, PROJECT_ID, "config", "username", ["user-1", "user-2"]];
  const legacyHostileMs = await runHostile(legacySql, legacyParams);
  if (legacyHostileMs == null) {
    console.log(
      `PASS: legacy-shape control — pre-fix NOT EXISTS exceeded the ${HOSTILE_TIMEOUT} kill switch under the same conditions` +
        (currentHostileMs != null ? ` (>${HOSTILE_TIMEOUT} vs ${currentHostileMs.toFixed(0)}ms for the current shape)` : ""),
    );
  } else {
    console.log(
      `FAIL: legacy-shape control — the pre-fix NOT EXISTS completed in ${legacyHostileMs.toFixed(0)}ms; the hostile harness is no longer lethal (seed too small or knobs ineffective), so the differential above proves nothing`,
    );
    failed = true;
  }

  await prisma.$disconnect();
  if (failed) {
    console.error(`One or more field-filter probes failed (timing, plan shape, hostile-planner differential, or legacy control).`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
