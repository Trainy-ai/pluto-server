import { z } from "zod";

export const histogramSchema = z.object({
  freq: z.array(z.number().int()),
  bins: z.object({
    min: z.number(),
    max: z.number(),
    num: z.number().int(),
  }),
  shape: z.literal("uniform"),
  type: z.literal("Histogram"),
  maxFreq: z.number().int(),
});

export const histogramDataRow = z.object({
  logName: z.string(),
  time: z.string().transform((str) => new Date(str.replace(" ", "T") + "Z")),
  step: z.coerce.number(),
  histogramData: z.string().transform((str) => {
    const parsed = JSON.parse(str);
    return histogramSchema.parse(parsed);
  }),
});
