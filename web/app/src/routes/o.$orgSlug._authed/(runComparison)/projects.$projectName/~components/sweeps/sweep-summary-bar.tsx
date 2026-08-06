import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Mirrors the server's `SweepState`; keyed so every lookup is total. */
export type SweepState = "RUNNING" | "FINISHED" | "INCOMPLETE";

export const SWEEP_STATE_LABEL: Record<
  SweepState,
  { label: string; hint: string }
> = {
  RUNNING: { label: "running", hint: "A run in this sweep is currently running." },
  // "incomplete" was ambiguous — in plain English it suggests "still going",
  // which is the opposite of what this means. The sweep is not running and did
  // not cover its grid.
  INCOMPLETE: {
    label: "stopped early",
    hint: "Nothing is running, and the declared grid has fewer completed runs than combinations — either the agent stopped partway or some runs failed. The results it did produce are fine, but the best run here is the best of a fragment, not of the whole space.",
  },
  FINISHED: { label: "finished", hint: "No run is currently running." },
};

/**
 * Badge appearance per sweep state.
 *
 * `incomplete` is amber, not red: the sweep stopped before covering its grid,
 * which is worth noticing but is not a failure — the runs it did produce are
 * fine. Red belongs to things that broke. `running` reuses the pulsing
 * `loading` variant so a live sweep reads as in-motion at a glance.
 */
export function sweepStateBadgeProps(state: SweepState): {
  variant: "loading" | "secondary" | "outline";
  className?: string;
} {
  if (state === "RUNNING") {
    return { variant: "loading" };
  }
  if (state === "INCOMPLETE") {
    return {
      variant: "outline",
      className: "border-amber-500/50 text-amber-600 dark:text-amber-400",
    };
  }
  return { variant: "secondary" };
}

interface SweepSummaryBarProps {
  state: SweepState;
  statuses: {
    total: number;
    running: number;
    completed: number;
    failed: number;
    other: number;
  };
  /** Total grid configurations, when the space is finite. */
  gridTotal: number | null;
  projectName: string;
  orgSlug: string;
  /** Display ids of the sweep's runs, for the charts deep-link. */
  runRefs: string[];
}

/**
 * State, outcome counts, grid progress, and the way through to the curves.
 *
 * The link matters as much as the counts: this page shows each run's *final*
 * metric, which says which configuration won but nothing about how any of them
 * got there. The training curves live on the Charts tab, and until now nothing
 * connected a sweep to them — `?runs=` scopes that page to exactly these runs.
 */
export function SweepSummaryBar({
  state,
  statuses,
  gridTotal,
  projectName,
  orgSlug,
  runRefs,
}: SweepSummaryBarProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border px-4 py-2.5 text-xs"
      data-testid="sweep-summary-bar"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge {...sweepStateBadgeProps(state)} data-testid="sweep-state">
            {SWEEP_STATE_LABEL[state].label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          {SWEEP_STATE_LABEL[state].hint}
        </TooltipContent>
      </Tooltip>

      <span className="text-muted-foreground" data-testid="sweep-status-counts">
        <Count n={statuses.completed} label="completed" tone="text-emerald-500" />
        {statuses.running > 0 && (
          <Count n={statuses.running} label="running" tone="text-sky-500" />
        )}
        {statuses.failed > 0 && (
          <Count n={statuses.failed} label="failed" tone="text-rose-500" />
        )}
        {statuses.other > 0 && <Count n={statuses.other} label="other" />}
      </span>

      {/* Only grid sweeps have a denominator — random and bayes run until
          stopped, so "3 of 12" would be inventing one. Completed rather than
          attempted, matching how the state above is derived: a combination
          whose run crashed left the same hole as one never attempted. */}
      {gridTotal != null && (
        <span className="text-muted-foreground" data-testid="sweep-grid-progress">
          <span className="font-medium text-foreground">
            {statuses.completed} of {gridTotal}
          </span>{" "}
          grid configurations
        </span>
      )}

      <Link
        to="/o/$orgSlug/projects/$projectName"
        params={{ orgSlug, projectName }}
        search={{ runs: runRefs.join(",") }}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "ml-auto h-7 gap-1.5 text-xs")}
        data-testid="sweep-charts-link"
      >
        <ExternalLink className="h-3 w-3" />
        View curves in Charts
      </Link>
    </div>
  );
}

function Count({ n, label, tone }: { n: number; label: string; tone?: string }) {
  return (
    <span className="mr-3">
      <span className={cn("font-medium", tone ?? "text-foreground")}>{n}</span> {label}
    </span>
  );
}
