import { trpc, trpcClient } from "@/utils/trpc";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";

// Type definitions
export type ListViewsResponse = inferOutput<typeof trpc.dashboardViews.list>;
export type DashboardView = ListViewsResponse["views"][number];
export type GetViewResponse = inferOutput<typeof trpc.dashboardViews.get>;
export type CreateViewResponse = inferOutput<typeof trpc.dashboardViews.create>;
export type UpdateViewResponse = inferOutput<typeof trpc.dashboardViews.update>;
export type ListDashboardVersionsResponse = inferOutput<
  typeof trpc.dashboardViews.listVersions
>;
export type DashboardVersion =
  ListDashboardVersionsResponse["versions"][number];
export type GetDashboardVersionResponse = inferOutput<
  typeof trpc.dashboardViews.getVersion
>;
export type RestoreDashboardVersionResponse = inferOutput<
  typeof trpc.dashboardViews.restoreVersion
>;

// Hook to list all dashboard views for a project
export const useDashboardViews = (
  organizationId: string,
  projectName: string,
) => {
  return useQuery(
    trpc.dashboardViews.list.queryOptions(
      {
        organizationId,
        projectName,
      },
      {
        placeholderData: (prev) => prev,
      },
    ),
  );
};
// Hook to get a single dashboard view
export const useDashboardView = (
  organizationId: string,
  viewId: string | null,
) => {
  return useQuery({
    ...trpc.dashboardViews.get.queryOptions({
      organizationId,
      viewId: viewId ?? "",
    }),
    enabled: !!viewId,
    placeholderData: (prev) => prev,
  });
};

export const useDashboardVersions = (
  organizationId: string,
  viewId: string | null,
) => {
  const input = {
    organizationId,
    viewId: viewId ?? "",
    limit: 50,
  };
  const queryOptions = trpc.dashboardViews.listVersions.queryOptions(input);

  return useInfiniteQuery({
    queryKey: [...queryOptions.queryKey, "infinite"],
    queryFn: ({ pageParam }) =>
      trpcClient.dashboardViews.listVersions.query({
        ...input,
        beforeVersion: pageParam,
      }),
    enabled: !!viewId,
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
};

export const useDashboardVersion = (
  organizationId: string,
  viewId: string | null,
  version: number | null,
) => {
  return useQuery({
    ...trpc.dashboardViews.getVersion.queryOptions({
      organizationId,
      viewId: viewId ?? "",
      version: version ?? 1,
    }),
    enabled: !!viewId && version !== null,
    staleTime: Infinity,
  });
};

// Hook to create a new dashboard view
export const useCreateDashboardView = (
  organizationId: string,
  projectName: string,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.dashboardViews.create.mutationOptions(),
    onSuccess: () => {
      // Invalidate the list query to refetch
      queryClient.invalidateQueries({
        queryKey: trpc.dashboardViews.list.queryOptions({
          organizationId,
          projectName,
        }).queryKey,
      });
    },
  });
};

// Hook to update a dashboard view
export const useUpdateDashboardView = (
  organizationId: string,
  projectName: string,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.dashboardViews.update.mutationOptions(),
    onSuccess: (data) => {
      // Invalidate the list query
      queryClient.invalidateQueries({
        queryKey: trpc.dashboardViews.list.queryOptions({
          organizationId,
          projectName,
        }).queryKey,
      });
      // Update the specific view in cache if it was fetched individually
      if (data && typeof data === "object" && "id" in data) {
        const viewId = (data as { id: string }).id;
        queryClient.setQueryData(
          trpc.dashboardViews.get.queryOptions({
            organizationId,
            viewId,
          }).queryKey,
          { ...data, projectName },
        );
        void queryClient.invalidateQueries({
          queryKey: trpc.dashboardViews.listVersions.queryOptions({
            organizationId,
            viewId,
            limit: 50,
          }).queryKey,
        });
      }
    },
  });
};

export const useRestoreDashboardVersion = (
  organizationId: string,
  projectName: string,
  viewId: string,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.dashboardViews.restoreVersion.mutationOptions(),
    onSuccess: (data) => {
      queryClient.setQueryData(
        trpc.dashboardViews.get.queryOptions({ organizationId, viewId })
          .queryKey,
        { ...data, projectName },
      );
      queryClient.setQueryData<ListViewsResponse | undefined>(
        trpc.dashboardViews.list.queryOptions({
          organizationId,
          projectName,
        }).queryKey,
        (current) =>
          current
            ? {
                ...current,
                views: current.views.map((candidate) =>
                  candidate.id === viewId
                    ? { ...candidate, ...data }
                    : candidate,
                ),
              }
            : current,
      );

      void queryClient.invalidateQueries({
        queryKey: trpc.dashboardViews.list.queryOptions({
          organizationId,
          projectName,
        }).queryKey,
      });
      void queryClient.invalidateQueries({
        queryKey: trpc.dashboardViews.get.queryOptions({
          organizationId,
          viewId,
        }).queryKey,
      });
      void queryClient.invalidateQueries({
        queryKey: trpc.dashboardViews.listVersions.queryOptions({
          organizationId,
          viewId,
          limit: 50,
        }).queryKey,
      });
    },
  });
};

// Hook to poll for dashboard staleness while editing
export const useDashboardStalenessCheck = (
  organizationId: string,
  viewId: string | null,
  enabled: boolean,
) => {
  return useQuery({
    ...trpc.dashboardViews.get.queryOptions({
      organizationId,
      viewId: viewId ?? "",
    }),
    enabled: !!viewId && enabled,
    refetchInterval: 30_000, // Poll every 30 seconds
    refetchIntervalInBackground: false,
  });
};

// Hook to delete a dashboard view
export const useDeleteDashboardView = (
  organizationId: string,
  projectName: string,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.dashboardViews.delete.mutationOptions(),
    onSuccess: () => {
      // Invalidate the list query
      queryClient.invalidateQueries({
        queryKey: trpc.dashboardViews.list.queryOptions({
          organizationId,
          projectName,
        }).queryKey,
      });
    },
  });
};
