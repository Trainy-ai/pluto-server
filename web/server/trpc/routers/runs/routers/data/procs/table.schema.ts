import { z } from "zod";

/**
 * A single table cell.
 *
 * Deliberately permissive. Pluto's own tables log numbers and strings, but a
 * migrated wandb table routinely carries booleans, nulls (missing values), and
 * object cells (media entries such as images). Rejecting a cell type fails the
 * row, which fails the whole `result.map(parse)` in table.ts, which surfaces in
 * the UI as "No table data available" — the entire table lost because one
 * column was a bool, even though the data is completely intact.
 *
 * The renderer stringifies whatever it receives (`String(cell)` in
 * TableCellRenderer), so allowing unknown values through degrades to text
 * rather than to nothing. Media cells render as text until dedicated in-cell
 * media rendering lands.
 */
const cellSchema = z.unknown();

/**
 * Column/row descriptor dtype.
 *
 * Pluto emits "int" | "float" | "str", but wandb's type space is open-ended
 * ("bool", image/html/object3D media types, and more), so this accepts any
 * string instead of enumerating a set that will keep growing. The frontend only
 * special-cases "int"/"float" (to offer numeric filtering) and otherwise shows
 * the label verbatim, so an unrecognised dtype is already handled gracefully.
 *
 * Optional because a migrated descriptor may omit it entirely.
 */
const dTypeSchema = z.string();

const rowcolSchema = z.array(
  z.object({
    name: z.string(),
    dtype: dTypeSchema.optional(),
  })
);

const tableInnerSchema = z.array(z.array(cellSchema));

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
