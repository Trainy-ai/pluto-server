import { trpc } from "@/utils/trpc";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";

// Type definitions
export type ListRunTableViewsResponse = inferOutput<typeof trpc.runTableViews.list>;
export type RunTableView = ListRunTableViewsResponse["views"][number];
export type GetRunTableViewResponse = inferOutput<typeof trpc.runTableViews.get>;
export type CreateRunTableViewResponse = inferOutput<typeof trpc.runTableViews.create>;
export type UpdateRunTableViewResponse = inferOutput<typeof trpc.runTableViews.update>;

// Hook to list all run table views for a project
export const useRunTableViews = (organizationId: string, projectName: string) => {
  return useQuery(
    trpc.runTableViews.list.queryOptions({
      organizationId,
      projectName,
    })
  );
};

// Hook to get a single run table view
export const useRunTableView = (organizationId: string, viewId: string | null) => {
  return useQuery({
    ...trpc.runTableViews.get.queryOptions({
      organizationId,
      viewId: viewId ?? "",
    }),
    enabled: !!viewId,
  });
};

// Hook to create a new run table view
export const useCreateRunTableView = (organizationId: string, projectName: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.runTableViews.create.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: trpc.runTableViews.list.queryOptions({
          organizationId,
          projectName,
        }).queryKey,
      });
    },
  });
};

// Hook to update a run table view
export const useUpdateRunTableView = (organizationId: string, projectName: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.runTableViews.update.mutationOptions(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: trpc.runTableViews.list.queryOptions({
          organizationId,
          projectName,
        }).queryKey,
      });
      if (data && typeof data === 'object' && 'id' in data) {
        queryClient.setQueryData(
          trpc.runTableViews.get.queryOptions({
            organizationId,
            viewId: (data as { id: string }).id,
          }).queryKey,
          { ...data, projectName }
        );
      }
    },
  });
};

// Hook to delete a run table view
export const useDeleteRunTableView = (organizationId: string, projectName: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.runTableViews.delete.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: trpc.runTableViews.list.queryOptions({
          organizationId,
          projectName,
        }).queryKey,
      });
    },
  });
};
