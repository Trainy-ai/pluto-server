import { RunRow } from "./run-row";
import { RefreshButton } from "@/components/core/refresh-button";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { trpc } from "@/utils/trpc";
import { queryClient } from "@/utils/trpc";
import { useState } from "react";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Run = inferOutput<typeof trpc.runs.latest>[0];

interface RecentRunsProps {
  runs: Run[];
  orgSlug: string;
  orgId: string;
}

export function RecentRuns({ runs, orgSlug, orgId }: RecentRunsProps) {
  const [lastRefreshed, setLastRefreshed] = useState<Date | undefined>(
    undefined,
  );

  const refreshData = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["runs", "latest", orgId],
      refetchType: "all",
    });
    setLastRefreshed(new Date());
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Recent Runs
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {runs.length} most recent experiment runs across all projects
          </p>
        </div>
        <RefreshButton
          onRefresh={refreshData}
          lastRefreshed={lastRefreshed}
          refreshInterval={10_000}
          defaultAutoRefresh={false}
        />
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10" />
              <TableHead>Run</TableHead>
              <TableHead className="w-[110px]">Status</TableHead>
              <TableHead className="w-[100px]">Duration</TableHead>
              <TableHead className="w-[140px]">Created</TableHead>
              <TableHead className="w-[200px]">Tags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run: Run) => (
              <RunRow key={run.id} run={run} orgSlug={orgSlug} />
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
