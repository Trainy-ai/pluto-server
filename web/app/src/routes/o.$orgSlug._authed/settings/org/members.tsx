import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DataTable as InvitesTable } from "./~components/members/invites/data-table";
import { DataTable as MembersTable } from "./~components/members/users/data-table";
import { columns } from "./~components/members/invites/columns";
import { columns as MembersColumns } from "./~components/members/users/columns";
import { InviteUser } from "@/components/layout/common/invite-user-button";
import { SettingsLayout } from "@/components/layout/settings/layout";
import { Skeleton } from "@/components/ui/skeleton";
import { orgAuthCheck } from "@/lib/auth/check";

export const Route = createFileRoute(
  "/o/$orgSlug/_authed/settings/org/members",
)({
  component: RouteComponent,
  beforeLoad: async ({ params }) => {
    const { auth } = await orgAuthCheck(params.orgSlug);
    return {
      auth,
    };
  },
  loader: async ({ context }) => {
    return {
      auth: context.auth,
    };
  },
});

function RouteComponent() {
  const { auth } = Route.useLoaderData();
  if (!auth.activeOrganization) {
    return <div>No organization selected</div>;
  }
  const {
    data: invites,
    isLoading: invitesLoading,
    isError: invitesError,
  } = useQuery(
    trpc.organization.invite.listSentInvites.queryOptions({
      organizationId: auth.activeOrganization.id,
    }),
  );

  const {
    data: members,
    isLoading: membersLoading,
    isError: membersError,
  } = useQuery(
    trpc.organization.listMembers.queryOptions({
      organizationId: auth.activeOrganization.id,
    }),
  );
  return (
    <SettingsLayout>
      <div className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col gap-4 p-4 sm:gap-8 sm:p-8">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h1 className="text-xl font-bold sm:text-2xl">Invites</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Manage your organization invites.
              </p>
            </div>
            {/* <CreateApiKeyDialog organizationId={orgId} onSuccess={refetch} /> */}
            <InviteUser className="w-16" variant={undefined} />
          </div>
        </div>

        <div className="rounded-lg border bg-card">
          <div className="-mx-4 sm:mx-0">
            <div className="overflow-x-auto">
              <div className="min-w-[800px] sm:min-w-full">
                {invitesLoading ? (
                  <div className="flex h-full w-full items-center justify-center">
                    <Skeleton className="h-[200px] w-full" />
                  </div>
                ) : (
                  <InvitesTable
                    columns={columns({
                      organizationId: auth.activeOrganization.id,
                    })}
                    data={invites ?? []}
                  />
                )}
                {invitesError && (
                  <div className="flex h-full w-full items-center justify-center">
                    <p className="text-sm text-muted-foreground">
                      Error loading invites
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-12 flex flex-col gap-4">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h1 className="text-xl font-bold sm:text-2xl">Members </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Manage your organization members.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-card">
          <div className="-mx-4 sm:mx-0">
            <div className="overflow-x-auto">
              <div className="min-w-[800px] sm:min-w-full">
                {membersLoading ? (
                  <div className="flex h-full w-full items-center justify-center">
                    <Skeleton className="h-[200px] w-full" />
                  </div>
                ) : (
                  <MembersTable
                    columns={MembersColumns({
                      organizationId: auth.activeOrganization.id,
                    })}
                    data={members ?? []}
                  />
                )}
                {membersError && (
                  <div className="flex h-full w-full items-center justify-center">
                    <p className="text-sm text-muted-foreground">
                      Error loading members
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </SettingsLayout>
  );
}
