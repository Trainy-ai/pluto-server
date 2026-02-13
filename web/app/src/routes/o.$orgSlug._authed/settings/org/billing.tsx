import { SettingsLayout } from "@/components/layout/settings/layout";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Zap, CreditCard, GraduationCap } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import { Usage } from "./~components/usage";
import { Separator } from "@/components/ui/separator";
import { MembersLimit } from "./~components/members-limit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/sonner";
import { z } from "zod";
import { useEffect } from "react";

const searchSchema = z.object({
  success: z.boolean().optional(),
  cancelled: z.boolean().optional(),
});

export const Route = createFileRoute(
  "/o/$orgSlug/_authed/settings/org/billing",
)({
  component: RouteComponent,
  validateSearch: searchSchema,
  beforeLoad: async ({ context }) => {
    const auth = context.auth;
    const organizationId = auth.activeOrganization.id;
    const membership = auth.activeOrganization.membership;

    return {
      organizationId,
      orgSubscription: auth.activeOrganization.OrganizationSubscription,
      canManageBilling: membership.role === "OWNER" || membership.role === "ADMIN",
    };
  },
});

const FREE_FEATURES = [
  "2 team members",
  "2 GB storage",
];

const PRO_FEATURES = [
  "Up to 10 team members",
  "10 TB storage",
];

function RouteComponent() {
  const { organizationId, orgSubscription, canManageBilling } = Route.useRouteContext();
  const search = Route.useSearch();
  const isPro = orgSubscription.plan === "PRO";
  const isEducationPlan = orgSubscription.isEducationPlan;

  // Check if Stripe billing is configured and get seat price
  const { data: billingConfig, isLoading: isBillingConfigLoading } = useQuery(
    trpc.organization.billing.isConfigured.queryOptions()
  );
  const isStripeConfigured = billingConfig?.isConfigured ?? false;
  const seatPrice = billingConfig?.seatPriceDollars;

  // Show toast for successful upgrade
  useEffect(() => {
    if (search.success) {
      toast.success("Successfully upgraded to PRO plan!");
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (search.cancelled) {
      toast.info("Upgrade cancelled");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [search.success, search.cancelled]);

  const checkoutMutation = useMutation(
    trpc.organization.billing.createCheckoutSession.mutationOptions({
      onSuccess: (data) => {
        if (data.checkoutUrl) {
          window.location.href = data.checkoutUrl;
        }
      },
      onError: (error) => {
        toast.error(error.message);
      },
    })
  );

  const portalMutation = useMutation(
    trpc.organization.billing.createPortalSession.mutationOptions({
      onSuccess: (data) => {
        if (data.portalUrl) {
          window.location.href = data.portalUrl;
        }
      },
      onError: (error) => {
        toast.error(error.message);
      },
    })
  );

  function handleUpgrade() {
    checkoutMutation.mutate({ organizationId });
  }

  function handleManageBilling() {
    portalMutation.mutate({ organizationId });
  }

  return (
    <SettingsLayout>
      <div className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col gap-6 p-4 sm:gap-8 sm:p-8">
        <div className="grid gap-2">
          <h1 className="text-2xl font-bold">Billing</h1>
          <p className="text-sm text-muted-foreground">
            Manage your subscription and usage limits.
          </p>
        </div>

        {/* Plan Comparison */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Free Plan */}
          <Card className={!isPro ? "border-primary" : ""}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Free</CardTitle>
                {!isPro && <Badge variant="secondary">Current Plan</Badge>}
              </div>
              <CardDescription>For individuals and small teams</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-3xl font-bold">
                $0<span className="text-sm font-normal text-muted-foreground">/month</span>
              </div>
              <ul className="space-y-2">
                {FREE_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm">
                    <Check className="h-4 w-4 text-muted-foreground" />
                    {feature}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Pro Plan */}
          <Card className={isPro ? "border-primary" : ""}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg">Pro</CardTitle>
                  <Zap className="h-4 w-4 text-yellow-500" />
                </div>
                {isPro && isEducationPlan && (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    <GraduationCap className="h-3 w-3" />
                    Education Plan
                  </Badge>
                )}
                {isPro && !isEducationPlan && <Badge variant="secondary">Current Plan</Badge>}
              </div>
              <CardDescription>For growing teams with advanced needs</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                {isEducationPlan ? (
                  <div className="text-3xl font-bold">
                    $0<span className="text-sm font-normal text-muted-foreground">/month</span>
                  </div>
                ) : (
                  <>
                    <div className="text-3xl font-bold">
                      {seatPrice !== undefined ? (
                        <>${seatPrice}<span className="text-sm font-normal text-muted-foreground">/seat/month</span></>
                      ) : (
                        <span className="inline-block h-9 w-24 animate-pulse rounded bg-muted" />
                      )}
                    </div>
                    {isPro && seatPrice !== undefined && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {orgSubscription.seats} {orgSubscription.seats === 1 ? "seat" : "seats"} × ${seatPrice} = ${orgSubscription.seats * seatPrice}/month
                      </p>
                    )}
                  </>
                )}
              </div>
              <ul className="space-y-2">
                {PRO_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm">
                    <Check className="h-4 w-4 text-green-500" />
                    {feature}
                  </li>
                ))}
              </ul>
              {isEducationPlan && (
                <p className="text-sm text-muted-foreground text-center">
                  Free Pro access for educational institutions.
                </p>
              )}
              {!isPro && canManageBilling && isStripeConfigured && (
                <Button
                  className="w-full"
                  onClick={handleUpgrade}
                  loading={checkoutMutation.isPending}
                >
                  <Zap className="mr-2 h-4 w-4" />
                  Upgrade to Pro
                </Button>
              )}
              {!isPro && canManageBilling && !isStripeConfigured && (
                <p className="text-sm text-muted-foreground text-center">
                  <a
                    href="mailto:founders@trainy.ai"
                    className="text-primary underline hover:no-underline"
                  >
                    Contact us
                  </a>{" "}
                  to upgrade to Pro
                </p>
              )}
              {isPro && !isEducationPlan && canManageBilling && isStripeConfigured && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleManageBilling}
                  loading={portalMutation.isPending}
                >
                  <CreditCard className="mr-2 h-4 w-4" />
                  Manage Subscription
                </Button>
              )}
              {!canManageBilling && !isEducationPlan && (
                <p className="text-sm text-muted-foreground text-center">
                  Contact an admin to manage billing
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <Separator />

        {/* Usage Section */}
        <div className="grid gap-4">
          <h2 className="text-xl font-semibold">Usage</h2>
          <MembersLimit
            organizationId={organizationId}
            maxMembers={orgSubscription.seats}
          />
          <Usage
            organizationId={organizationId}
            maxUsage={orgSubscription.usageLimits.dataUsageGB}
          />
        </div>

        {!isPro && (
          <>
            <Separator />
            <div className="grid gap-2">
              <h2 className="text-xl font-semibold">Need a custom plan?</h2>
              <p className="text-sm text-muted-foreground">
                For enterprise needs or custom requirements, please{" "}
                <a
                  href="mailto:founders@trainy.ai"
                  className="text-primary underline hover:no-underline"
                >
                  contact us
                </a>{" "}
                and we&apos;ll work with you to find the right solution.
              </p>
            </div>
          </>
        )}
      </div>
    </SettingsLayout>
  );
}
