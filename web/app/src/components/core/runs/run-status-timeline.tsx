import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, History } from "lucide-react";
import { JsonViewer } from "@/components/ui/json-tree-viewer";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";

type StatusLabel =
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "TERMINATED"
  | "CANCELLED";

const STATUS_STYLES: Record<StatusLabel, { dot: string; badge: string }> = {
  RUNNING: {
    dot: "bg-blue-500",
    badge:
      "bg-blue-500/20 text-blue-800 dark:bg-blue-500/30 dark:text-blue-300",
  },
  COMPLETED: {
    dot: "bg-emerald-500",
    badge:
      "bg-emerald-500/20 text-emerald-800 dark:bg-emerald-500/30 dark:text-emerald-300",
  },
  FAILED: {
    dot: "bg-red-500",
    badge: "bg-red-500/20 text-red-800 dark:bg-red-500/30 dark:text-red-300",
  },
  TERMINATED: {
    dot: "bg-red-500",
    badge: "bg-red-500/20 text-red-800 dark:bg-red-500/30 dark:text-red-300",
  },
  CANCELLED: {
    dot: "bg-amber-500",
    badge:
      "bg-amber-500/20 text-amber-800 dark:bg-amber-500/30 dark:text-amber-300",
  },
};

const SOURCE_STYLES: Record<string, { label: string; className: string }> = {
  api: {
    label: "api",
    className: "bg-slate-500/20 text-slate-800 dark:bg-slate-500/30 dark:text-slate-300",
  },
  resume: {
    label: "resume",
    className: "bg-purple-500/20 text-purple-800 dark:bg-purple-500/30 dark:text-purple-300",
  },
  "stale-monitor": {
    label: "stale",
    className: "bg-amber-500/20 text-amber-800 dark:bg-amber-500/30 dark:text-amber-300",
  },
  "threshold-trigger": {
    label: "threshold",
    className: "bg-orange-500/20 text-orange-800 dark:bg-orange-500/30 dark:text-orange-300",
  },
};

interface RunStatusTimelineProps {
  organizationId: string;
  runId: string;
  projectName: string;
}

export function RunStatusTimeline({
  organizationId,
  runId,
  projectName,
}: RunStatusTimelineProps) {
  const { data, isLoading, error } = useQuery(
    trpc.runs.statusHistory.queryOptions({
      organizationId,
      runId,
      projectName,
    }),
  );

  if (isLoading) {
    return null;
  }

  if (error || !data || data.length === 0) {
    return null;
  }

  return (
    <Card
      data-testid="run-status-timeline"
      className="overflow-hidden border-l-4 border-l-blue-500"
    >
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-blue-500" />
          <div className="space-y-1">
            <CardTitle className="text-xl">Status History</CardTitle>
            <p className="text-sm text-muted-foreground">
              Every recorded status transition for this run
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ol className="relative space-y-4 border-l border-border pl-6">
          {data.map((event, i) => (
            <TimelineEntry key={event.id} event={event} isLast={i === data.length - 1} />
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

interface TimelineEvent {
  id: string;
  runId: string;
  fromStatus: StatusLabel | null;
  toStatus: StatusLabel;
  source: string;
  metadata: unknown;
  createdAt: string;
  actor: { id: string; name: string; email: string; image: string | null } | null;
  apiKey: { id: string; name: string } | null;
}

function TimelineEntry({
  event,
  isLast: _isLast,
}: {
  event: TimelineEvent;
  isLast: boolean;
}) {
  const styles = STATUS_STYLES[event.toStatus];
  const sourceStyle = SOURCE_STYLES[event.source] ?? {
    label: event.source,
    className: "bg-slate-500/20 text-slate-800 dark:bg-slate-500/30 dark:text-slate-300",
  };
  const hasMetadata =
    event.metadata !== null &&
    event.metadata !== undefined &&
    typeof event.metadata === "object";

  return (
    <li
      data-testid="run-status-timeline-entry"
      className="relative"
    >
      <span
        className={`absolute -left-[1.95rem] top-1.5 flex h-3 w-3 items-center justify-center rounded-full ring-2 ring-background ${styles.dot}`}
        aria-hidden
      >
        {event.toStatus === "RUNNING" && (
          <Activity className="h-2 w-2 text-white" />
        )}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {event.fromStatus && (
          <>
            <Badge
              variant="secondary"
              className={`font-medium text-xs ${STATUS_STYLES[event.fromStatus].badge}`}
            >
              {event.fromStatus}
            </Badge>
            <span className="text-muted-foreground text-xs">→</span>
          </>
        )}
        <Badge
          variant="secondary"
          className={`font-medium text-xs ${styles.badge}`}
        >
          {event.toStatus}
        </Badge>
        <Badge
          variant="outline"
          className={`font-medium text-xs ${sourceStyle.className}`}
          title={`Source: ${event.source}`}
        >
          {sourceStyle.label}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {new Date(event.createdAt).toLocaleString()}
        </span>
        {event.actor && (
          <span className="text-xs text-muted-foreground">
            · {event.actor.name || event.actor.email}
          </span>
        )}
        {event.apiKey && !event.actor && (
          <span className="text-xs text-muted-foreground">
            · {event.apiKey.name}
          </span>
        )}
      </div>
      {hasMetadata && (
        <Collapsible>
          <CollapsibleTrigger className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDown className="h-3 w-3 transition-transform data-[state=open]:rotate-180" />
            metadata
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1">
            <div className="rounded bg-muted/50 p-2 text-xs">
              <JsonViewer
                data={event.metadata as Record<string, unknown>}
                rootName=""
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </li>
  );
}
