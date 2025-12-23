import { userAuthCheck } from "@/lib/auth/check";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/onboard/")({
  beforeLoad: async () => {
    await userAuthCheck();

    throw redirect({ to: "/o" });
  },
});
