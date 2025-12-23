import { RunCard } from "./run-card";
import { RefreshButton } from "@/components/core/refresh-button";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { trpc } from "@/utils/trpc";
import { queryClient } from "@/utils/trpc";
import { useState } from "react";

type Run = inferOutput<typeof trpc.runs.latest>[0];

interface RecentRunsProps {
  runs: Run[];
  orgSlug: string;
}

export function RecentRuns({ runs, orgSlug }: RecentRunsProps) {
  const [lastRefreshed, setLastRefreshed] = useState<Date | undefined>(
    undefined,
  );

  const refreshData = async () => {
    await queryClient.invalidateQueries({
      queryKey: trpc.runs.latest.queryKey(),
      refetchType: "all",
    });
    setLastRefreshed(new Date());
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Recent Runs
          </h1>
          <p className="mt-2 text-muted-foreground">
            Your most recent experiment runs
          </p>
        </div>
        <RefreshButton
          onRefresh={refreshData}
          lastRefreshed={lastRefreshed}
          refreshInterval={10_000}
          defaultAutoRefresh={false}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {runs.map((run: Run) => (
          <RunCard key={run.id} run={run} orgSlug={orgSlug} />
        ))}
      </div>
    </section>
  );
}
