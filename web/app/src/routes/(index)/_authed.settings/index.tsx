/**
 * Automatically reroute requests to /settings to /settings/account
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(index)/_authed/settings/")({
  beforeLoad: () => {
    throw redirect({
      to: "/settings/account",
    });
  },
});
