import { z } from "zod";

const envSchema = z.object({
  // Storage
  STORAGE_ENDPOINT: z.string().url(),
  STORAGE_ACCESS_KEY_ID: z.string().min(1),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
  STORAGE_BUCKET: z.string().min(1),
  STORAGE_REGION: z.string().min(1),

  // Clickhouse
  CLICKHOUSE_URL: z.string().url(),
  CLICKHOUSE_USER: z.string().min(1),
  CLICKHOUSE_PASSWORD: z.string().min(1),

  // Database
  DATABASE_URL: z.string().url(),
  DATABASE_DIRECT_URL: z.string().url(),

  // Auth
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  // URLs & CORS
  PUBLIC_URL: z.string().url(), // URL of server
  BETTER_AUTH_URL: z.string().url(), // URL of web app
  BETTER_AUTH_SECRET: z.string().min(1),
  ADDITIONAL_ORIGINS: z.string().optional(), // Comma-separated list of additional allowed origins for CORS/auth

  // Email (Resend)
  RESEND_API_KEY: z.string().min(1).optional(), // Optional to allow development without email
  RESEND_FROM_EMAIL: z.string().email().optional(), // Defaults to noreply@pluto.dev in email service

  // SAML/SSO (test/dev only)
  DUMMYIDP_ENTRY_POINT: z.string().url().optional(),
  DUMMYIDP_ENTITY_ID: z.string().url().optional(),
  DUMMYIDP_APP_ID: z.string().optional(),
  DUMMYIDP_CERTIFICATE: z.string().optional(),
  SAML_ISSUER: z.string().url().optional(),

  // Deployment/Environment Specific
  NODE_ENV: z.enum(["development", "production", "test"]).optional(),
  IS_DOCKER: z.string().optional(), // Could refine if specific values like "true" are expected
  VERCEL: z.string().optional(), // Could refine if specific values like "1" are expected
});

// Validate environment variables
const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.log(parsedEnv);
  console.error(
    "❌ Invalid environment variables:",
    JSON.stringify(parsedEnv.error.format(), null, 4)
  );
  process.exit(1);
}

// Export the validated environment variables
export const env = parsedEnv.data;
