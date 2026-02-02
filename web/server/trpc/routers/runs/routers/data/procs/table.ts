import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { sqidDecode } from "../../../../../../lib/sqid";
import { withCache } from "../../../../../../lib/cache";

const numberOrStringSchema = z.union([z.number(), z.string()]);
const dTypeSchema = z.union([
  z.literal("int"),
  z.literal("float"),
  z.literal("str"),
]);

const rowcolSchema = z.array(
  z.object({
    name: z.string(), // label
    dtype: dTypeSchema, // data type
  })
);

// 2D matrix of numberOrStringSchema
const tableInnerSchema = z.array(z.array(numberOrStringSchema));

const tableSchema = z.object({
  row: rowcolSchema.optional(), // labels, these can be optional
  col: rowcolSchema.optional(), // labels and data types, these can be optional
  table: tableInnerSchema,
});

const tableDataRow = z.object({
  logName: z.string(),
  time: z.string().transform((str) => new Date(str + "Z")),
  step: z.string().transform((str) => parseInt(str, 10)),
  tableData: z.string().transform((str) => {
    const parsed = JSON.parse(str);
    return tableSchema.parse(parsed);
  }),
});

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
    const runId = sqidDecode(encodedRunId);

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

        return result.map((row) => tableDataRow.parse(row));
      }
    );
  });
