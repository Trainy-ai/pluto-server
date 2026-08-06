import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Info, Wand2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TruncatedLabel } from "@/components/shared/truncated-label";
import { cn } from "@/lib/utils";

interface ParamImportanceProps {
  stats: { key: string; importance: number; correlation: number | null }[];
  /** Metric the stats were computed against. */
  metricName: string | null;
  /** Metrics this panel can be pointed at. */
  availableMetrics: string[];
  onMetricChange: (metric: string) => void;
  /** Whether every varying config key is included, not just the swept ones. */
  includeAllConfig: boolean;
  onIncludeAllConfigChange: (value: boolean) => void;
  className?: string;
}

type SortColumn = "importance" | "correlation";

/** Rows per page. Matches wandb, whose panel pages at five. */
const PAGE_SIZE = 5;

/**
 * "Useful" = the smallest set of parameters that together explain most of the
 * metric. Importances sum to 1, so taking rows until the running total passes
 * this leaves out the tail that only adds noise. A sweep with one dominant knob
 * collapses to one row; a sweep where everything matters a little keeps them
 * all, which is itself the answer.
 */
const USEFUL_COVERAGE = 0.9;

/**
 * Which knob mattered — importance beside correlation, as wandb shows them.
 *
 * Two columns because they answer different questions and can disagree:
 * importance is "did this matter at all" (always positive), correlation is
 * "which way do I turn it" (signed). A knob whose best value sits in the middle
 * of its range scores high importance with near-zero correlation.
 *
 * Plain bars rather than a chart library: these are single normalised values
 * per row, so a div with a width is the whole visualisation and costs nothing.
 */
export function ParamImportance({
  stats,
  metricName,
  availableMetrics,
  onMetricChange,
  includeAllConfig,
  onIncludeAllConfigChange,
  className,
}: ParamImportanceProps) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [sortBy, setSortBy] = useState<SortColumn>("importance");
  const [descending, setDescending] = useState(true);
  const [usefulOnly, setUsefulOnly] = useState(false);

  const handleSort = (column: SortColumn) => {
    if (column === sortBy) {
      setDescending((prev) => !prev);
    } else {
      setSortBy(column);
      setDescending(true);
    }
  };

  // Applied before search so the cut is over real importances, not over
  // whatever the search happened to leave behind.
  const useful = useMemo(() => {
    if (!usefulOnly) {
      return stats;
    }
    const ranked = [...stats].sort((a, b) => b.importance - a.importance);
    const kept: typeof stats = [];
    let covered = 0;
    for (const stat of ranked) {
      kept.push(stat);
      covered += stat.importance;
      if (covered >= USEFUL_COVERAGE) {
        break;
      }
    }
    return kept;
  }, [stats, usefulOnly]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? useful.filter((s) => s.key.toLowerCase().includes(needle))
      : useful;
    // Correlation sorts by magnitude: the question is "which knob has the
    // strongest direction", and -0.9 is as strong an answer as +0.9.
    const key = (stat: (typeof matched)[number]) =>
      sortBy === "importance" ? stat.importance : Math.abs(stat.correlation ?? 0);
    const sorted = [...matched].sort((a, b) => key(b) - key(a));
    return descending ? sorted : sorted.reverse();
  }, [useful, query, sortBy, descending]);

  // A sweep can have dozens of one-hot columns; showing all of them buries the
  // handful that matter. Paged, ordered by importance, so page 1 is the answer.
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);
  // `1-0 of 0` when a search matched nothing, because the first index is
  // computed from the page rather than from what is actually on it.
  const rangeLabel = visible.length
    ? `${safePage * pageSize + 1}-${safePage * pageSize + visible.length} of ${filtered.length}`
    : "0 of 0";

  if (stats.length === 0) {
    return (
      <div
        className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground"
        data-testid="sweep-param-importance-empty"
      >
        Not enough finished runs to rank parameters yet — at least 3 runs need a
        value for this metric.
      </div>
    );
  }

  return (
    <div
      className={cn("overflow-hidden rounded-lg border", className)}
      data-testid="sweep-param-importance"
    >
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2">
        <h2 className="text-xs font-medium">Parameter importance</h2>
        <span className="text-[11px] text-muted-foreground">with respect to</span>
        {/* Independent of the page objective: the knob that drove val_loss is
            not necessarily the one that drove training time. */}
        <select
          value={metricName ?? ""}
          onChange={(e) => onMetricChange(e.target.value)}
          className="h-6 rounded border bg-background px-1 font-mono text-[11px]"
          data-testid="sweep-param-metric"
        >
          {/* Without a matching option the select would show the first metric
              while its value is "", claiming a selection nobody made. */}
          {metricName == null && <option value="">no metric</option>}
          {availableMetrics.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        {/* An icon button rather than a labelled one: this is an action ("show
            me the ones that matter"), and its pressed state carries whether it
            is currently applied. The outcome is always reported below, so the
            button is never silently a no-op. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={usefulOnly ? "secondary" : "ghost"}
              size="icon"
              className="h-6 w-6"
              onClick={() => {
                setUsefulOnly((prev) => !prev);
                setPage(0);
              }}
              data-testid="sweep-param-useful"
            >
              <Wand2 className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Automatically show the most useful parameters.</TooltipContent>
        </Tooltip>
        {/* A checkbox, not a toggle button: a button labelled with its current
            state ("Swept only") cannot be told apart from one labelled with the
            action it performs. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={includeAllConfig}
            onChange={(e) => onIncludeAllConfigChange(e.target.checked)}
            data-testid="sweep-param-all-config"
          />
          Include non-swept config
            </label>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            Also rank config keys the sweep did not control — a seed, a dataset
            version, a machine type. Useful when something outside the search
            space is what actually moved the metric.
          </TooltipContent>
        </Tooltip>
        <div className="ml-auto flex items-center gap-2">
          {/* Always shown, as wandb does — a control that appears only past a
              threshold is one users never learn is there. */}
          <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0); // a new filter invalidates the old page number
              }}
              placeholder="Search"
              className="h-7 w-32 text-xs"
              data-testid="sweep-param-search"
            />
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span data-testid="sweep-param-page">{rangeLabel}</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(0);
                }}
                className="h-6 rounded border bg-background px-1 text-[11px]"
                data-testid="sweep-param-page-size"
              >
                {[5, 10, 25].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
                data-testid="sweep-param-prev"
              >
                ‹
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)}
                data-testid="sweep-param-next"
              >
                ›
              </Button>
          </div>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Config parameter</th>
            <SortableTh
              label="Importance"
              column="importance"
              active={sortBy}
              onSort={handleSort}
              descending={descending}
              hint="Each parameter's share of the impurity a random forest removes across all of them. Always positive: how much this knob mattered."
            />
            <SortableTh
              label="Correlation"
              column="correlation"
              active={sortBy}
              onSort={handleSort}
              descending={descending}
              hint="Spearman rank correlation. Signed: which way to turn the knob. Sorts by magnitude."
            />
          </tr>
        </thead>
        <tbody>
          {visible.map((stat) => (
            <tr key={stat.key} className="border-t" data-testid="sweep-param-row">
              <td className="max-w-[220px] px-4 py-2 font-mono text-xs">
                <TruncatedLabel text={stat.key} className="block" />
              </td>
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <Bar value={stat.importance} tone="importance" />
                  <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                    {stat.importance.toFixed(3)}
                  </span>
                </div>
              </td>
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <Bar value={stat.correlation ?? 0} tone="correlation" />
                  <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                    {stat.correlation == null ? "—" : stat.correlation.toFixed(3)}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* A metric that ends at the same value in every run (a step counter, an
          epoch index) leaves the forest nothing to explain. Four empty bars
          look like "no parameter mattered"; the truth is that the question is
          unanswerable for this metric. */}
      {stats.every((stat) => stat.importance === 0) && (
        <p
          className="border-t px-4 py-2 text-xs text-muted-foreground"
          data-testid="sweep-param-constant"
        >
          Every run finished with the same {metricName ?? "value"}, so no
          parameter can explain it. Pick a metric that varies.
        </p>
      )}

      {/* Always report the outcome. On a sweep where importance is spread
          evenly there is nothing negligible to hide, and silently changing
          nothing is indistinguishable from a broken button. */}
      {usefulOnly && (
        <p
          className="border-t px-4 py-1.5 text-[11px] text-muted-foreground"
          data-testid="sweep-param-useful-note"
        >
          {useful.length < stats.length
            ? `Showing the ${useful.length} of ${stats.length} parameters that explain most of ${metricName ?? "the metric"}.`
            : `All ${stats.length} parameters contribute — none is negligible enough to hide.`}
        </p>
      )}

      {visible.length === 0 && (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          No parameter matches "{query}".
        </p>
      )}

      <p className="border-t px-4 py-2 text-[10px] leading-relaxed text-muted-foreground">
        Importance is each parameter's share of the impurity a random forest
        removes across all of them; correlation is Spearman rank correlation.
        The forest is seeded, so these are stable between reloads. Treat them as
        indicative on a small sweep.
      </p>
    </div>
  );
}

