import { createFileRoute, Outlet } from "@tanstack/react-router";
import { SettingsLayout } from "@/components/layout/settings/layout";
import { userAuthCheck } from "@/lib/auth/check";

export const Route = createFileRoute("/(index)/_authed")({
  component: RouteComponent,
  beforeLoad: async () => {
    // `userAuthCheck` will automatically handle any reroutes / auth errors
    const auth = await userAuthCheck();

    return auth;
  },
});

function RouteComponent() {
  return (
    // Apply the `SettingsLayout` to all children of this route
    <SettingsLayout>
      <Outlet />
    </SettingsLayout>
  );
}
