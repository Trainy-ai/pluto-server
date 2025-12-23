import type { trpc } from "@/utils/trpc";
import { Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { ExternalLinkIcon, Clock } from "lucide-react";
import { RunStatusBadge } from "@/components/core/runs/run-status-badge";

type Project = inferOutput<typeof trpc.projects.list>["projects"][0];

export const columns = ({
  orgSlug,
}: {
  orgSlug: string;
}): ColumnDef<Project>[] => [
  {
    header: "Name",
    accessorKey: "name",
    cell: ({ row }) => {
      return (
        <Link
          to={`/o/$orgSlug/projects/$projectName`}
          preload="intent"
          className="group flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-accent/50"
          params={{
            orgSlug,
            projectName: row.original.name,
          }}
        >
          <div className="flex items-center gap-2">
            <span className="max-w-[200px] truncate text-sm font-medium group-hover:underline sm:max-w-[300px]">
              {row.original.name}
            </span>
            <span className="text-xs text-muted-foreground">
              {row.original.runCount} runs
            </span>
          </div>
        </Link>
      );
    },
  },
  {
    header: "Tags",
    accessorKey: "tags",
    cell: ({ row }) => {
      return <div>{row.original.tags.join(", ")}</div>;
    },
  },
  {
    header: "Created At",
    accessorKey: "createdAt",
    cell: ({ row }) => {
      return <div>{row.original.createdAt.toLocaleString()}</div>;
    },
  },
  {
    header: "Last Run At",
    accessorKey: "lastRunAts",
    cell: ({ row }) => {
      const lastRun = row.original.runs[0];
      if (!lastRun) return null;

      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="size-4" />
          <span className="max-w-[150px] truncate sm:max-w-[200px]">
            {lastRun.updatedAt.toLocaleString()}
          </span>
        </div>
      );
    },
  },
  {
    header: "Last Run",
    accessorKey: "runs",
    cell: ({ row }) => {
      const lastRun = row.original.runs[0];
      if (!lastRun) return null;

      return (
        <Link
          to={`/o/$orgSlug/projects/$projectName/$runId`}
          preload="intent"
          params={{
            orgSlug,
            projectName: row.original.name,
            runId: lastRun.id,
          }}
          className="group flex flex-row items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-accent/50"
        >
          <span className="max-w-[150px] truncate text-sm group-hover:underline sm:max-w-[250px]">
            {lastRun.name}
          </span>
          <ExternalLinkIcon className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      );
    },
  },
  {
    header: "Latest Run Status",
    accessorKey: "status",
    cell: ({ row }) => {
      const lastRun = row.original.runs[0];
      if (!lastRun) return null;

      return <RunStatusBadge run={lastRun} />;
    },
  },
];
