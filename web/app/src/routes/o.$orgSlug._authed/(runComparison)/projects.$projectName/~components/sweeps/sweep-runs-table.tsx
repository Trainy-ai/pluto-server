import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ExternalLink, ArrowDown, ArrowUp } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface SweepRunsTableProps {
  runs: {
    runId: string;
    name: string;
    displayId: string | null;
    status: string;
    config: Record<string, unknown>;
    metricValue: number | null;
    wandbUrl?: string | null;
  }[];
  sweptKeys: string[];
  metricName: string | null;
  /**
   * The sweep's objective direction. Needed for the default sort: "best first"
   * is ascending metric for a minimising sweep and descending for a maximising
   * one, and without it a maximise sweep opened with its *worst* run on top
   * while the green "best" badge sat somewhere further down.
   */
  goal: string;
  projectName: string;
  orgSlug: string;
  /** Run id to highlight — the sweep's best run. */
  bestRunId?: string;
  /**
   * Runs matching the chart's brush. Non-matching rows are dimmed rather than
   * removed: filtering them out emptied the table the instant a drag began
   * (a one-pixel brush matches nothing), which read as the UI flashing.
   */
  highlightRunIds?: string[] | null;
}

/**
 * The sweep's runs, one column per swept hyperparameter plus the objective.
 *
 * Deliberately not the main runs table: that one carries selection, grouping,
 * column presets and server-side sort for a whole project, none of which apply
 * to a handful of runs already grouped by definition. What matters here is
 * seeing the knobs beside the result, which is a different table.
 */
export function SweepRunsTable({
  runs,
  sweptKeys,
  metricName,
  goal,
  projectName,
  orgSlug,
  bestRunId,
  highlightRunIds,
}: SweepRunsTableProps) {
  // Default order is the objective, best first — the question this table is
  // usually opened to answer. Creation order is a click away via the Run column.
  const [sortKey, setSortKey] = useState<string>("__metric");
  const [ascending, setAscending] = useState(goal !== "maximize");
  const [onlyFinished, setOnlyFinished] = useState(false);

  // Goal can flip via the page controls without remounting this table. Keep
  // metric sort on "best first" when that happens; leave other columns alone.
  useEffect(() => {
    if (sortKey === "__metric") {
      setAscending(goal !== "maximize");
    }
  }, [goal, sortKey]);

  // O(1) per row. `highlightRunIds.includes()` was called twice per row, so a
  // brush drag — which reruns this render every animation frame — was scanning
  // the id list 2n times for an n-row table.
  const highlighted = useMemo(
    () => (highlightRunIds ? new Set(highlightRunIds) : null),
    [highlightRunIds],
  );

  const rows = useMemo(() => {
    const filtered = onlyFinished
      ? runs.filter((run) => run.status === "COMPLETED")
      : runs;

    const value = (run: (typeof runs)[number]) =>
      sortKey === "__metric"
        ? run.metricValue
        : sortKey === "__name"
          ? run.name
          : sortKey === "__status"
            ? run.status
            : (run.config[sortKey] as number | string | undefined);

    return [...filtered].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      // Runs missing the sort value sink to the bottom either way: they carry
      // no answer to the question being sorted on.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return ascending ? cmp : -cmp;
    });
  }, [runs, sortKey, ascending, onlyFinished]);

  const toggle = (key: string) => {
    if (key === sortKey) {
      setAscending((prev) => !prev);
    } else {
      setSortKey(key);
      // Metric column defaults to best-first for the current goal; other
      // columns start ascending (A→Z / low→high).
      setAscending(key === "__metric" ? goal !== "maximize" : true);
    }
  };

  const failedCount = runs.filter((run) => run.status !== "COMPLETED").length;

  return (
    <div className="overflow-hidden rounded-lg border" data-testid="sweep-runs-table">
      {failedCount > 0 && (
        <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={onlyFinished}
              onChange={(e) => setOnlyFinished(e.target.checked)}
              data-testid="sweep-only-finished"
            />
            Hide {failedCount} unfinished
          </label>
        </div>
      )}
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <Th label="Run" sortKey="__name" active={sortKey} asc={ascending} onSort={toggle} align="left" />
            {sweptKeys.map((key) => (
              <Th key={key} label={key} sortKey={key} active={sortKey} asc={ascending} onSort={toggle} mono />
            ))}
            <Th label={metricName ?? "—"} sortKey="__metric" active={sortKey} asc={ascending} onSort={toggle} mono />
            <Th label="Status" sortKey="__status" active={sortKey} asc={ascending} onSort={toggle} align="left" />
          </tr>
        </thead>
        <tbody>
          {rows.map((run) => {
            const isBest = run.runId === bestRunId;
            const brushed = highlighted ? highlighted.has(run.runId) : null;
            return (
            <tr
              key={run.runId}
              data-testid="sweep-run-row"
              data-best={isBest ? "true" : undefined}
              className={cn(
                "border-t transition-opacity hover:bg-muted/30",
                isBest && "bg-emerald-500/10 hover:bg-emerald-500/15",
                brushed === false && "opacity-25",
              )}
              data-brushed={brushed == null ? undefined : String(brushed)}
            >
              <td className="px-3 py-2">
                <Link
                  to="/o/$orgSlug/projects/$projectName/$runId"
                  params={{ orgSlug, projectName, runId: run.displayId ?? run.runId }}
                  className="text-primary hover:underline"
                >
                  {run.name}
                </Link>
                {isBest && (
                  <span className="ml-2 text-[10px] font-medium text-emerald-500">
                    best
                  </span>
                )}
                {/* Migrated runs keep a pointer to where they came from, which
                    is the only way back to the original for comparison. */}
                {run.wandbUrl && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <a
                        href={run.wandbUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 inline-flex align-middle text-muted-foreground hover:text-foreground"
                        data-testid="sweep-run-wandb-link"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </TooltipTrigger>
                    <TooltipContent>Open the original run on wandb</TooltipContent>
                  </Tooltip>
                )}
              </td>
              {sweptKeys.map((key) => (
                <td
                  key={key}
                  className="px-3 py-2 text-right font-mono text-xs tabular-nums"
                >
                  {format(run.config[key])}
                </td>
              ))}
              <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                {run.metricValue == null ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-muted-foreground/60">—</span>
                    </TooltipTrigger>
                    <TooltipContent>
                      This run never logged the selected metric.
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  format(run.metricValue)
                )}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {run.status}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

/** Sortable header cell. Clicking the active column flips direction. */
function Th({
  label,
  sortKey,
  active,
  asc,
  onSort,
  align = "right",
  mono,
}: {
  label: string;
  sortKey: string;
  active: string;
  asc: boolean;
  onSort: (key: string) => void;
  align?: "left" | "right";
  mono?: boolean;
}) {
  const isActive = active === sortKey;
  return (
    <th className={cn("px-3 py-2 font-medium", align === "left" ? "text-left" : "text-right")}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          mono && "font-mono",
          isActive && "text-foreground",
        )}
        data-testid={`sweep-sort-${sortKey}`}
      >
        {label}
        {isActive &&
          (asc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  );
}

function format(value: unknown) {
  if (value == null) return "—";
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? String(value)
      : Number(value.toPrecision(4)).toString();
  }
  return String(value);
}
