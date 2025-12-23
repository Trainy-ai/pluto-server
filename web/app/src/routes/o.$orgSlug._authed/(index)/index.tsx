import { createFileRoute, Link } from "@tanstack/react-router";
import DashboardLayout from "@/components/layout/dashboard/layout";
import PageLayout from "@/components/layout/page-layout";
import { OrganizationPageTitle } from "@/components/layout/page-title";
import { GettingStarted } from "./~components/getting-started";
import { RecentRuns } from "./~components/recent-runs";
import { RecentRunsSkeleton } from "./~components/recent-runs-skeleton";
import { useGettingStartedVisibility } from "./~hooks/use-getting-started";
import {
  prefetchLatestRuns,
  useLatestRuns,
} from "@/components/layout/dashboard/queries";
import { Button } from "@/components/ui/button";
export const Route = createFileRoute("/o/$orgSlug/_authed/(index)/")({
  component: RouteComponent,
  beforeLoad: async ({ context }) => {
    const auth = context.auth;
    prefetchLatestRuns(auth.activeOrganization.id);
  },
});

function RouteComponent() {
  const { orgSlug } = Route.useParams();
  const { auth } = Route.useRouteContext();
  const { visibility } = useGettingStartedVisibility({ orgSlug });

  const { data: runs, isLoading } = useLatestRuns(auth.activeOrganization.id);

  return (
    <DashboardLayout>
      <PageLayout headerLeft={<OrganizationPageTitle title="Home" />}>
        <div className="mx-auto max-w-7xl p-4 sm:p-6">
          <div className="flex flex-col gap-8">
            {isLoading ? (
              <RecentRunsSkeleton />
            ) : runs && runs.length > 0 ? (
              <>
                <RecentRuns
                  runs={visibility === "visible" ? runs.slice(0, 4) : runs}
                  orgSlug={orgSlug}
                />
              </>
            ) : (
              <>
                {visibility !== "visible" && (
                  <div className="flex flex-col items-center gap-8 rounded-xl border border-dashed border-accent-foreground/50 bg-gradient-to-b from-accent to-accent/50 p-12 text-center shadow-sm">
                    <div className="flex flex-col gap-4">
                      <h2 className="text-3xl font-bold tracking-tight">
                        Create your first experiment
                      </h2>
                      <p className="max-w-lg text-lg text-accent-foreground/90">
                        Get started by creating your first ML experiment. Track
                        metrics, visualize results, and collaborate with your
                        team.
                      </p>
                    </div>
                    <div className="flex gap-4">
                      <Button
                        variant="default"
                        size="lg"
                        className="font-medium shadow-sm transition-shadow hover:shadow-md"
                      >
                        <a
                          href="https://docs.mlop.ai/docs/getting-started/quickstart"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2"
                        >
                          Read the docs
                        </a>
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
            {visibility === "visible" && <GettingStarted orgSlug={orgSlug} />}
          </div>
        </div>
      </PageLayout>
    </DashboardLayout>
  );
}
