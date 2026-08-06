import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { MediaCardWrapper } from "@/components/core/media-card-wrapper";
import {
  buildVegaSpec,
  latestTable,
  CustomChartFallback,
  VegaChart,
  type ChartSource,
  type CustomChartPanel,
} from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/group/custom-chart-view";

interface MultiGroupCustomChartProps {
  panel: CustomChartPanel;
  organizationId: string;
  projectName: string;
  runs: {
    runId: string;
    runName: string;
    color: string;
  }[];
  /** Selected-run count before the overlay cap, so truncation can be stated. */
  totalRunCount?: number;
  className?: string;
}

/**
 * A migrated wandb custom chart on the all-runs page.
 *
 * These panels only existed on the individual run page, so comparing runs lost
 * every `wandb.plot.*` chart — the one thing wandb's own workspace shows them
 * in. Because they come off run *config* rather than the log registry, they
 * can't ride the log-type dispatch in `multi-group.tsx`; the section is built
 * separately in `metrics-display.tsx`.
 *
 * Every run's table goes into one chart. That needs no per-preset special
 * casing: wandb's presets are all written for a multi-run workspace and already
 * group and colour by the `name`/`color` fields each row carries — including the
 * confusion matrix, whose v1 spec is a grid of per-cell bars, one bar per run,
 * rather than a single-run heatmap.
 */
export const MultiGroupCustomChart = ({
  panel,
  organizationId,
  projectName,
  runs,
  totalRunCount,
  className,
}: MultiGroupCustomChartProps) => {
  const tableQueries = useQueries({
    queries: runs.map((r) =>
      trpc.runs.data.table.queryOptions({
        organizationId,
        projectName,
        runId: r.runId,
        logName: panel.tableKey,
      }),
    ),
  });

  const isLoading = tableQueries.some((q) => q.isLoading);

  const sources = useMemo<ChartSource[]>(() => {
    const out: ChartSource[] = [];
    runs.forEach((run, i) => {
      const table = latestTable(tableQueries[i]?.data);
      // Runs that never logged this panel's table are simply absent from the
      // overlay rather than drawing an empty series.
      if (table) out.push({ runName: run.runName, color: run.color, table });
    });
    return out;
    // Spread, not a bare `.map()`: a fresh array literal in the dep list is
    // never Object.is-equal, so `sources` would be rebuilt on every render,
    // `built` with it, and `VegaChart`'s effect (keyed on the spec object)
    // would finalize and re-embed the whole Vega view every time. Spreading
    // puts each run's query data in as its own dep, which react-query keeps
    // referentially stable between refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, ...tableQueries.map((q) => q.data)]);

  const built = useMemo(() => buildVegaSpec(panel, sources), [panel, sources]);

  const title = panel.title || panel.key;
  const truncated = totalRunCount != null && totalRunCount > runs.length;

  const body = (
    <>
      {isLoading ? (
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-full min-h-16 w-full" />
        </div>
      ) : built ? (
        <VegaChart spec={built.spec} controls={built.controls} title={title} />
      ) : sources.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          No table data for the selected runs
        </div>
      ) : (
        <CustomChartFallback panel={panel} />
      )}
      {truncated && (
        <p className="text-center font-mono text-[10px] text-muted-foreground">
          showing {runs.length} of {totalRunCount} selected runs
        </p>
      )}
    </>
  );

  if (runs.length === 0) {
    return (
      <div
        className={cn(
          "flex h-full items-center justify-center text-sm text-muted-foreground",
          className,
        )}
      >
        No runs selected
      </div>
    );
  }

  return (
    <MediaCardWrapper
      title={title}
      className="h-full w-full"
      fullscreenContent={
        <div className="flex h-full w-full flex-col gap-1 p-4">{body}</div>
      }
    >
      <div
        data-testid="custom-chart-widget"
        className={cn("flex h-full min-h-0 w-full flex-col gap-1 p-4", className)}
      >
        {/* wandb's specs draw their own title from `${string:title}`, so a
            heading here would double it. Only the non-spec states need one. */}
        {!built && (
          <h3 className="truncate text-center font-mono text-sm font-medium">{title}</h3>
        )}
        {body}
      </div>
    </MediaCardWrapper>
  );
};
