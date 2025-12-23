import { queryClient } from "@/utils/trpc";

export const refreshAllData = async () => {
  await Promise.all([
    // Invalidate and refetch main run data
    queryClient.invalidateQueries({
      predicate: (query) => {
        const firstEntry = query.queryKey[0] as string | string[];
        return firstEntry?.[0] === "runs";
      },
    }),
  ]);
};
