import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { GitMerge, ArrowDown, Unlink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMergeRuns, useUnmergeRun } from "../../../~queries/merge-runs";
import type { Run } from "../../../~queries/list-runs";

/** Matches `runs.merge` input: `z.array(z.string()).min(2).max(10)`. */
const MAX_MERGE_RUNS = 10;

interface MergeRunsButtonProps {
  organizationId: string;
  projectName: string;
  /** The checked runs the bulk action operates on (same set as delete). */
  selectedRunsWithColors: Record<string, { run: Run; color: string }>;
}

function compareRunsByCreatedAt(a: Run, b: Run): number {
  const dt = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  if (dt !== 0) {
    return dt;
  }
  return a.id < b.id ? -1 : 1;
}

export function MergeRunsButton({
  organizationId,
  projectName,
  selectedRunsWithColors,
}: MergeRunsButtonProps) {
  const [open, setOpen] = useState(false);
  const mergeRuns = useMergeRuns();
  const unmergeRun = useUnmergeRun();

  // Chain order mirrors the server: createdAt ascending, ties by id.
  const orderedRuns = useMemo(() => {
    return Object.values(selectedRunsWithColors)
      .map((v) => v.run)
      .sort(compareRunsByCreatedAt);
  }, [selectedRunsWithColors]);

  const selectedCount = orderedRuns.length;
  const canMerge = selectedCount >= 2 && selectedCount <= MAX_MERGE_RUNS;

  const handleConfirm = () => {
    mergeRuns.mutate(
      {
        organizationId,
        projectName,
        runIds: orderedRuns.map((r) => r.id),
      },
      { onSuccess: () => setOpen(false) }
    );
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label="Merge selected runs"
            data-testid="merge-runs-btn"
            className="h-9 w-9"
            disabled={!canMerge}
            onClick={() => setOpen(true)}
          >
            <GitMerge className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {selectedCount > MAX_MERGE_RUNS
            ? `Select at most ${MAX_MERGE_RUNS} runs to merge`
            : canMerge
              ? `Merge ${selectedCount} selected runs into one lineage`
              : "Select 2+ runs to merge (e.g. a crashed run and its restart)"}
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="merge-runs-dialog">
          <DialogHeader>
            <DialogTitle>
              Merge {selectedCount} runs into one lineage?
            </DialogTitle>
            <DialogDescription>
              Each run becomes the continuation of the one created before it.
              Boundary steps are detected automatically from each run&apos;s
              logged data. Charts then show one continuous series. This is
              reversible — you can unlink runs later from this dialog.
            </DialogDescription>
          </DialogHeader>

          <ol className="max-h-56 space-y-1 overflow-y-auto rounded-md border bg-muted/30 p-2 text-sm">
            {orderedRuns.map((run, i) => (
              <li key={run.id} className="px-1 py-0.5">
                {i > 0 && (
                  <div className="flex items-center gap-1 pb-0.5 text-xs text-muted-foreground">
                    <ArrowDown className="h-3 w-3" /> continues as
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{run.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {run.status} · {new Date(run.createdAt).toLocaleString()}
                  </span>
                </div>
                {run.forkedFromRunId && (
                  <div className="flex items-center justify-between gap-2 pt-0.5 text-xs text-muted-foreground">
                    <span>Already linked</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 shrink-0 px-2 text-xs"
                      data-testid={`unlink-run-${run.id}`}
                      disabled={unmergeRun.isPending}
                      onClick={() =>
                        unmergeRun.mutate({
                          organizationId,
                          projectName,
                          runId: run.id,
                        })
                      }
                    >
                      <Unlink className="mr-1 h-3 w-3" /> Unlink
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ol>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={mergeRuns.isPending}
            >
              Cancel
            </Button>
            <Button
              data-testid="confirm-merge-runs-btn"
              onClick={handleConfirm}
              disabled={mergeRuns.isPending || !canMerge}
            >
              {mergeRuns.isPending ? "Merging…" : "Merge runs"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
