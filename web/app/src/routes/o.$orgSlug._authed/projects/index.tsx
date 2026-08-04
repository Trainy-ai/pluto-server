import { Card, CardContent } from "@/components/ui/card";
import { trpc, trpcClient } from "@/utils/trpc";
import { createFileRoute } from "@tanstack/react-router";
import PageLayout from "@/components/layout/page-layout";
import { OrganizationPageTitle } from "@/components/layout/page-title";
import { columns } from "./~components/table/columns";
import { DataTable } from "./~components/table/data-table";
import DashboardLayout from "@/components/layout/dashboard/layout";
import { RefreshButton } from "@/components/core/refresh-button";
import { useState, useMemo, useCallback, type ChangeEvent } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { queryClient } from "@/utils/trpc";
import { LocalCache } from "@/lib/db/local-cache";
import type { inferInput, inferOutput } from "@trpc/tanstack-react-query";
import { prefetchLocalQuery, useLocalQuery } from "@/lib/hooks/use-local-query";
import { useAuth } from "@/lib/auth/client";
import { InputSearch } from "@/components/ui/input-search";
import { useQuery } from "@tanstack/react-query";
import type { OnChangeFn, SortingState } from "@tanstack/react-table";

type ProjectData = inferOutput<typeof trpc.projects.list>;
/**
 * Sort keys the server accepts. Derived from the procedure's input so adding a
 * column the server can't order by is a type error rather than a silent
 * fallback to the default ordering.
 */
type ProjectSortField = NonNullable<
  inferInput<typeof trpc.projects.list>["sortBy"]
>;

const REFRESH_INTERVAL = 1000 * 30; // 30 seconds
const INCLUDED_RUNS = 1;
const PAGE_SIZE = 50;
/**
 * Longer than InputSearch's 175ms default: every settled keystroke here costs a
 * round trip for both the page and the count.
 */
const SEARCH_DEBOUNCE_MS = 300;

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
  const { data: session } = useAuth();
  useDocumentTitle("Projects");

  // Project deletion is destructive (wipes all runs), so only surface the
  // action for owners/admins — the server enforces the same rule.
  const memberRole = session?.activeOrganization?.membership?.role;
  const canDelete = memberRole === "OWNER" || memberRole === "ADMIN";
  const [lastRefreshed, setLastRefreshed] = useState<Date | undefined>(
    undefined,
  );
  const [pageIndex, setPageIndex] = useState(0);
  // Holds the debounced term — InputSearch owns the raw keystrokes and only
  // calls back once typing settles, so this state drives queries directly.
  const [search, setSearch] = useState("");

  const handleSearchChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setSearch(event.target.value);
      // Page 3 of the previous result set is meaningless against a new term,
      // and may not even exist — start every search at the first page.
      setPageIndex(0);
    },
    [],
  );

  // Single-column sort; empty means the server's default (createdAt ascending).
  const [sorting, setSorting] = useState<SortingState>([]);

  const handleSortingChange: OnChangeFn<SortingState> = useCallback(
    (updaterOrValue) => {
      setSorting((previous) =>
        typeof updaterOrValue === "function"
          ? updaterOrValue(previous)
          : updaterOrValue,
      );
      // Reordering reshuffles what lands on which page, so the current page
      // number no longer refers to anything the user chose.
      setPageIndex(0);
    },
    [],
  );

  const trimmedSearch = search.trim();
  const isSearching = trimmedSearch.length > 0;

  const activeSort = sorting[0];

  const queryOptions = useMemo(
    () => ({
      organizationId,
      includeNRuns: INCLUDED_RUNS,
      limit: PAGE_SIZE,
      cursor: pageIndex * PAGE_SIZE,
      direction: "forward" as const,
      ...(isSearching && { search: trimmedSearch }),
      // Column ids double as the server's sort keys.
      ...(activeSort && {
        sortBy: activeSort.id as ProjectSortField,
        sortDirection: activeSort.desc ? ("desc" as const) : ("asc" as const),
      }),
    }),
    [organizationId, pageIndex, isSearching, trimmedSearch, activeSort],
  );

  const countOptions = useMemo(
    () => ({
      organizationId,
      ...(isSearching && { search: trimmedSearch }),
    }),
    [organizationId, isSearching, trimmedSearch],
  );

  // Unfiltered browsing reads through the IndexedDB cache so revisits paint
  // instantly. Searches deliberately bypass it: persisting a record per search
  // term would grow the local store without bound for results that are cheap to
  // refetch and quick to go stale.
  const cachedProjects = useLocalQuery<ProjectData>({
    queryKey: trpc.projects.list.queryKey(queryOptions),
    queryFn: () => trpcClient.projects.list.query(queryOptions),
    localCache: projectsCache,
    staleTime: REFRESH_INTERVAL,
    enabled: !isSearching,
  });

  // No `placeholderData: keepPreviousData` here, deliberately. While idle these
  // observers sit on the *unfiltered* query key, so carrying the previous data
  // across a key change would present the whole project list as the first
  // search's matches — with `isLoading` false, since placeholder data counts as
  // success. Letting the data go undefined on a new term keeps the table on its
  // spinner and the summary hidden until real results land.
  const searchedProjects = useQuery({
    ...trpc.projects.list.queryOptions(queryOptions),
    staleTime: REFRESH_INTERVAL,
    enabled: isSearching,
  });

  const cachedCount = useLocalQuery<number>({
    queryKey: trpc.projects.count.queryKey(countOptions),
    queryFn: () => trpcClient.projects.count.query(countOptions),
    localCache: projectsCountCache,
    staleTime: Infinity, // Count doesn't need to be refreshed often
    enabled: !isSearching,
  });

  const searchedCount = useQuery({
    ...trpc.projects.count.queryOptions(countOptions),
    staleTime: REFRESH_INTERVAL,
    enabled: isSearching,
  });

  const { data: projectsData, isLoading } = isSearching
    ? searchedProjects
    : cachedProjects;

  const { data: totalCount = 0, isLoading: isCountLoading } = isSearching
    ? searchedCount
    : cachedCount;

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
                storageKey="refresh-interval:projects"
              />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <InputSearch
                placeholder="Search projects by name..."
                aria-label="Search projects by name"
                data-testid="projects-search-input"
                debounceTime={SEARCH_DEBOUNCE_MS}
                onChange={handleSearchChange}
                containerClassName="w-full sm:max-w-sm"
              />
              {isSearching && !isLoading && !isCountLoading && (
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="projects-search-summary"
                >
                  {`${totalCount} project${
                    totalCount === 1 ? "" : "s"
                  } matching "${trimmedSearch}"`}
                </p>
              )}
            </div>
          </div>

          <Card>
            <CardContent className="p-4">
              <DataTable
                columns={columns({
                  orgSlug: organizationSlug,
                  organizationId,
                  canDelete,
                })}
                data={projectsData?.projects ?? []}
                pageCount={pageCount}
                pageIndex={pageIndex}
                pageSize={PAGE_SIZE}
                totalCount={totalCount}
                emptyMessage={
                  isSearching
                    ? `No projects match "${trimmedSearch}".`
                    : "No projects found."
                }
                sorting={sorting}
                onSortingChange={handleSortingChange}
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
