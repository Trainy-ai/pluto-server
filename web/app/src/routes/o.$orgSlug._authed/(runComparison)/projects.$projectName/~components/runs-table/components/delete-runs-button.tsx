import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDeleteRuns } from "../../../~queries/delete-runs";
import type { Run } from "../../../~queries/list-runs";

// Type-to-confirm phrase. Compared case-insensitively after trimming so the
// user has to do something deliberate, but doesn't get tripped up by caps lock.
const CONFIRM_PHRASE = "delete";

interface DeleteRunsButtonProps {
  organizationId: string;
  projectName: string;
  selectedRunsWithColors: Record<string, { run: Run; color: string }>;
  /** Called after a successful delete so the caller can clear selection. */
  onDeleted: (deletedRunIds: string[]) => void;
}

// How many run names to preview in the confirmation dialog before collapsing
// the remainder into a "+N more" line.
const MAX_PREVIEW_NAMES = 8;

export function DeleteRunsButton({
  organizationId,
  projectName,
  selectedRunsWithColors,
  onDeleted,
}: DeleteRunsButtonProps) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const deleteRuns = useDeleteRuns(organizationId, projectName);

  // Clear the confirm input every time the dialog opens or closes so a
  // previously-typed value can't carry over into the next deletion.
  useEffect(() => {
    if (!open) setConfirmText("");
  }, [open]);

  const selectedIds = Object.keys(selectedRunsWithColors);
  const selectedCount = selectedIds.length;
  const names = selectedIds.map((id) => selectedRunsWithColors[id]?.run.name ?? id);
  const confirmMatches =
    confirmText.trim().toLowerCase() === CONFIRM_PHRASE;

  const handleConfirm = () => {
    const runIds = [...selectedIds];
    deleteRuns.mutate(
      { organizationId, projectName, runIds },
      {
        onSuccess: () => {
          setOpen(false);
          onDeleted(runIds);
        },
      }
    );
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label="Delete selected runs"
            data-testid="delete-runs-btn"
            className="h-9 w-9 text-destructive hover:text-destructive"
            disabled={selectedCount === 0}
            onClick={() => setOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {selectedCount === 0
            ? "Select runs to delete"
            : `Delete ${selectedCount} selected ${selectedCount === 1 ? "run" : "runs"}`}
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="delete-runs-dialog">
          <DialogHeader>
            <DialogTitle>
              Delete {selectedCount} {selectedCount === 1 ? "run" : "runs"}?
            </DialogTitle>
            <DialogDescription>
              This permanently deletes the selected{" "}
              {selectedCount === 1 ? "run" : "runs"} and all associated metrics,
              logs, and files. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <ul className="max-h-48 overflow-y-auto rounded-md border bg-muted/30 p-2 text-sm">
            {names.slice(0, MAX_PREVIEW_NAMES).map((name, i) => (
              <li key={selectedIds[i]} className="truncate px-1 py-0.5">
                {name}
              </li>
            ))}
            {selectedCount > MAX_PREVIEW_NAMES && (
              <li className="px-1 py-0.5 text-muted-foreground">
                +{selectedCount - MAX_PREVIEW_NAMES} more
              </li>
            )}
          </ul>

          <div className="space-y-2">
            <Label htmlFor="delete-runs-confirm-input" className="text-sm">
              Type <span className="font-mono font-semibold">delete</span> to
              confirm
            </Label>
            <Input
              id="delete-runs-confirm-input"
              data-testid="delete-runs-confirm-input"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  confirmMatches &&
                  !deleteRuns.isPending
                ) {
                  e.preventDefault();
                  handleConfirm();
                }
              }}
              disabled={deleteRuns.isPending}
              placeholder="delete"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={deleteRuns.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              data-testid="confirm-delete-runs-btn"
              onClick={handleConfirm}
              disabled={
                deleteRuns.isPending || selectedCount === 0 || !confirmMatches
              }
            >
              {deleteRuns.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
