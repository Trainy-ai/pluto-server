import PageLayout from "@/components/layout/page-layout";
import { OrganizationPageTitle } from "@/components/layout/page-title";
import RunComparisonLayout from "@/components/layout/runComparison/layout";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { trpc } from "@/utils/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ParallelCoords } from "./~components/sweeps/parallel-coords";
import { SweepRunsTable } from "./~components/sweeps/sweep-runs-table";
import { ParamImportance } from "./~components/sweeps/param-importance";
import { SweepProgress } from "./~components/sweeps/sweep-progress";
import { SearchSpace } from "./~components/sweeps/search-space";
import { SweepSummaryBar } from "./~components/sweeps/sweep-summary-bar";
import { SweepMetricCharts } from "./~components/sweeps/sweep-metric-charts";
import { useSweepRunColors } from "./~components/sweeps/sweep-run-colors";

type Goal = "minimize" | "maximize";

interface SweepSearchParams {
  /** Objective override. Absent means "use the sweep's declared metric". */
  metric?: string;
  /** Direction override. Absent means "use the sweep's declared goal". */
  goal?: Goal;
  /** Metric the importance panel targets, independent of the objective. */
  statsMetric?: string;
  /** Widen importance to every varying config key, not just swept ones. */
  allConfig?: boolean;
}

/** Stable empty list so the colour hook's memo doesn't churn while loading. */
const EMPTY_RUNS: { runId: string }[] = [];

