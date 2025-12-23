import { Link } from "@tanstack/react-router";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";
import { RunStatusBadge } from "@/components/core/runs/run-status-badge";
import { useDuration } from "@/lib/hooks/use-duration";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { trpc } from "@/utils/trpc";

type Run = inferOutput<typeof trpc.runs.latest>[0];

interface RunCardProps {
  run: Run;
  orgSlug: string;
}

export function RunCard({ run, orgSlug }: RunCardProps) {
  const { formattedDuration } = useDuration({
    startTime: run.createdAt,
    endTime: run.updatedAt,
    runStatus: run.status,
  });

  return (
    <Card className="group relative overflow-hidden transition-all hover:shadow-md">
      <CardHeader className="space-y-3 p-4 sm:p-6">
        <div className="flex flex-col space-y-1.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex flex-wrap items-center gap-x-1 font-mono text-sm font-semibold sm:text-base">
              <Link
                to={`/o/$orgSlug/projects/$projectName`}
                params={{
                  orgSlug,
                  projectName: run.project.name,
                }}
                preload="intent"
                className="max-w-[120px] truncate text-muted-foreground hover:underline sm:max-w-none"
              >
                {run.project.name}
              </Link>
              <span className="text-muted-foreground">/</span>
              <Link
                to={`/o/$orgSlug/projects/$projectName/$runId`}
                params={{
                  orgSlug,
                  projectName: run.project.name,
                  runId: run.id,
                }}
                preload="intent"
                className="max-w-[120px] truncate hover:underline sm:max-w-none"
              >
                {run.name}
              </Link>
            </CardTitle>
            <RunStatusBadge run={run} />
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:text-sm">
            <span className="truncate">
              Created {new Date(run.createdAt).toLocaleString()}
            </span>
            <span>•</span>
            <span>{formattedDuration}</span>
          </div>
        </div>
        <div className="flex items-center justify-end">
          <Link
            to={`/o/$orgSlug/projects/$projectName/$runId`}
            params={{
              orgSlug,
              projectName: run.project.name,
              runId: run.id,
            }}
            className="flex items-center gap-1 text-xs text-primary transition-colors hover:text-primary/80 sm:text-sm"
          >
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 sm:h-4 sm:w-4" />
            View Details
          </Link>
        </div>
      </CardHeader>
    </Card>
  );
}
