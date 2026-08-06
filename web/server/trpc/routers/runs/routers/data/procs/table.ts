import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";
import { withCache } from "../../../../../../lib/cache";
import { tableDataRow } from "./table.schema";

type TableData = z.infer<typeof tableDataRow>[];

export const tableProcedure = protectedOrgProcedure
  .input(
    z.object({
      runId: z.string(),
      projectName: z.string(),
      logName: z.string(),
    })
  )
  .query(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName, organizationId, logName } = input;
    const runId = await resolveRunId(ctx.prisma, encodedRunId, organizationId, projectName);

    return withCache<TableData>(
      ctx,
      "table",
      { runId, organizationId, projectName, logName },
      async () => {
        const query = `
          SELECT logName, time, step, data as tableData FROM mlop_data
          WHERE tenantId = {tenantId: String}
          AND projectName = {projectName: String}
          AND runId = {runId: UInt64}
          AND logName = {logName: String}
          AND dataType ILIKE 'table'
        `;

        const result = (await ctx.clickhouse
          .query(query, {
            tenantId: organizationId,
            projectName,
            runId,
            logName,
          })
          .then((result) => result.json())) as unknown[];

        // Parse per row and drop only the rows that genuinely cannot be read
        // (corrupt JSON, missing logName/step/table). A single `.map(parse)`
        // threw on the first bad row and took every other step's table with it,
        // which the UI shows as "No table data available" — one damaged step
        // hiding 99 intact ones. Anything unreadable is logged rather than
        // silently swallowed.
        const rows: TableData = [];
        let dropped = 0;
        for (const row of result) {
          const parsed = tableDataRow.safeParse(row);
          if (parsed.success) {
            rows.push(parsed.data);
          } else {
            dropped++;
            if (dropped === 1) {
              console.warn(
                `[runs.data.table] dropping unparseable table row for run=${runId} logName=${logName}:`,
                parsed.error.issues.slice(0, 3)
              );
            }
          }
        }
        if (dropped > 0) {
          console.warn(
            `[runs.data.table] dropped ${dropped}/${result.length} unparseable rows for run=${runId} logName=${logName}`
          );
        }
        return rows;
      }
    );
  });
