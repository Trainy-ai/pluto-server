import { SettingsLayout } from "@/components/layout/settings/layout";
import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { Sparkles, Zap, Gift, Star } from "lucide-react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import { Usage } from "./~components/usage";
import { Separator } from "@/components/ui/separator";
import { MembersLimit } from "./~components/members-limit";

export const Route = createFileRoute(
  "/o/$orgSlug/_authed/settings/org/billing",
)({
  component: RouteComponent,
  beforeLoad: async ({ context }) => {
    const auth = context.auth;
    const organizationId = auth.activeOrganization.id;

    return {
      organizationId,
      orgSubscription: auth.activeOrganization.OrganizationSubscription,
    };
  },
});

function RouteComponent() {
  const { organizationId, orgSubscription } = Route.useRouteContext();

  return (
    <SettingsLayout>
      <div className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col gap-4 p-4 sm:gap-8 sm:p-8">
        <div className="grid gap-4">
          <h1 className="text-2xl font-bold">Billing</h1>
          <p className="text-sm text-muted-foreground">
            Manage your billing information and usage limits.
          </p>
          <p className="text-sm text-muted-foreground">
            Your current plan is the {orgSubscription.plan} tier.
          </p>
        </div>
        <MembersLimit
          organizationId={organizationId}
          maxMembers={orgSubscription.seats}
        />
        <Usage
          organizationId={organizationId}
          maxUsage={orgSubscription.usageLimits.dataUsageGB}
        />

        <Separator />
        <div className="grid gap-4">
          <h1 className="text-2xl font-bold">Note</h1>
          <p className="text-sm text-muted-foreground">
            We are currently in beta and only selecting a few users to join our
            pro plan. Please{" "}
            <a
              href="mailto:founders@mlop.ai"
              className="text-blue-500 underline"
            >
              contact us
            </a>{" "}
            to join. We would love to build the plan around your needs.
          </p>
        </div>
      </div>
    </SettingsLayout>
  );
}
