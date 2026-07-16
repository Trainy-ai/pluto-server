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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useDeleteProject } from "../~queries/delete-project";

interface DeleteProjectButtonProps {
  organizationId: string;
  projectName: string;
  runCount: number;
}

export function DeleteProjectButton({
  organizationId,
  projectName,
  runCount,
}: DeleteProjectButtonProps) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const deleteProject = useDeleteProject(organizationId);

  // Clear the confirm input whenever the dialog closes so a previously-typed
  // name can't carry over into the next deletion.
  useEffect(() => {
    if (!open) setConfirmText("");
  }, [open]);

  // Exact-match on the project name (after trimming) — typing the name is the
  // deliberate act that arms the Delete button.
  const confirmMatches = confirmText.trim() === projectName;

  const handleConfirm = () => {
    deleteProject.mutate(
      { organizationId, projectName },
      {
        onSuccess: () => {
          setOpen(false);
        },
      },
    );
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete project ${projectName}`}
            data-testid="delete-project-btn"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => setOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Delete project</TooltipContent>
      </Tooltip>

      <Dialog
        open={open}
        onOpenChange={(val) => {
          // Don't let outside-click/Escape dismiss the dialog while the
          // deletion is in flight.
          if (!deleteProject.isPending) {
            setOpen(val);
          }
        }}
      >
        <DialogContent data-testid="delete-project-dialog">
          <DialogHeader>
            <DialogTitle>
              Delete project{" "}
              <span className="font-mono">{projectName}</span>?
            </DialogTitle>
            <DialogDescription>
              This permanently deletes the project, its {runCount}{" "}
              {runCount === 1 ? "run" : "runs"}, and all associated metrics,
              logs, files, and dashboards. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="delete-project-confirm-input" className="text-sm">
              Type <span className="font-mono font-semibold">{projectName}</span>{" "}
              to confirm
            </Label>
            <Input
              id="delete-project-confirm-input"
              data-testid="delete-project-confirm-input"
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
                  !deleteProject.isPending
                ) {
                  e.preventDefault();
                  handleConfirm();
                }
              }}
              disabled={deleteProject.isPending}
              placeholder={projectName}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={deleteProject.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              data-testid="confirm-delete-project-btn"
              onClick={handleConfirm}
              disabled={deleteProject.isPending || !confirmMatches}
            >
              {deleteProject.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
