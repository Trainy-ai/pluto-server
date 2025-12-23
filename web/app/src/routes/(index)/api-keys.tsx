/**
 * This route is a helper route used to route the user to the API keys page via the /api-keys route
 * this will automatically route to the page for their "active" organization
 */

import { userAuthCheck } from "@/lib/auth/check";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(index)/api-keys")({
  beforeLoad: async ({ context }) => {
    const search = { redirect: "/api-keys" };
    /**
     * Use undefined for `orgSlug` since we are not inside an organization
     * this is the users personal account settings
     **/
    const auth = await userAuthCheck({ search });

    // Check to see if user has an "active" organization in their session
    const orgSlug = auth?.activeOrganization?.slug;

    // If user is not in an organization or not part of the active organization, redirect to the organization selector
    if (!orgSlug || !auth.allOrgs?.some((org) => org.slug === orgSlug)) {
      throw redirect({ to: "/o", search });
    }

    // Redirect to the developers page for the API Keys
    return redirect({
      to: "/o/$orgSlug/settings/org/developers",
      params: {
        orgSlug,
      },
    });
  },
});
