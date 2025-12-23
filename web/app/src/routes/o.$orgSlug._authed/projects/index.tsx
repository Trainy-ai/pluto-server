import { Card, CardContent } from "@/components/ui/card";
import { trpc, trpcClient } from "@/utils/trpc";
import { createFileRoute } from "@tanstack/react-router";
import PageLayout from "@/components/layout/page-layout";
import { OrganizationPageTitle } from "@/components/layout/page-title";
import { columns } from "./~components/table/columns";
import { DataTable } from "./~components/table/data-table";
import DashboardLayout from "@/components/layout/dashboard/layout";
import { RefreshButton } from "@/components/core/refresh-button";
import { useState, useMemo } from "react";
import { queryClient } from "@/utils/trpc";
import { LocalCache } from "@/lib/db/local-cache";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { prefetchLocalQuery, useLocalQuery } from "@/lib/hooks/use-local-query";

type ProjectData = inferOutput<typeof trpc.projects.list>;

const REFRESH_INTERVAL = 1000 * 30; // 30 seconds
const INCLUDED_RUNS = 1;
const PAGE_SIZE = 50;

const projectsCache = new LocalCache<ProjectData>(
  "projects",
  "projects",
  1024 * 1024 * 1024,
);

const projectsCountCache = new LocalCache<number>(
  "projects",
  "projects-count",
  1024 * 1024,
);

export const Route = createFileRoute("/o/$orgSlug/_authed/projects/")({
  component: RouteComponent,
  beforeLoad: async ({ params, context }) => {
    const auth = context.auth;
    const organizationId = auth.activeOrganization.id;

    const queryOptions = {
      organizationId,
      includeNRuns: INCLUDED_RUNS,
      limit: PAGE_SIZE,
      cursor: 0,
      direction: "forward" as const,
    };

    // Prefetch both the initial data and the count
    await Promise.all([
      prefetchLocalQuery(queryClient, {
        queryKey: trpc.projects.list.queryKey(queryOptions),
        queryFn: () => trpcClient.projects.list.query(queryOptions),
        localCache: projectsCache,
        staleTime: REFRESH_INTERVAL,
      }),
      prefetchLocalQuery(queryClient, {
        queryKey: trpc.projects.count.queryKey({ organizationId }),
        queryFn: () => trpcClient.projects.count.query({ organizationId }),
        localCache: projectsCountCache,
        staleTime: REFRESH_INTERVAL, // Count doesn't need to be refreshed often
      }),
    ]);

    return {
      organizationId: auth.activeOrganization.id,
      organizationSlug: params.orgSlug,
    };
  },
});

function RouteComponent() {
  const { organizationId, organizationSlug } = Route.useRouteContext();
  const [lastRefreshed, setLastRefreshed] = useState<Date | undefined>(
    undefined,
  );
  const [pageIndex, setPageIndex] = useState(0);

  const queryOptions = useMemo(
    () => ({
      organizationId,
      includeNRuns: INCLUDED_RUNS,
      limit: PAGE_SIZE,
      cursor: pageIndex * PAGE_SIZE,
      direction: "forward" as const,
    }),
    [organizationId, pageIndex], // Only re-update when organizationId or pageIndex changes
  );

  const { data: projectsData, isLoading } = useLocalQuery<ProjectData>({
    queryKey: trpc.projects.list.queryKey(queryOptions),
    queryFn: () => trpcClient.projects.list.query(queryOptions),
    localCache: projectsCache,
    staleTime: REFRESH_INTERVAL,
  });

  const { data: totalCount = 0, isLoading: isCountLoading } =
    useLocalQuery<number>({
      queryKey: trpc.projects.count.queryKey({ organizationId }),
      queryFn: () => trpcClient.projects.count.query({ organizationId }),
      localCache: projectsCountCache,
      staleTime: Infinity, // Count doesn't need to be refreshed often
    });

  const refreshData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: trpc.projects.list.queryKey(),
        refetchType: "all",
      }),
      queryClient.invalidateQueries({
        queryKey: trpc.projects.count.queryKey(),
        refetchType: "all",
      }),
    ]);
    setLastRefreshed(new Date());
  };

  const handlePaginationChange = ({
    pageIndex: newPageIndex,
  }: {
    pageIndex: number;
    pageSize: number;
  }) => {
    setPageIndex(newPageIndex);
  };

  // Calculate total pages based on total count
  const pageCount = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <DashboardLayout>
      <PageLayout
        headerLeft={
          <OrganizationPageTitle
            title="Projects"
            breadcrumbs={[{ title: "Home", to: "/o/$orgSlug" }]}
          />
        }
      >
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[1200px] flex-col gap-6 p-6 sm:gap-8 sm:p-8">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight">
                  All Projects
                </h2>
                <p className="text-sm text-muted-foreground">
                  View and manage all your organization's projects. Click on a
                  project to see its details and runs.
                </p>
              </div>
              <RefreshButton
                onRefresh={refreshData}
                lastRefreshed={lastRefreshed}
                refreshInterval={REFRESH_INTERVAL}
                defaultAutoRefresh={false}
              />
            </div>
          </div>

          <Card>
            <CardContent className="p-4">
              <DataTable
                columns={columns({ orgSlug: organizationSlug })}
                data={projectsData?.projects ?? []}
                pageCount={pageCount}
                pageIndex={pageIndex}
                pageSize={PAGE_SIZE}
                isLoading={isLoading || isCountLoading}
                onPaginationChange={handlePaginationChange}
              />
            </CardContent>
          </Card>
        </div>
      </PageLayout>
    </DashboardLayout>
  );
}
