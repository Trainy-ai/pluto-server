import { useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { WidgetLimitNotice } from "@/components/shared/widget-limit-notice";
import { MAX_RUNS_PER_BATCH } from "@/lib/batch-limits";
import { trpc } from "@/utils/trpc";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isRenderableInWidget } from "@/lib/file-types";
import { TextView } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/group/text-view";
import { MediaCardWrapper } from "@/components/core/media-card-wrapper";
import { HistogramFooterSliders } from "./components/histogram-footer-sliders";
import { useSyncedRunNavigation } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~context/run-sync-context";

interface MultiGroupFileProps {
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
 * Files/artifacts for the all-runs view.
 *
 * The all-runs dispatch handled METRIC/HISTOGRAM/AUDIO/IMAGE/VIDEO/TABLE and
 * fell through to `() => null` for FILE/TEXT/ARTIFACT, so every migrated wandb
 * artifact rendered as an empty widget with no message, while the same logs
 * rendered fine on the individual-run page.
 *
 * Renders inline whatever has a real viewer: images, HTML, Plotly figures,
 * matplotlib figures (which wandb converts to Plotly at log time, so they take
 * the same path) and 3D point clouds. Anything left — `.table.json` artifact
 * blobs and other raw text — is unreadable at widget size, so it gets a link
 * through to that run's Files tab where there is room for it.
 *
 * The three JSON-backed types can't be told apart by name (a migrated file is
 * stored under a UUID), so TextView sniffs the content and falls back to the
 * same link when it turns out to be a blob.
 *
 * One run at a time, scrubbed with the shared run slider, under a
 * MediaCardWrapper for fullscreen — same shape as MultiGroupTable.
 */
export const MultiGroupFile = ({
  logName,
  organizationId,
  projectName,
  runs,
  className,
}: MultiGroupFileProps) => {
  const { orgSlug } = useParams({ strict: false }) as { orgSlug?: string };

  // Cross-widget run sync: the hook owns the index, keeps it in range as the
  // selection changes, and broadcasts/receives the current run while locked.
  const runIds = useMemo(() => runs.map((r) => r.runId), [runs]);

  // filesBatch rejects more than MAX_RUNS_PER_BATCH runIds outright. Dashboard
  // widgets pass every selected run (not just the runs that have this log), so
  // the cap is reachable on any project with a big selection.
  const overRunCap = runIds.length > MAX_RUNS_PER_BATCH;
  const { runIdx, setRunIdx, isLocked, setIsLocked, hasSyncContext } =
    useSyncedRunNavigation({ runIds });
  const safeIndex = Math.min(runIdx, Math.max(0, runs.length - 1));
  const activeRun = runs[safeIndex];

  // Metadata only — enough to decide renderable-vs-link without fetching any
  // file bodies. One batched request for every run, matching the media widgets.
  const { data: byRun, isLoading } = useQuery(
    trpc.runs.data.filesBatch.queryOptions(
      { organizationId, projectName, logName, runIds },
      {
        enabled: runIds.length > 0 && !overRunCap && logName.length > 0,
      },
    ),
  );

  const log = useMemo(
    () => ({ logName, logType: "ARTIFACT" }) as Parameters<typeof TextView>[0]["log"],
    [logName],
  );

  if (overRunCap) {
    return (
      <WidgetLimitNotice
        title={logName}
        unit="runs"
        count={runIds.length}
        max={MAX_RUNS_PER_BATCH}
        className={className}
      />
    );
  }

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

  const files = byRun?.[activeRun.runId] ?? [];
  // filesBatch is ORDER BY step ASC, so the last entry is the latest step —
  // matching TextView's useStepNavigation default (max step). Gating on
  // files[0] previously hid a widget when the earliest step was a raw dump
  // but a later step held a renderable figure. Any renderable step is enough
  // to mount TextView; the step scrubber can reach the others.
  const latest = files.length > 0 ? files[files.length - 1] : undefined;
  // JSON is included because a Plotly / matplotlib figure and a 3D point cloud
  // all arrive as plain `.json` under a UUID filename — only the content can
  // say which. TextView does that check off the fetch it already makes, and
  // falls back to `plainTextFallback` below when it's just a blob, so an
  // unreadable table dump still never lands in a small widget.
  // Shared with metrics-display.tsx's upstream filter — see
  // `isRenderableInWidget`. The two MUST agree, or a log this widget can render
  // gets removed before the widget ever mounts.
  const renderable = files.some((f) => isRenderableInWidget(f.fileType));

  const filesHref =
    orgSlug &&
    `/o/${orgSlug}/projects/${encodeURIComponent(projectName)}/${activeRun.runId}/files`;

  // New tab: the all-runs page holds selection, slider and layout state that a
  // same-tab navigation would throw away.
  const filesLink = (label: string) =>
    filesHref ? (
      // Styled anchor rather than <Button asChild>: Slot was not merging the
      // button classes onto the <a>, leaving it display:block so the icon
      // wrapped onto its own line above the label.
      <a
        href={filesHref}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "h-7 shrink-0 gap-1.5 whitespace-nowrap px-2.5 text-xs",
        )}
      >
        <ExternalLink className="h-3 w-3 shrink-0" />
        {label}
      </a>
    ) : null;

  // Shared by the non-renderable branch and TextView's plain-text fallback.
  const linkFallback = (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
      <FileText className="h-6 w-6 text-muted-foreground/60" />
      <p
        className="max-w-full truncate font-mono text-[11px] text-muted-foreground"
        title={latest?.fileName}
      >
        {latest ? latest.fileName : "No file for this run"}
      </p>
      {latest && filesLink("View in Files")}
    </div>
  );

  const body = () => {
    if (isLoading) {
      return (
        <div className="flex-1 p-4">
          <Skeleton className="mb-2 h-4 w-full" />
          <Skeleton className="mb-2 h-4 w-3/4" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      );
    }

    if (renderable) {
      // TextView routes images, HTML, Plotly/mpl figures and point clouds to
      // their viewers. Remount per run so one run's step/file selection cannot
      // leak onto the next.
      return (
        <TextView
          key={activeRun.runId}
          log={log}
          tenantId={organizationId}
          projectName={projectName}
          runId={activeRun.runId}
          hideTitle
          plainTextFallback={linkFallback}
        />
      );
    }

    // Raw/large types: point at the run's Files tab rather than dumping
    // unreadable JSON into a small widget.
    return linkFallback;
  };

  return (
    <MediaCardWrapper title={logName} className="h-full w-full">
      <div
        data-testid="file-widget"
        className={cn("flex h-full w-full flex-col px-2 pt-2 pb-1", className)}
      >
        <h3 className="truncate pb-0.5 text-center font-mono text-sm font-medium text-muted-foreground">
          {logName}
        </h3>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">{body()}</div>
        {renderable && (
          <div className="flex justify-center pt-1.5 pb-1">
            {filesLink("Open in Files")}
          </div>
        )}
        {runs.length > 1 && (
          <div className="sticky bottom-0 border-t border-border bg-background pt-1.5 pb-0.5">
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
          </div>
        )}
      </div>
    </MediaCardWrapper>
  );
};
