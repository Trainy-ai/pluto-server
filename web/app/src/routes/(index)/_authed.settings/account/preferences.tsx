import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/(index)/_authed/settings/account/preferences")(
  {
    component: RouteComponent,
  },
);

function RouteComponent() {
  return <div>Hello</div>;
}
