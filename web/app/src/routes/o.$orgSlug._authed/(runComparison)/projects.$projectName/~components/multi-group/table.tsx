import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { TableView } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/group/table";
import { MediaCardWrapper } from "@/components/core/media-card-wrapper";
import { HistogramFooterSliders } from "./components/histogram-footer-sliders";
import { useSyncedRunNavigation } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~context/run-sync-context";

interface MultiGroupTableProps {
  logName: string;
  organizationId: string;
  projectName: string;
  runs: {
    runId: string;
    runName: string;
    color: string;
  }[];
  className?: string;
}

/**
 * Tables for the all-runs view.
 *
 * The all-runs dispatch used to fall through to `() => null` for TABLE, so a
 * table that rendered fine on the individual-run page was silently missing when
 * comparing runs.
 *
 * Unlike metrics, N runs' tables cannot be overlaid: rows share no numeric axis
 * and two runs' tables need not even share columns (a migrated `bar_table` is
 * label/value while `line_table` is x/y). Stacking them all vertically was the
 * first attempt and read badly — each table has its own search box, filter bar,
 * header row and pager, so several at once inside one fixed-height widget got
 * clipped mid-table.
 *
 * So this shows one run at a time, scrubbed with the same run slider the
 * histogram/bars widgets use (`HistogramFooterSliders`), under a
 * `MediaCardWrapper` that also grants fullscreen — the thing wide tabular data
 * actually needs. The slider goes through `useSyncedRunNavigation`, so scrubbing
 * runs here moves the histogram widgets to the same run and vice versa, with the
 * usual link/unlink toggle to opt out.
 *
 * Renders the single-run `TableView` rather than reimplementing it, so search,
 * per-column filters, sorting, pagination and the cell modal behave identically
 * on both pages and cannot drift apart. Only the visible run's table is
 * mounted, so widening a comparison to 25 runs costs one table query, not 25.
 */
export const MultiGroupTable = ({
  logName,
  organizationId,
  projectName,
  runs,
  className,
}: MultiGroupTableProps) => {
  // Cross-widget run sync: the hook owns the index, keeps it in range as the
  // selection changes, and broadcasts/receives the current run while locked.
  const runIds = useMemo(() => runs.map((r) => r.runId), [runs]);
  const { runIdx, setRunIdx, isLocked, setIsLocked, hasSyncContext } =
    useSyncedRunNavigation({ runIds });
  const safeIndex = Math.min(runIdx, Math.max(0, runs.length - 1));

  // TableView reads only `logName` off this prop (it drives both the query and
  // the heading), so a minimal object avoids inventing a fake RunLog id.
  const log = useMemo(
    () =>
      ({ logName, logType: "TABLE" }) as Parameters<typeof TableView>[0]["log"],
    [logName],
  );

  const activeRun = runs[safeIndex];

  if (!activeRun) {
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

  // Inline is compact (a ~380px widget has no room for TableView's heading and
  // search/filter bar); fullscreen gets the full table, which is where anyone
  // actually reads a wide table anyway.
  const table = (dense: boolean) => (
    <TableView
      // Remount per run: TableView holds its own search/filter/sort/page state,
      // and carrying one run's filters onto the next run's columns would
      // silently show a filtered-empty table.
      key={activeRun.runId}
      log={log}
      tenantId={organizationId}
      projectName={projectName}
      runId={activeRun.runId}
      compact={dense}
    />
  );

  // One definition, rendered in both the inline card and the fullscreen dialog.
  // These were duplicated verbatim, so a change to one silently diverged from
  // the other. Only the wrapper differs: the inline copy sticks to the bottom
  // of a scrolling card, the fullscreen copy does not need to.
  //
  // Rendered only when there is more than one run to scrub between, so the
  // slider's own visibility flag is redundant with the guard around it.
  const runSlider =
    runs.length > 1 ? (
      <HistogramFooterSliders
        showStepSlider={false}
        showRunSlider
        stepIdx={0}
        steps={[]}
        onStepIdxChange={() => {}}
        runIdx={safeIndex}
        runs={runs.map((r) => ({ runName: r.runName, color: r.color }))}
        onRunIdxChange={setRunIdx}
        showRunLock={hasSyncContext}
        isRunLocked={isLocked}
        onRunLockChange={setIsLocked}
      />
    ) : null;

  return (
    <MediaCardWrapper
      title={logName}
      className="h-full w-full"
      fullscreenContent={
        <div className="flex h-full w-full flex-col p-4">
          <div className="min-h-0 min-w-0 flex-1 overflow-auto">
            {table(false)}
          </div>
          {runSlider && (
            <div className="border-t border-border pt-1.5 pb-0.5">
              {runSlider}
            </div>
          )}
        </div>
      }
    >
      <div
        data-testid="table-widget"
        className={cn("flex h-full w-full flex-col p-4", className)}
      >
        <h3 className="truncate pb-1 text-center font-mono text-sm font-medium text-muted-foreground">
          {logName}
        </h3>
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          {table(true)}
        </div>

        {runSlider && (
          <div className="sticky bottom-0 border-t border-border bg-background pt-1.5 pb-0.5">
            {runSlider}
          </div>
        )}
      </div>
    </MediaCardWrapper>
  );
};
