import { redirect } from "@tanstack/react-router";
import { queryClient, trpc, trpcClient } from "@/utils/trpc";
import { setActiveOrg } from "./org";
import { bustLocalCache, ensureLocalQuery } from "@/lib/hooks/use-local-query";
import { LocalCache } from "@/lib/db/local-cache";

type AuthData = Awaited<ReturnType<typeof trpcClient.auth.query>>;

// Create auth-specific local cache with a 10MB size limit
const authCache = new LocalCache<AuthData>("auth", "auth", 1024 * 1024 * 10);

export const bustAuthCache = async () => {
  await bustLocalCache(authCache, trpc.auth.queryKey());
};

/**
 * Options for controlling authentication check behavior
 */
interface AuthCheckOptions {
  /** Whether the current page is an onboarding page */
  isOnBoardingPage?: boolean;
  /** Optional search parameters for redirects */
  search?: { redirect: string } | {};
  /** Force fresh data fetch bypassing cache */
  forceFresh?: boolean;
}

/**
 * Performs basic user authentication check
 *
 * @param search - Optional search parameters for redirects
 * @param options - Additional authentication check options
 * @returns The authenticated user's auth data
 * @throws Redirects to sign-in if not authenticated
 * @throws Redirects to onboarding if user hasn't completed onboarding
 */
export const userAuthCheck = async (options?: AuthCheckOptions) => {
  // Use ensureLocalQuery to leverage IndexedDB caching

  const start = performance.now();
  const auth = await ensureLocalQuery<AuthData>(queryClient, {
    queryKey: trpc.auth.queryKey(),
    queryFn: trpcClient.auth.query,
    staleTime: 1000 * 60, // 1 minutes cache unless forced fresh
    localCache: authCache,
  });

  const search = options?.search;

  if (!auth) {
    throw redirect({ to: "/auth/sign-in", search });
  }

  const notFinishedOnboarding = !auth.user.finishedOnboarding;
  const isOnBoardingPage = options?.isOnBoardingPage;

  if (notFinishedOnboarding && !isOnBoardingPage) {
    throw redirect({ to: "/onboard/user", search });
  }

  // TODO: Email verification check

  return auth;
};

/**
 * Performs organization-specific authentication check
 *
 * @param orgSlug - The organization slug to check access for
 * @param search - Optional search parameters for redirects
 * @param options - Additional authentication check options
 * @returns Object containing both auth and org data
 * @throws Redirects to sign-in if not authenticated
 * @throws Redirects to onboarding if user hasn't completed onboarding
 * @throws Redirects to organization selection if user doesn't have access to the org
 */
export const orgAuthCheck = async (
  orgSlug: string,
  options?: AuthCheckOptions,
) => {
  const { activeOrganization, allOrgs, session, user } =
    await userAuthCheck(options);

  const search = options?.search;

  // First check if the org exists in allOrgs
  const org = allOrgs.find((o) => o.slug === orgSlug);
  if (!org) {
    throw redirect({ to: "/o", search });
  }

  // Check if we need to update the active organization
  const needsOrgUpdate =
    !activeOrganization?.id || activeOrganization.id !== org.id;

  if (needsOrgUpdate) {
    // Set the sessions active org id to the current orgId
    await setActiveOrg(orgSlug);
    // Invalidate the queries
    await queryClient.invalidateQueries();

    const auth = await userAuthCheck({ ...options, forceFresh: true });
    if (!auth?.activeOrganization?.id) {
      throw redirect({ to: "/o", search });
    }

    // Ensure we return an auth object with a non-null activeOrganization
    const authWithOrg = {
      ...auth,
      activeOrganization: auth.activeOrganization,
    };

    return { auth: authWithOrg, org };
  }

  // Final validation of active organization
  if (!activeOrganization?.id) {
    throw redirect({ to: "/o", search });
  }

  const resolvedAuth = {
    activeOrganization,
    allOrgs,
    session,
    user,
  };

  return { auth: resolvedAuth, org };
};
