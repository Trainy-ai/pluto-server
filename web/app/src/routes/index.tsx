import { userAuthCheck } from "@/lib/auth/check";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    // Get the auth object from the query client
    const auth = await userAuthCheck();

    // If the user is signed in, and has an active organization, redirect to the organization
    if (auth.session.activeOrganizationId) {
      const orgs = auth.allOrgs;

      const orgSlug = orgs?.find(
        (org) => org.id === auth.session.activeOrganizationId,
      )?.slug;

      if (orgSlug) {
        throw redirect({ to: `/o/$orgSlug`, params: { orgSlug } });
      } else {
        throw redirect({ to: "/o" });
      }
    }

    // If the user is signed in, and has no active organization, redirect to the organization selector
    throw redirect({ to: "/o" });
  },
});
