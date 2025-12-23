import { createFileRoute } from "@tanstack/react-router";
import { AccountSettings } from "@/components/layout/settings/account-settings";

export const Route = createFileRoute("/(index)/_authed/settings/account/")({
  component: RouteComponent,
});

function RouteComponent() {
  return <AccountSettings />;
}
