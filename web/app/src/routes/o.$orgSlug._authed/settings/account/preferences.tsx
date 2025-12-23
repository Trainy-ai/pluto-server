import { SettingsLayout } from "@/components/layout/settings/layout";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/o/$orgSlug/_authed/settings/account/preferences",
)({
  component: RouteComponent,
});

function RouteComponent() {
  return <SettingsLayout>Hello</SettingsLayout>;
}
