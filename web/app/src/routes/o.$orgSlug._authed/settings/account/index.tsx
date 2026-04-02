import { createFileRoute } from "@tanstack/react-router";
import { SettingsLayout } from "@/components/layout/settings/layout";
import { AccountSettings } from "@/components/layout/settings/account-settings";
import { useDocumentTitle } from "@/hooks/use-document-title";

export const Route = createFileRoute("/o/$orgSlug/_authed/settings/account/")({
  component: RouteComponent,
});

function RouteComponent() {
  useDocumentTitle("Account Settings");
  return (
    <SettingsLayout>
      <AccountSettings />
    </SettingsLayout>
  );
}
