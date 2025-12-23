import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { OrganizationList } from "../onboard/~components/org-list";
import Loader from "@/components/loader";
import InvitesList from "./../o/~components/invites-list";
import { queryClient, trpc } from "@/utils/trpc";
import { Footer } from "@/components/ui/footer";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { userAuthCheck } from "@/lib/auth/check";

export const Route = createFileRoute("/onboard/invites")({
  component: RouteComponent,
  beforeLoad: async ({ search }) => {
    const auth = await userAuthCheck({ search });

    // If the user is onboarding, check if they have any invites
    await queryClient.ensureQueryData(
      trpc.organization.invite.myInvites.queryOptions(),
    );

    return { orgs: auth.allOrgs };
  },
  pendingComponent: () => <Loader />,
  loader: async ({ context }) => {
    return { orgs: context.orgs };
  },
});

function RouteComponent() {
  const { orgs } = Route.useLoaderData();
  // Subscribe for updates to `myInvites`
  const { data: invites } = useQuery(
    trpc.organization.invite.myInvites.queryOptions(),
  );

  const hasInvites = (invites?.length ?? 0) > 0;

  const titleStyle =
    "bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-transparent";

  return (
    <div className="relative min-h-screen bg-background">
      {/* Header */}
      <div className="fixed inset-x-0 top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <a
              href="https://mlop.ai"
              className="group flex items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-accent"
            >
              <span className="text-lg font-semibold tracking-tight">
                m:lop
              </span>
            </a>
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="relative mx-auto max-w-screen-2xl px-4 pt-24 pb-32 sm:px-6 lg:px-8">
        {/* Background decoration */}
        <div className="absolute top-0 right-0 left-0 -z-10 overflow-hidden">
          <div className="relative h-[400px] w-full">
            <div className="absolute top-0 -left-4 h-64 w-64 rounded-full bg-primary/5" />
            <div className="absolute top-24 -right-4 h-64 w-64 rounded-full bg-primary/5" />
            <div className="absolute top-16 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-primary/5" />
          </div>
        </div>

        <div className="mx-auto max-w-screen-xl">
          <div className="mb-12 text-center">
            <h1
              className={cn(
                "text-4xl font-bold tracking-tight sm:text-5xl",
                titleStyle,
              )}
            >
              Your Invites
            </h1>
            <p className="mt-4 text-base text-muted-foreground">
              {hasInvites
                ? "Please respond to your invites"
                : "No invites found"}
            </p>
          </div>

          <div className={cn("relative grid gap-8 lg:gap-12")}>
            {hasInvites && (
              <div className="min-w-0">
                <InvitesList titleStyle={titleStyle} redirect="/o" />
              </div>
            )}
          </div>
        </div>
      </main>

      <Footer className="border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60" />
    </div>
  );
}
