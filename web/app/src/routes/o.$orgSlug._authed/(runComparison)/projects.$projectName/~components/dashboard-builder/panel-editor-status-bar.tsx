// Bottom bar of the Python panel editor: Run + boot/run status on the
// left, Cancel/Save on the right. Also hosts the discard-confirmation
// dialog for dirty cancels (same pattern as dashboard-dialogs.tsx).

import { useEffect, useState } from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  Loader2Icon,
  PlayIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { SandboxPhase } from "@/components/panels/panel-sandbox";

interface PanelEditorStatusBarProps {
  /** null before the first Run. */
  phase: SandboxPhase | null;
  /** Extra detail for the error phase (stack/message). */
  errorDetail: string | null;
  /** Requirements/code validation error (pre-run). */
  validationError: string | null;
  lastRunAt: number | null;
  canSave: boolean;
  isEditing: boolean;
  onRun: () => void;
  onCancel: () => void;
  onSave: () => void;
}

export function PanelEditorStatusBar({
  phase,
  errorDetail,
  validationError,
  lastRunAt,
  canSave,
  isEditing,
  onRun,
  onCancel,
  onSave,
}: PanelEditorStatusBarProps) {
  const isBusy =
    phase !== null && phase !== "done" && phase !== "error";

  return (
    <div className="flex items-center gap-3 border-t pt-3">
      <Button
        onClick={onRun}
        disabled={isBusy}
        size="sm"
        data-testid="panel-editor-run"
      >
        {isBusy ? (
          <Loader2Icon className="mr-1.5 size-3.5 animate-spin" />
        ) : (
          <PlayIcon className="mr-1.5 size-3.5" />
        )}
        Run
      </Button>
      <div
        className="flex min-w-0 flex-1 items-center gap-2 text-xs"
        data-testid="panel-editor-status"
      >
        <StatusIndicator
          phase={phase}
          errorDetail={errorDetail}
          validationError={validationError}
          lastRunAt={lastRunAt}
        />
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onCancel}
        data-testid="panel-editor-cancel"
      >
        Cancel
      </Button>
      <Button
        size="sm"
        onClick={onSave}
        disabled={!canSave}
        title={canSave ? undefined : "Run the panel successfully before saving"}
        data-testid="panel-editor-save"
      >
        {isEditing ? "Save Changes" : "Add to Dashboard"}
      </Button>
    </div>
  );
}

function StatusIndicator({
  phase,
  errorDetail,
  validationError,
  lastRunAt,
}: {
  phase: SandboxPhase | null;
  errorDetail: string | null;
  validationError: string | null;
  lastRunAt: number | null;
}) {
  if (validationError) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-destructive">
        <AlertTriangleIcon className="size-3.5 shrink-0" />
        <span className="truncate" title={validationError}>
          {validationError}
        </span>
      </span>
    );
  }
  if (phase === null) {
    return (
      <span className="text-muted-foreground">
        Not run yet — Cmd/Ctrl+Enter runs from the editor
      </span>
    );
  }
  if (phase === "error") {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-destructive">
        <AlertTriangleIcon className="size-3.5 shrink-0" />
        <span className="truncate" title={errorDetail ?? undefined}>
          {errorDetail ?? "Panel failed"}
        </span>
      </span>
    );
  }
  if (phase === "done") {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <CheckCircle2Icon className="size-3.5 shrink-0 text-green-600 dark:text-green-500" />
        Ran <RelativeTime timestamp={lastRunAt} />
      </span>
    );
  }
  return (
    <span className="text-muted-foreground">{BUSY_PHASE_LABELS[phase]}</span>
  );
}

/** Coarse self-refreshing "Ran Ns ago" label. */
function RelativeTime({ timestamp }: { timestamp: number | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((tick) => tick + 1), 10_000);
    return () => clearInterval(interval);
  }, []);
  if (timestamp === null) {
    return null;
  }
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 10) {
    return <span data-testid="panel-editor-last-run">just now</span>;
  }
  if (seconds < 60) {
    return <span data-testid="panel-editor-last-run">{seconds}s ago</span>;
  }
  const minutes = Math.round(seconds / 60);
  return <span data-testid="panel-editor-last-run">{minutes}m ago</span>;
}

const BUSY_PHASE_LABELS: Record<
  Exclude<SandboxPhase, "done" | "error">,
  string
> = {
  waiting: "Preparing sandbox…",
  "loading-runtime": "Loading Python runtime…",
  installing: "Installing packages…",
  running: "Running panel…",
};

// ─── Discard confirmation ─────────────────────────────────────────────

interface PanelDiscardConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function PanelDiscardConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
}: PanelDiscardConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangleIcon className="size-5 text-yellow-500" />
            Discard panel changes?
          </DialogTitle>
          <DialogDescription>
            You have unsaved changes to this panel. Are you sure you want to
            discard them? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="panel-editor-keep-editing"
          >
            Keep Editing
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            data-testid="panel-editor-discard"
          >
            Discard Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
