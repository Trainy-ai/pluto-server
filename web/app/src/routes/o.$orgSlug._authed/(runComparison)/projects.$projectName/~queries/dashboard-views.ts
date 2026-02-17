import { trpc } from "@/utils/trpc";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";

// Type definitions
export type ListViewsResponse = inferOutput<typeof trpc.dashboardViews.list>;
export type DashboardView = ListViewsResponse["views"][number];
export type GetViewResponse = inferOutput<typeof trpc.dashboardViews.get>;
export type CreateViewResponse = inferOutput<typeof trpc.dashboardViews.create>;
export type UpdateViewResponse = inferOutput<typeof trpc.dashboardViews.update>;

// Hook to list all dashboard views for a project
export const useDashboardViews = (organizationId: string, projectName: string) => {
  return useQuery(
    trpc.dashboardViews.list.queryOptions(
      {
        organizationId,
        projectName,
      },
      {
        placeholderData: (prev) => prev,
      },
    )
  );
};

// Hook to get a single dashboard view
export const useDashboardView = (organizationId: string, viewId: string | null) => {
  return useQuery({
    ...trpc.dashboardViews.get.queryOptions({
      organizationId,
      viewId: viewId ?? "",
    }),
    enabled: !!viewId,
    placeholderData: (prev) => prev,
  });
};

// Hook to create a new dashboard view
export const useCreateDashboardView = (organizationId: string, projectName: string) => {
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
export const useUpdateDashboardView = (organizationId: string, projectName: string) => {
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
      if (data && typeof data === 'object' && 'id' in data) {
        queryClient.setQueryData(
          trpc.dashboardViews.get.queryOptions({
            organizationId,
            viewId: (data as { id: string }).id,
          }).queryKey,
          { ...data, projectName }
        );
      }
    },
  });
};

// Hook to delete a dashboard view
export const useDeleteDashboardView = (organizationId: string, projectName: string) => {
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
