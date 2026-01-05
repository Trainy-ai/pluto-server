import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import { organizationClient } from "better-auth/client/plugins";
import { adminClient } from "better-auth/client/plugins";
import { twoFactorClient } from "better-auth/client/plugins";
import { ssoClient } from "@better-auth/sso/client";
import { createAuthClient } from "better-auth/react";
import { env } from "../env";

// In test/Docker environments, use current origin (no baseURL) so requests
// go through Vite proxy for proper cookie handling
const getAuthBaseURL = () => {
  const isTest = env.VITE_ENV === "test";
  if (isTest || env.VITE_IS_DOCKER) {
    return undefined; // Uses current origin, proxied by Vite
  }
  return env.VITE_SERVER_URL; // Absolute URL for production
};

export const authClient = createAuthClient({
  baseURL: getAuthBaseURL(),
  plugins: [twoFactorClient(), adminClient(), organizationClient(), ssoClient()],
});

export const useAuth = () => useQuery(trpc.auth.queryOptions());
