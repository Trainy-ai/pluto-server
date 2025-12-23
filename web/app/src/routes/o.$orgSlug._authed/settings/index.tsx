import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/o/$orgSlug/_authed/settings/")({
  beforeLoad: async ({ params }) => {
    throw redirect({
      to: "/o/$orgSlug/settings/account",
      params: { orgSlug: params.orgSlug },
    });
  },
});
