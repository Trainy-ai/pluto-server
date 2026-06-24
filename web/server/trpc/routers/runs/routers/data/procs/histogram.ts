import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";
import { withCache } from "../../../../../../lib/cache";
import {
  histogramDataRow,
  histogramInput,
  type HistogramDataRow,
  type HistogramQueryResult,
} from "./histogram.schema";

export const histogramProcedure = protectedOrgProcedure
  .input(histogramInput)
  .query(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName, organizationId, logName, stepCap } = input;
    const runId = await resolveRunId(ctx.prisma, encodedRunId, organizationId, projectName);

    // Namespace is suffixed -v2 because the v1 proc returned `HistogramDataRow[]`
    // directly while this proc returns `{ rows, truncated, totalSteps }`. The
    // shared Redis cache would otherwise serve the wrapper object under the
    // same key v1 callers expect, crashing their `[...data].sort(...)` with
    // "n is not iterable". Bumping the namespace isolates the response shapes
    // until every backend deploy is on the new code.
    return withCache<HistogramQueryResult>(
      ctx,
      "histogram-v2",
      { runId, organizationId, projectName, logName, stepCap },
      async () => {
        // Downsampling runs inside ClickHouse via a window-function subquery
        // so we never pull more than ~stepCap rows over the wire. stepCap=0
        // is the sentinel for "no cap, return everything". The stride logic
        // mirrors the previous in-memory algorithm exactly: stride = ceil(
        // total / cap), keep first row (rn=1), every row at stride boundary
        // ((rn-1) % stride = 0), and last row (rn=total). For cap=1 on N
        // rows the filter yields {first, last}; for cap=2 it yields
        // {first, mid, last}; etc. — matches the smoke-test expectations.
        const stepCapValue = stepCap ?? 0;
        const query = `
          SELECT logName, time, step, histogramData, total
          FROM (
            SELECT
              logName,
              time,
              step,
              data AS histogramData,
              row_number() OVER (ORDER BY step ASC) AS rn,
              count() OVER () AS total
            FROM mlop_data
            WHERE tenantId = {tenantId: String}
              AND projectName = {projectName: String}
              AND runId = {runId: UInt64}
              AND logName = {logName: String}
              AND dataType ILIKE 'histogram'
          ) AS ranked
          WHERE
            {stepCap: UInt64} = 0
            OR total <= {stepCap: UInt64}
            OR rn = 1
            OR rn = total
            OR (rn - 1) % greatest(1, intDiv(total + {stepCap: UInt64} - 1, {stepCap: UInt64})) = 0
          ORDER BY step ASC
        `;

        const result = (await ctx.clickhouse
          .query(query, {
            tenantId: organizationId,
            projectName,
            runId,
            logName,
            stepCap: stepCapValue,
          })
          .then((result) => result.json())) as Array<{ total: number | string }>;

        if (result.length === 0) {
          return { rows: [], truncated: false, totalSteps: 0 };
        }

        // `total` is emitted on every row (window aggregate); just read it once.
        // ClickHouse returns counts as either number or stringified BigInt
        // depending on the client config — coerce.
        const totalSteps = Number(result[0].total);
        // histogramDataRow.parse strips the extra `total` field via Zod's
        // default object-strip behaviour, so callers see the v1 row shape.
        const rows: HistogramDataRow[] = result.map((row) => histogramDataRow.parse(row));
        const truncated = stepCap !== undefined && rows.length < totalSteps;

        return { rows, truncated, totalSteps };
      }
    );
  });
