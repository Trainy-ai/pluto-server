import PageLayout from "@/components/layout/page-layout";
import { OrganizationPageTitle } from "@/components/layout/page-title";
import RunComparisonLayout from "@/components/layout/runComparison/layout";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { trpc } from "@/utils/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  sweepStateBadgeProps,
  SWEEP_STATE_LABEL,
} from "./~components/sweeps/sweep-summary-bar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";


export const Route = createFileRoute(
  "/o/$orgSlug/_authed/(runComparison)/projects/$projectName/sweeps/",
)({
  // Mirrors the sibling routes: the org id comes off the authed route context
  // rather than a hook, so it is available before the component renders.
  beforeLoad: ({ context }) => ({
    organizationId: context.auth.activeOrganization.id,
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { projectName, orgSlug } = Route.useParams();
  const { organizationId } = Route.useRouteContext();

  const { data, isLoading } = useQuery({
    ...trpc.sweeps.list.queryOptions({
      organizationId,
      projectName,
    }),
  });

  const sweeps = useMemo(() => data?.sweeps ?? [], [data]);

  return (
    <RunComparisonLayout>
      <PageLayout
        showSidebarTrigger={false}
        headerLeft={
          <OrganizationPageTitle
            breadcrumbs={[
              { title: "Home", to: "/o/$orgSlug" },
              { title: "Projects", to: "/o/$orgSlug/projects" },
              {
                title: projectName,
                to: "/o/$orgSlug/projects/$projectName",
              },
            ]}
            title="Sweeps"
          />
        }
      >
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 p-6 sm:p-8">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-semibold">Sweeps</h1>
            {!isLoading && (
              <span className="text-sm text-muted-foreground">
                {sweeps.length} in {projectName}
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="flex flex-col gap-2" data-testid="sweeps-loading">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : sweeps.length === 0 ? (
            <EmptyState />
          ) : (
            <div
              className="overflow-hidden rounded-lg border"
              data-testid="sweeps-list"
            >
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Sweep</th>
                    <th className="px-4 py-2 text-left font-medium">State</th>
                    <th className="px-4 py-2 text-left font-medium">Method</th>
                    <th className="px-4 py-2 text-left font-medium">Objective</th>
                    <th className="px-4 py-2 text-right font-medium">Runs</th>
                    <th className="px-4 py-2 text-right font-medium">Last run</th>
                  </tr>
                </thead>
                <tbody>
                  {sweeps.map((sweep) => {
                    const badge = sweepStateBadgeProps(sweep.state);
                    return (
                    <tr
                      key={sweep.sweepId}
                      className="border-t hover:bg-muted/30"
                      data-testid="sweep-row"
                    >
                      <td className="px-4 py-2">
                        <Link
                          to="/o/$orgSlug/projects/$projectName/sweeps/$sweepId"
                          params={{ orgSlug, projectName, sweepId: sweep.sweepId }}
                          className="font-mono text-primary hover:underline"
                          data-testid={`sweep-link-${sweep.sweepId}`}
                        >
                          {sweep.name ?? sweep.sweepId}
                        </Link>
                        {/* Only migrated sweeps are marked. Native is the
                            default, so a badge on every row would carry no
                            information — the tag exists on wandb imports only. */}
                        {sweep.fromWandb && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            wandb
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <Badge
                          {...badge}
                          className={cn("text-[10px]", badge.className)}
                        >
                          {SWEEP_STATE_LABEL[sweep.state].label}
                        </Badge>
                      </td>
                      {/* A native sweep keeps its search space client-side, so
                          method/objective are genuinely unknown here rather than
                          missing — say so instead of rendering a blank cell. */}
                      <td className="px-4 py-2">
                        {sweep.method ?? <Unknown />}
                      </td>
                      <td className="px-4 py-2">
                        {sweep.metric ? (
                          <span className="font-mono text-xs">
                            {sweep.metric.goal === "maximize" ? "max" : "min"}{" "}
                            {sweep.metric.name}
                          </span>
                        ) : (
                          <Unknown />
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {sweep.runCount}
                        {sweep.gridTotal != null && (
                          <span className="text-muted-foreground">/{sweep.gridTotal}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-muted-foreground">
                        {new Date(sweep.lastRun).toLocaleDateString()}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </PageLayout>
    </RunComparisonLayout>
  );
}

function Unknown() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-xs text-muted-foreground/60">—</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        This sweep did not record its search space, so the server does not know
        its method or objective.
      </TooltipContent>
    </Tooltip>
  );
}

function EmptyState() {
  return (
    <div
      className="rounded-lg border border-dashed p-10 text-center"
      data-testid="sweeps-empty"
    >
      <p className="text-sm font-medium">No sweeps in this project</p>
      <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
        Runs join a sweep by carrying a <code>sweep:&lt;id&gt;</code> tag — added
        automatically by <code>pluto.agent()</code> and by the wandb migration.
      </p>
    </div>
  );
}
