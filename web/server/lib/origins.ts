import { env } from "./env";

// Centralized list of allowed/trusted origins for CORS and auth
export const allowedOrigins: string[] = [env.PUBLIC_URL, env.BETTER_AUTH_URL];
if (env.ADDITIONAL_ORIGINS) {
  allowedOrigins.push(...env.ADDITIONAL_ORIGINS.split(",").map((s) => s.trim()));
}
