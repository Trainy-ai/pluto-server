import { trpc, trpcClient } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import type { DateFilterParam, FieldFilterParam, MetricFilterParam, SystemFilterParam } from "@/lib/run-filters";

export const useRunCount = (
  orgId: string,
  projectName: string,
  tags?: string[],
  status?: string[],
  search?: string,
  dateFilters?: DateFilterParam[],
  fieldFilters?: FieldFilterParam[],
  metricFilters?: MetricFilterParam[],
  systemFilters?: SystemFilterParam[],
) => {
  return useQuery<number>({
    placeholderData: (prev) => prev,
    queryKey: trpc.runs.count.queryKey({
      organizationId: orgId,
      projectName,
      tags: tags && tags.length > 0 ? tags : undefined,
      status: status && status.length > 0 ? status as ("RUNNING" | "COMPLETED" | "FAILED" | "TERMINATED" | "CANCELLED")[] : undefined,
      search: search && search.trim() ? search.trim() : undefined,
      dateFilters: dateFilters && dateFilters.length > 0 ? dateFilters : undefined,
      fieldFilters: fieldFilters && fieldFilters.length > 0 ? fieldFilters : undefined,
      metricFilters: metricFilters && metricFilters.length > 0 ? metricFilters : undefined,
      systemFilters: systemFilters && systemFilters.length > 0 ? systemFilters : undefined,
    }),
    queryFn: () =>
      trpcClient.runs.count.query({
        organizationId: orgId,
        projectName,
        tags: tags && tags.length > 0 ? tags : undefined,
        status: status && status.length > 0 ? status as ("RUNNING" | "COMPLETED" | "FAILED" | "TERMINATED" | "CANCELLED")[] : undefined,
        search: search && search.trim() ? search.trim() : undefined,
        dateFilters: dateFilters && dateFilters.length > 0 ? dateFilters : undefined,
        fieldFilters: fieldFilters && fieldFilters.length > 0 ? fieldFilters : undefined,
        metricFilters: metricFilters && metricFilters.length > 0 ? metricFilters : undefined,
        systemFilters: systemFilters && systemFilters.length > 0 ? systemFilters : undefined,
      }),
  });
};
