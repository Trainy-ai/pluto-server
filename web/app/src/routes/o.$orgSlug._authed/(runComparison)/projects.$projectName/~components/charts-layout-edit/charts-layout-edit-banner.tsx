import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ChartsLayoutEditBannerProps {
  isSaving: boolean;
  /** Whether the draft differs from the saved arrangement. */
  isDirty: boolean;
  onSave: () => void;
  onCancel: () => void;
  /** Clear the saved overlay back to the default arrangement. */
  onReset: () => void;
}

/**
 * Sticky control bar shown while the WYSIWYG Charts-view layout editor is
 * active. The charts themselves stay visible and editable in place (drag
 * handles on cards and section headers); this banner only carries the mode's
 * save/cancel/reset controls.
 */
export function ChartsLayoutEditBanner({
  isSaving,
  isDirty,
  onSave,
  onCancel,
  onReset,
}: ChartsLayoutEditBannerProps) {
  return (
    <div
      className="flex items-center justify-between gap-4 rounded-lg border bg-card px-4 py-3 shadow-sm"
      data-testid="charts-layout-editor"
    >
      <div>
        <h3 className="text-sm font-semibold">Edit layout</h3>
        <p className="text-xs text-muted-foreground">
          Drag charts to reorder them within a section, drag section headers to
          rearrange sections, or toggle the eye to hide one. Saved for everyone
          on this project.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={isSaving}
          title="Reset to the default arrangement"
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Reset
        </Button>
        <Button variant="outline" size="sm" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={onSave}
          disabled={isSaving || !isDirty}
          data-testid="charts-layout-save"
        >
          {isSaving ? "Saving…" : "Save layout"}
        </Button>
      </div>
    </div>
  );
}
