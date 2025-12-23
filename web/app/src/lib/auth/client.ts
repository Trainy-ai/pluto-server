import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import { organizationClient } from "better-auth/client/plugins";
import { adminClient } from "better-auth/client/plugins";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { env } from "../env";

export const authClient = createAuthClient({
  baseURL: env.VITE_SERVER_URL,
  plugins: [twoFactorClient(), adminClient(), organizationClient()],
});

export const useAuth = () => useQuery(trpc.auth.queryOptions());
