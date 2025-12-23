import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { sqidDecode } from "../../../../../../lib/sqid";

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

    const query = `
    SELECT logName, time, step, data as tableData FROM mlop_data
    WHERE tenantId = {tenantId: String}
    AND projectName = {projectName: String}
    AND runId = {runId: UInt64}
    AND logName = {logName: String}
    AND dataType = 'TABLE'
  `;

    const result = (await ctx.clickhouse
      .query(query, {
        tenantId: organizationId,
        projectName,
        runId,
        logName,
      })
      .then((result) => result.json())) as unknown[];

    if (logName.includes("pd")) {
      console.log(result);
    }

    const data = result.map((row) => tableDataRow.parse(row));

    if (logName.includes("pd")) {
      console.log(
        result,
        data.map((d) => d.tableData)
      );
    }

    return data;
  });
