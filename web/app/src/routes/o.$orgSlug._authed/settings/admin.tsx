import { SettingsLayout } from "@/components/layout/settings/layout";
import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { useDebounceValue } from "@/lib/hooks/use-debounce-value";
import { useEffect, useState } from "react";
import { z } from "zod";
import { AdminOrganizationsTable } from "./~components/admin-organizations-table";

const searchSchema = z.object({
  upgraded: z.string().optional(),
});

export const Route = createFileRoute("/o/$orgSlug/_authed/settings/admin")({
  component: RouteComponent,
  validateSearch: searchSchema,
});

/**
 * Platform admin: upgrade any organization to PRO through the normal Stripe
 * checkout (where a promotion code can be entered) without joining the org.
 * The server enforces the PLATFORM_ADMIN_EMAILS gate; this page only renders.
 */
function RouteComponent() {
  const search = Route.useSearch();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounceValue(query.trim(), 300);

  const organizations = useQuery({
    ...trpc.admin.listOrganizations.queryOptions({
      search: debouncedQuery || undefined,
    }),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const checkoutMutation = useMutation(
    trpc.admin.createCheckoutSession.mutationOptions({
      onSuccess: (data) => {
        if (data.checkoutUrl) {
          window.location.href = data.checkoutUrl;
        }
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  // Stripe sends us back here after a completed checkout
  useEffect(() => {
    if (search.upgraded) {
      toast.success(`Checkout completed for ${search.upgraded}`, {
        description:
          "The org switches to Pro once Stripe's webhook arrives; refresh if it still shows Free.",
      });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [search.upgraded]);

  const isForbidden = organizations.error?.data?.code === "FORBIDDEN";

  return (
    <SettingsLayout>
      <div className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col gap-6 p-4 sm:gap-8 sm:p-8">
        <div className="grid gap-2">
          <h1 className="text-2xl font-bold">Pro upgrades</h1>
          <p className="text-sm text-muted-foreground">
            Platform admin only. Open a Pro checkout for any organization and
            enter the promotion code on the Stripe page. You are not added to
            the organization, and the owner becomes the Stripe customer.
          </p>
        </div>

        {isForbidden ? (
          <p className="text-sm text-muted-foreground">
            This page is only available to platform admins.
          </p>
        ) : (
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by organization name, slug, ID, or a member's email"
              className="max-w-md"
              data-testid="admin-org-search"
            />
            {organizations.isLoading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : organizations.isError ? (
              <p className="text-sm text-destructive">
                {organizations.error.message}
              </p>
            ) : (
              <AdminOrganizationsTable
                organizations={organizations.data ?? []}
                pendingOrganizationId={
                  checkoutMutation.isPending
                    ? checkoutMutation.variables?.organizationId
                    : undefined
                }
                onUpgrade={(organizationId) =>
                  checkoutMutation.mutate({ organizationId })
                }
              />
            )}
          </>
        )}
      </div>
    </SettingsLayout>
  );
}