/** Header cell that sorts and carries an explanation of its column. */
function SortableTh({
  label,
  column,
  active,
  onSort,
  descending,
  hint,
}: {
  label: string;
  column: SortColumn;
  active: SortColumn;
  onSort: (column: SortColumn) => void;
  descending: boolean;
  hint: string;
}) {
  return (
    <th className="px-4 py-2 text-left font-medium">
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          active === column && "text-foreground",
        )}
        data-testid={`sweep-param-sort-${column}`}
      >
        {label}
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Info className="h-3 w-3 opacity-50" />
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{hint}</TooltipContent>
        </Tooltip>
        {active === column &&
          (descending ? (
            <ArrowDown className="h-3 w-3" />
          ) : (
            <ArrowUp className="h-3 w-3" />
          ))}
      </button>
    </th>
  );
}

/**
 * Importance fills left-to-right from 0. Correlation is signed, so it grows
 * out from a centre line — otherwise -0.9 and +0.9 would look identical.
 */
function Bar({ value, tone }: { value: number; tone: "importance" | "correlation" }) {
  const magnitude = Math.min(Math.abs(value), 1) * 100;

  if (tone === "importance") {
    return (
      <div className="h-3 w-full max-w-[180px] overflow-hidden rounded-sm bg-muted">
        <div
          className="h-full rounded-sm bg-blue-500"
          style={{ width: `${magnitude}%` }}
        />
      </div>
    );
  }

  const positive = value >= 0;
  return (
    <div
      className="relative h-3 w-full max-w-[180px] rounded-sm bg-muted">
      <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
      <div
        className={cn(
          "absolute inset-y-0 rounded-sm",
          positive ? "bg-emerald-500" : "bg-rose-500",
        )}
        style={{
          width: `${magnitude / 2}%`,
          left: positive ? "50%" : undefined,
          right: positive ? undefined : "50%",
        }}
      />
    </div>
  );
}
