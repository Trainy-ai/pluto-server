import { createFileRoute, redirect } from "@tanstack/react-router";
import { columns } from "./~components/api-keys/columns";
import { DataTable } from "./~components/api-keys/data-table";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import { CreateApiKeyDialog } from "./~components/api-keys/create-api-key-dialog";
import { SettingsLayout } from "@/components/layout/settings/layout";
import { Skeleton } from "@/components/ui/skeleton";
import { orgAuthCheck } from "@/lib/auth/check";
export const Route = createFileRoute(
  "/o/$orgSlug/_authed/settings/org/developers",
)({
  component: RouteComponent,
  beforeLoad: async ({ params }) => {
    const { auth } = await orgAuthCheck(params.orgSlug);

    return { orgId: auth.activeOrganization.id };
  },
  loader: ({ context }) => {
    // Prefetch the API keys query
    context.queryClient.prefetchQuery(
      trpc.organization.apiKey.listApiKeys.queryOptions({
        organizationId: context.orgId,
      }),
    );

    return { orgId: context.orgId };
  },
});

function RouteComponent() {
  const { orgId } = Route.useLoaderData();

  const {
    data: keys,
    refetch,
    isLoading,
  } = useQuery(
    trpc.organization.apiKey.listApiKeys.queryOptions({
      organizationId: orgId,
    }),
  );

  return (
    <SettingsLayout>
      <div className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col gap-4 p-4 sm:gap-8 sm:p-8">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h1 className="text-xl font-bold sm:text-2xl">API Keys</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Manage your API keys and their access to your organization.
              </p>
            </div>
            <CreateApiKeyDialog organizationId={orgId} onSuccess={refetch} />
          </div>
        </div>

        <div className="rounded-lg border bg-card">
          <div className="-mx-4 sm:mx-0">
            <div className="overflow-x-auto">
              <div className="min-w-[800px] sm:min-w-full">
                {isLoading ? (
                  <div className="flex h-full w-full items-center justify-center">
                    <Skeleton className="h-[500px] w-full" />
                  </div>
                ) : (
                  <DataTable
                    columns={columns({ organizationId: orgId })}
                    data={keys ?? []}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </SettingsLayout>
  );
}
