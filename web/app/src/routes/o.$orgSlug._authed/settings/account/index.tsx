import { createFileRoute } from "@tanstack/react-router";
import { SettingsLayout } from "@/components/layout/settings/layout";
import { AccountSettings } from "@/components/layout/settings/account-settings";

export const Route = createFileRoute("/o/$orgSlug/_authed/settings/account/")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <SettingsLayout>
      <AccountSettings />
    </SettingsLayout>
  );
}
