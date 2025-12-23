import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { OrganizationList } from "../onboard/~components/org-list";
import InvitesList from "./~components/invites-list";
import { z } from "zod";
import { queryClient, trpc } from "@/utils/trpc";
import { Footer } from "@/components/ui/footer";
import { cn } from "@/lib/utils";
import { userAuthCheck } from "@/lib/auth/check";
import { usePreloadOrgs } from "./~components/preload-orgs";

const searchParamsSchema = z.object({
  onboarding: z.boolean().optional(),
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/o/")({
  component: RouteComponent,
  validateSearch: (search) => {
    return searchParamsSchema.parse(search);
  },
  beforeLoad: async ({ search }) => {
    const [auth, invites] = await Promise.all([
      userAuthCheck({ search }),
      queryClient.ensureQueryData(
        trpc.organization.invite.myInvites.queryOptions(),
      ),
    ]);

    if (search.onboarding) {
      // if they do not have any invites, redirect to the organization setup page
      if (!invites?.length) {
        throw redirect({ to: "/onboard/org" });
      }
      // If they do have invites, redirect to the invites page
      throw redirect({
        to: "/onboard/invites",
      });
    }

    return { orgs: auth.allOrgs, invites };
  },
});

function RouteComponent() {
  const { orgs, invites } = Route.useRouteContext();
  const redirect = Route.useSearch()?.redirect;

  usePreloadOrgs(orgs.map((o) => o.slug));

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
              Welcome back
            </h1>
            <p className="mt-4 text-base text-muted-foreground">
              {hasInvites
                ? "Select an organization or respond to your invites"
                : "Select an organization to continue or create a new one"}
            </p>
          </div>

          <div
            className={cn(
              "relative grid gap-8 lg:gap-12",
              hasInvites ? "lg:grid-cols-2" : "mx-auto max-w-lg",
            )}
          >
            <div className="relative min-w-0">
              <OrganizationList organizations={orgs} redirect={redirect} />
            </div>

            {hasInvites && (
              <div className="min-w-0">
                <InvitesList titleStyle={titleStyle} />
              </div>
            )}
          </div>
        </div>
      </main>

      <Footer className="border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60" />
    </div>
  );
}