export const Route = createFileRoute(
  "/o/$orgSlug/_authed/(runComparison)/projects/$projectName/sweeps/$sweepId",
)({
  // In the URL rather than component state so a re-axed view survives a
  // refresh and can be shared — "this sweep judged by accuracy" is a link,
  // not something the recipient has to reproduce by clicking.
  validateSearch: (search): SweepSearchParams => {
    const result: SweepSearchParams = {};
    if (typeof search.metric === "string" && search.metric.trim()) {
      result.metric = search.metric.trim();
    }
    if (search.goal === "minimize" || search.goal === "maximize") {
      result.goal = search.goal;
    }
    if (typeof search.statsMetric === "string" && search.statsMetric.trim()) {
      result.statsMetric = search.statsMetric.trim();
    }
    if (search.allConfig === true || search.allConfig === "true") {
      result.allConfig = true;
    }
    return result;
  },
  // Mirrors the sibling routes: the org id comes off the authed route context
  // rather than a hook, so it is available before the component renders.
  beforeLoad: ({ context }) => ({
    organizationId: context.auth.activeOrganization.id,
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { projectName, sweepId, orgSlug } = Route.useParams();
  const { organizationId } = Route.useRouteContext();
  const navigate = useNavigate();

  // Undefined means "whatever the server resolves"; picking one pins it.
  const { metric, goal, statsMetric, allConfig } = Route.useSearch();

  // Re-checked here, not just in validateSearch: the URL is user-editable, and
  // a hand-typed `?goal=sideways` reaching the procedure fails its Zod enum and
  // errors the whole query. Guarding at the point of use keeps a junk param a
  // no-op instead of a broken page, whatever the router does upstream.
  const safeGoal = goal === "minimize" || goal === "maximize" ? goal : undefined;
  const safeMetric = metric?.trim() ? metric.trim() : undefined;

  // `replace` so dragging through metrics doesn't fill the back button with
  // every intermediate choice. Stable identities: these are props on children
  // that re-render on every brush frame, and a fresh closure per render is one
  // more reason for them to.
  const setMetric = useCallback(
    (next: string) =>
      void navigate({ to: ".", search: (prev) => ({ ...prev, metric: next }), replace: true }),
    [navigate],
  );
  const setGoal = useCallback(
    (next: Goal) =>
      void navigate({ to: ".", search: (prev) => ({ ...prev, goal: next }), replace: true }),
    [navigate],
  );
  const setStatsMetric = useCallback(
    (next: string) =>
      void navigate({ to: ".", search: (prev) => ({ ...prev, statsMetric: next }), replace: true }),
    [navigate],
  );
  const setAllConfig = useCallback(
    (next: boolean) =>
      void navigate({
        to: ".",
        // Dropped rather than set false, so the default state leaves a clean URL.
        search: (prev) => ({ ...prev, allConfig: next || undefined }),
        replace: true,
      }),
    [navigate],
  );

  const { data, isLoading, isError } = useQuery({
    ...trpc.sweeps.get.queryOptions({
      organizationId,
      projectName,
      sweepId,
      metric: safeMetric,
      goal: safeGoal,
      statsMetric: statsMetric?.trim() || undefined,
      includeAllConfig: allConfig === true,
    }),
  });

  // One colour per run, shared by the runs table's swatches and the metric
  // curves so a row and its line are recognisably the same run.
  const runColors = useSweepRunColors(data?.runs ?? EMPTY_RUNS);

  // Runs surviving the parallel-coords brush; null when nothing is brushed.
  const [brushedRunIds, setBrushedRunIds] = useState<string[] | null>(null);
  // Stable identity: ParallelCoords calls this from an effect, so a new
  // function each render would loop.
  const handleFilterChange = useCallback(
    (ids: string[] | null) => setBrushedRunIds(ids),
    [],
  );

  const bestRun = useMemo(() => {
    if (!data?.runs) return undefined;
    const scored = data.runs.filter((run) => run.metricValue != null);
    if (scored.length === 0) return undefined;
    return scored.reduce((best, run) =>
      data.resolvedMetric.goal === "maximize"
        ? run.metricValue! > best.metricValue!
          ? run
          : best
        : run.metricValue! < best.metricValue!
          ? run
          : best,
    );
  }, [data]);

  // Rebuilt on every render otherwise, including the ~60/s a brush drag causes.
  const runRefs = useMemo(
    () => data?.runs.map((run) => run.displayId ?? run.runId) ?? [],
    [data],
  );

  return (
    <RunComparisonLayout>
      <PageLayout
        showSidebarTrigger={false}
        headerLeft={
          <OrganizationPageTitle
            breadcrumbs={[
              { title: "Home", to: "/o/$orgSlug" },
              { title: "Projects", to: "/o/$orgSlug/projects" },
              {
                title: projectName,
                to: "/o/$orgSlug/projects/$projectName",
              },
              {
                title: "Sweeps",
                to: "/o/$orgSlug/projects/$projectName/sweeps",
              },
            ]}
            title={sweepId}
          />
        }
      >
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 p-6 sm:p-8">
          {isLoading ? (
            <div className="flex flex-col gap-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-[300px] w-full" />
            </div>
          ) : isError ? (
            <div
              className="rounded-lg border border-dashed p-10 text-center"
              data-testid="sweep-error"
            >
              <p className="text-sm font-medium">Could not load this sweep</p>
              <p className="mt-2 text-xs text-muted-foreground">
                The request failed. Reload to try again.
              </p>
            </div>
          ) : !data ? (
            <div
              className="rounded-lg border border-dashed p-10 text-center"
              data-testid="sweep-not-found"
            >
              <p className="text-sm font-medium">Sweep not found</p>
              <p className="mt-2 text-xs text-muted-foreground">
                No runs in {projectName} carry the tag{" "}
                <code>sweep:{sweepId}</code>.
              </p>
            </div>
          ) : (
            <>
              <header className="flex flex-wrap items-center gap-3">
                <h1 className="font-mono text-2xl font-semibold">
                  {data.name ?? data.sweepId}
                </h1>
                {data.fromWandb && <Badge variant="outline">wandb</Badge>}
                {data.method && <Badge variant="secondary">{data.method}</Badge>}
                <span className="text-sm text-muted-foreground">
                  {data.runs.length} run{data.runs.length === 1 ? "" : "s"}
                </span>
              </header>

              <SweepSummaryBar
                state={data.state}
                statuses={data.statuses}
                gridTotal={data.gridTotal}
                projectName={projectName}
                orgSlug={orgSlug}
                runRefs={runRefs}
              />

              <section className="flex flex-wrap items-end gap-4 rounded-lg border p-4">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Objective</label>
                  <Select
                    value={data.resolvedMetric.name ?? ""}
                    onValueChange={setMetric}
                  >
                    <SelectTrigger
                      className="w-56"
                      data-testid="sweep-metric-picker"
                    >
                      <SelectValue placeholder="No metric" />
                    </SelectTrigger>
                    <SelectContent>
                      {data.availableMetrics.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Goal</label>
                  <Select
                    value={data.resolvedMetric.goal}
                    onValueChange={(v) => setGoal(v as Goal)}
                  >
                    <SelectTrigger className="w-36" data-testid="sweep-goal-picker">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minimize">minimize</SelectItem>
                      <SelectItem value="maximize">maximize</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-1 flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Best run</span>
                  <span className="font-mono text-sm" data-testid="sweep-best-run">
                    {bestRun ? (
                      <>
                        {bestRun.name}
                        <span className="ml-2 text-muted-foreground">
                          {data.resolvedMetric.name} ={" "}
                          {Number(bestRun.metricValue!.toPrecision(4))}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </span>
                </div>
              </section>

              {/* Say where the objective came from. A native sweep declares
                  none server-side, so "inferred" is the honest label rather
                  than presenting a guess as the user's choice. */}
              <MetricSource source={data.resolvedMetric.source} />

              {/* Progress and importance side by side above the wider
                  parallel-coords chart, which needs the full width once a
                  sweep has more than a couple of axes. */}
              <SearchSpace parameters={data.parameters} sweptKeys={data.sweptKeys} />

              <SweepRunsTable
                runs={data.runs}
                runColors={runColors}
                sweptKeys={data.sweptKeys}
                metricName={data.resolvedMetric.name}
                goal={data.resolvedMetric.goal}
                projectName={projectName}
                orgSlug={orgSlug}
                bestRunId={bestRun?.runId}
                highlightRunIds={brushedRunIds}
              />

              <SweepMetricCharts
                runs={data.runs}
                runColors={runColors}
                availableMetrics={data.availableMetrics}
                metricName={data.resolvedMetric.name}
                organizationId={organizationId}
                projectName={projectName}
              />

              {/* [&>*]:min-w-0 — grid items default to min-width:auto, so a
                  child with a wide intrinsic minimum (the importance table's
                  prose, a Vega canvas) pushes its track past 1fr and the row
                  overflows the page instead of the child shrinking. */}
              <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
                <SweepProgress
                  runs={data.runs}
                  metricName={data.resolvedMetric.name}
                  goal={data.resolvedMetric.goal}
                />
                <ParamImportance
                  stats={data.paramStats}
                  metricName={data.statsMetric}
                  availableMetrics={data.availableMetrics}
                  onMetricChange={setStatsMetric}
                  includeAllConfig={allConfig === true}
                  onIncludeAllConfigChange={setAllConfig}
                />
              </div>

              <ParallelCoords
                runs={data.runs}
                sweptKeys={data.sweptKeys}
                metricName={data.resolvedMetric.name}
                goal={data.resolvedMetric.goal}
                onFilterChange={handleFilterChange}
              />
            </>
          )}
        </div>
      </PageLayout>
    </RunComparisonLayout>
  );
}

type MetricSourceKind = "sweep-config" | "requested" | "inferred" | "none";

function MetricSource({ source }: { source: MetricSourceKind }) {
  if (source === "sweep-config" || source === "requested") {
    return null;
  }
  return (
    <p
      className="text-xs text-muted-foreground"
      data-testid="sweep-metric-source"
    >
      {source === "inferred"
        ? "This sweep does not declare an objective, so the first logged metric is shown. Pick another above."
        : "These runs have not logged any metric yet."}
    </p>
  );
}
