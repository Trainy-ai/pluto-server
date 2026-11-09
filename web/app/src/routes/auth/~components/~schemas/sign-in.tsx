import { z } from "zod";

export const passThroughCredentialsSchema = z.object({
  email: z
    .string({
      error: (issue) =>
        issue.input === undefined ? undefined : "Email must be a string.",
    })
    .trim()
    .max(255, "Maximum 255 characters allowed."),
  password: z
    .string({
      error: (issue) =>
        issue.input === undefined
          ? "Password is required."
          : "Password must be a string.",
    })
    .max(72, "Maximum 72 characters allowed."),
});

export type PassThroughCredentialsSchema = z.infer<
  typeof passThroughCredentialsSchema
>;
