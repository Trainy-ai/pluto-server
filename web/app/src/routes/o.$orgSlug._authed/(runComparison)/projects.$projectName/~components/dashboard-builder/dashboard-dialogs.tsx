import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertTriangleIcon,
  ArchiveRestoreIcon,
} from "lucide-react";

// ─── Cancel Confirmation ──────────────────────────────────────────────

interface CancelConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function CancelConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
}: CancelConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangleIcon className="size-5 text-yellow-500" />
            Discard unsaved changes?
          </DialogTitle>
          <DialogDescription>
            You have unsaved changes to this dashboard. Are you sure you want to
            discard them? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep Editing
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Discard Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Draft Restore ────────────────────────────────────────────────────

interface DraftRestoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestore: () => void;
  onDiscard: () => void;
}

export function DraftRestoreDialog({
  open,
  onOpenChange,
  onRestore,
  onDiscard,
}: DraftRestoreDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArchiveRestoreIcon className="size-5 text-blue-500" />
            Restore unsaved draft?
          </DialogTitle>
          <DialogDescription>
            You have unsaved changes from a previous editing session. Would you
            like to restore them, or start fresh from the last saved version?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onDiscard}>
            Start Fresh
          </Button>
          <Button onClick={onRestore}>
            Restore Draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Navigation Guard ─────────────────────────────────────────────────

interface NavGuardDialogProps {
  open: boolean;
  onStay: () => void;
  onLeave: () => void;
}

export function NavGuardDialog({
  open,
  onStay,
  onLeave,
}: NavGuardDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => { if (!isOpen) { onStay(); } }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangleIcon className="size-5 text-yellow-500" />
            Unsaved dashboard changes
          </DialogTitle>
          <DialogDescription>
            Your dashboard has changes that haven&apos;t been saved yet. If you
            leave now, these changes will be lost.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onStay}>
            Stay
          </Button>
          <Button variant="destructive" onClick={onLeave}>
            Leave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Save as New ──────────────────────────────────────────────────────

interface SaveAsNewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onNameChange: (name: string) => void;
  onConfirm: () => void;
  isPending: boolean;
}

export function SaveAsNewDialog({
  open,
  onOpenChange,
  name,
  onNameChange,
  onConfirm,
  isPending,
}: SaveAsNewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Save as New Dashboard</DialogTitle>
          <DialogDescription>
            Save your current changes as a new dashboard view. The original
            dashboard will remain unchanged.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-4">
          <Label htmlFor="save-as-new-name">Dashboard Name</Label>
          <Input
            id="save-as-new-name"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onConfirm();
              }
            }}
            placeholder="My Dashboard (copy)"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            loading={isPending}
            disabled={!name.trim()}
          >
            Save as New
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
