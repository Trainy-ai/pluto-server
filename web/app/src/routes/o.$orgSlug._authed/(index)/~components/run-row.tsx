import { Link, useNavigate } from "@tanstack/react-router";
import { TableCell, TableRow } from "@/components/ui/table";
import { RunStatusBadge } from "@/components/core/runs/run-status-badge";
import { useDuration } from "@/lib/hooks/use-duration";
import { formatRelativeTime } from "@/lib/format-relative-time";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { trpc } from "@/utils/trpc";
import { cn } from "@/lib/utils";

type Run = inferOutput<typeof trpc.runs.latest>[0];

interface RunRowProps {
  run: Run;
  orgSlug: string;
}

const statusDotClass: Record<Run["status"], string> = {
  COMPLETED: "bg-emerald-500",
  FAILED: "bg-red-500",
  TERMINATED: "bg-red-500",
  CANCELLED: "bg-red-500",
  RUNNING: "bg-blue-500 animate-pulse",
};

export function RunRow({ run, orgSlug }: RunRowProps) {
  const navigate = useNavigate();
  const { formattedDuration } = useDuration({
    startTime: run.createdAt,
    endTime: run.updatedAt,
    runStatus: run.status,
  });

  const displayId =
    run.number != null && run.project.runPrefix
      ? `${run.project.runPrefix}-${run.number}`
      : null;

  const runId = displayId ?? run.id;

  return (
    <TableRow
      className="group cursor-pointer"
      onClick={(e) => {
        // Don't navigate if user clicked on an existing link
        if ((e.target as HTMLElement).closest("a")) {
          return;
        }
        navigate({
          to: `/o/$orgSlug/projects/$projectName/$runId`,
          params: {
            orgSlug,
            projectName: run.project.name,
            runId,
          },
        });
      }}
    >
      {/* Status dot */}
      <TableCell className="w-10 pr-0">
        <div
          className={cn("h-2.5 w-2.5 rounded-full", statusDotClass[run.status])}
        />
      </TableCell>

      {/* Project / Run name */}
      <TableCell className="max-w-[300px]">
        <div className="flex items-center gap-1 font-mono text-sm">
          <Link
            to={`/o/$orgSlug/projects/$projectName`}
            params={{ orgSlug, projectName: run.project.name }}
            preload="intent"
            className="truncate text-muted-foreground hover:text-foreground hover:underline"
          >
            {run.project.name}
          </Link>
          <span className="text-muted-foreground/60">/</span>
          <Link
            to={`/o/$orgSlug/projects/$projectName/$runId`}
            params={{
              orgSlug,
              projectName: run.project.name,
              runId,
            }}
            preload="intent"
            className="truncate font-medium hover:underline"
          >
            {run.name}
          </Link>
          {displayId && (
            <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
              {displayId}
            </span>
          )}
        </div>
      </TableCell>

      {/* Status badge */}
      <TableCell>
        <RunStatusBadge run={run} />
      </TableCell>

      {/* Duration */}
      <TableCell className="text-muted-foreground text-sm tabular-nums">
        {formattedDuration}
      </TableCell>

      {/* Created */}
      <TableCell
        className="text-muted-foreground text-sm"
        title={new Date(run.createdAt).toLocaleString()}
      >
        {formatRelativeTime(new Date(run.createdAt))}
      </TableCell>

      {/* Tags */}
      <TableCell className="max-w-[200px]">
        {run.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {run.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
              >
                {tag}
              </span>
            ))}
            {run.tags.length > 3 && (
              <span className="text-[11px] text-muted-foreground">
                +{run.tags.length - 3}
              </span>
            )}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
