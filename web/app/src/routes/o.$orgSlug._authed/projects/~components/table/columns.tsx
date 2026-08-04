import type { trpc } from "@/utils/trpc";
import { Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { ExternalLinkIcon, Clock } from "lucide-react";
import { RunStatusBadge } from "@/components/core/runs/run-status-badge";
import { DeleteProjectButton } from "../delete-project-button";
import { SortableHeader } from "./sortable-header";

type Project = inferOutput<typeof trpc.projects.list>["projects"][0];

export const columns = ({
  orgSlug,
  organizationId,
  canDelete,
}: {
  orgSlug: string;
  organizationId: string;
  /** Only owners/admins may delete projects; hides the actions column otherwise. */
  canDelete: boolean;
}): ColumnDef<Project>[] => [
  {
    // Column ids are the sort keys the server understands — see
    // PROJECT_SORT_FIELDS in web/server/lib/project-list-query.ts.
    id: "name",
    accessorKey: "name",
    // First click sorts A→Z for text, newest-first for dates. Set explicitly:
    // TanStack otherwise infers the direction from the first row's value, which
    // is undefined for the columns below that render from `runs` without an
    // accessor — and undefined infers as descending.
    sortDescFirst: false,
    header: ({ column }) => <SortableHeader column={column} label="Name" />,
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
            <span
              data-testid="project-name"
              className="max-w-[200px] truncate text-sm font-medium group-hover:underline sm:max-w-[300px]"
            >
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
    id: "tags",
    accessorKey: "tags",
    sortDescFirst: false,
    header: ({ column }) => <SortableHeader column={column} label="Tags" />,
    cell: ({ row }) => {
      return <div>{row.original.tags.join(", ")}</div>;
    },
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    sortDescFirst: true,
    header: ({ column }) => (
      <SortableHeader column={column} label="Created At" />
    ),
    cell: ({ row }) => {
      return <div>{row.original.createdAt.toLocaleString()}</div>;
    },
  },
  {
    id: "lastRunAt",
    // TanStack only treats a column as sortable when it has an accessor, so
    // these three read the latest run rather than rendering from `row.original`
    // alone. The value itself isn't used for ordering — the server sorts.
    accessorFn: (project) => project.runs[0]?.updatedAt ?? null,
    sortDescFirst: true,
    header: ({ column }) => (
      <SortableHeader column={column} label="Last Run At" />
    ),
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
    id: "lastRunName",
    accessorFn: (project) => project.runs[0]?.name ?? null,
    sortDescFirst: false,
    header: ({ column }) => <SortableHeader column={column} label="Last Run" />,
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
    id: "lastRunStatus",
    accessorFn: (project) => project.runs[0]?.status ?? null,
    sortDescFirst: false,
    header: ({ column }) => (
      <SortableHeader column={column} label="Latest Run Status" />
    ),
    cell: ({ row }) => {
      const lastRun = row.original.runs[0];
      if (!lastRun) return null;

      return <RunStatusBadge run={lastRun} />;
    },
  },
  ...(canDelete
    ? ([
        {
          id: "actions",
          header: "",
          enableSorting: false,
          cell: ({ row }) => (
            <div className="flex justify-end">
              <DeleteProjectButton
                organizationId={organizationId}
                projectName={row.original.name}
                runCount={row.original.runCount}
              />
            </div>
          ),
        },
      ] satisfies ColumnDef<Project>[])
    : []),
];
