import { createFileRoute, redirect } from "@tanstack/react-router";
import { userAuthCheck } from "@/lib/auth/check";
import { env } from "@/lib/env";

// Demo org slug (must match seed-demo.ts)
const DEMO_ORG_SLUG = "dev-org";

export const Route = createFileRoute("/$")({
  beforeLoad: async ({ location }) => {
    // Guard: if the path already starts with /o/, don't redirect again
    // (prevents infinite redirect loops for non-existent org-scoped paths)
    if (location.pathname.startsWith("/o/")) {
      return;
    }

    // In demo mode, redirect directly to the demo org with the current path
    if (env.VITE_SKIP_AUTH_DEMO) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      throw redirect({
        to: `/o/${DEMO_ORG_SLUG}${location.pathname}`,
        search: location.search,
      } as any);
    }

    // Check if user is authenticated (throws redirect to sign-in if not)
    const auth = await userAuthCheck();

    if (auth.session.activeOrganizationId) {
      const orgSlug = auth.allOrgs?.find(
        (org) => org.id === auth.session.activeOrganizationId,
      )?.slug;

      if (orgSlug) {
        // Redirect to the same path under the user's active org
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        throw redirect({
          to: `/o/${orgSlug}${location.pathname}`,
          search: location.search,
        } as any);
      }
    }

    // No active org - redirect to org selector
    throw redirect({ to: "/o" });
  },
});
