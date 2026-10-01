import { orgAuthCheck } from "@/lib/auth/check";
import { CopilotProvider } from "@/components/copilot/copilot-provider";
import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

const searchParamsSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/o/$orgSlug/_authed")({
  validateSearch: (search) => {
    return searchParamsSchema.parse(search);
  },
  beforeLoad: async ({ params: { orgSlug }, search }) => {
    // Get the auth object from the query client
    const auth = await orgAuthCheck(orgSlug, { search });

    // If there is a redirect, redirect to the redirect url
    if (search?.redirect) {
      throw redirect({ to: search.redirect });
    }

    return auth;
  },
  component: AuthedLayout,
});

/**
 * The copilot provider sits here, above every page's own layout, so the
 * open panel and its conversation survive navigation between pages.
 */
function AuthedLayout() {
  return (
    <CopilotProvider>
      <Outlet />
    </CopilotProvider>
  );
}
