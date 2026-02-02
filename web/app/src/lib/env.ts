import { z } from "zod";

const envSchema = z.object({
  VITE_SERVER_URL: z.string().url(),
  VITE_ENV: z.enum(["development", "production", "test"]),
  VITE_IS_DOCKER: z.preprocess(
    (val) => val === "true",
    z.boolean().default(false),
  ),
  VITE_POSTHOG_KEY: z.string().optional(),
  VITE_POSTHOG_HOST: z.string().optional(),
  // Demo mode - skips auth checks and redirects to demo org dashboard
  VITE_SKIP_AUTH_DEMO: z.preprocess(
    (val) => val === "true",
    z.boolean().default(false),
  ),
  SERVICE_VERSION: z.string().default("unknown"),
  GIT_COMMIT: z.string().default("unknown"),
  GIT_BRANCH: z.string().default("unknown"),
  BUILD_TIME: z.string().default("unknown"),
});

const runtimeEnv =
  typeof window !== "undefined" ? window.__APP_ENV__ ?? {} : {};

const mergedEnv = {
  ...import.meta.env,
  ...runtimeEnv,
};

// Validate environment variables
const parsedEnv = envSchema.safeParse(mergedEnv);

if (!parsedEnv.success) {
  console.error(
    "❌ Invalid environment variables:",
    JSON.stringify(parsedEnv.error.format(), null, 4),
  );
  throw new Error("Invalid environment variables");
}

// Export the validated environment variables
export const env = parsedEnv.data;
