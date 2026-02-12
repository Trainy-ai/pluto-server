import { z } from "zod";

const numberOrStringSchema = z.union([z.number(), z.string()]);
const dTypeSchema = z.union([
  z.literal("int"),
  z.literal("float"),
  z.literal("str"),
]);

const rowcolSchema = z.array(
  z.object({
    name: z.string(),
    dtype: dTypeSchema,
  })
);

const tableInnerSchema = z.array(z.array(numberOrStringSchema));

export const tableSchema = z.object({
  row: rowcolSchema.optional(),
  col: rowcolSchema.optional(),
  table: tableInnerSchema,
});

export const tableDataRow = z.object({
  logName: z.string(),
  time: z.string().transform((str) => new Date(str.replace(" ", "T") + "Z")),
  step: z.coerce.number(),
  tableData: z.string().transform((str) => {
    const parsed = JSON.parse(str);
    return tableSchema.parse(parsed);
  }),
});
