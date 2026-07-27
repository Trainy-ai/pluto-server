import { useState } from "react";
import { Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface ChartsLayoutEditBannerProps {
  isSaving: boolean;
  /** Whether the draft differs from the saved arrangement. */
  isDirty: boolean;
  onSave: () => void;
  onCancel: () => void;
  /** Clear the saved overlay back to the default arrangement. */
  onReset: () => void;
  /** Create a new custom section with the given name. */
  onAddSection: (name: string) => void;
}

/**
 * Control bar shown while the WYSIWYG Charts-view layout editor is active.
 * Rendered inside the view's sticky header so Save/Cancel/Reset stay visible
 * at any scroll position. The charts themselves stay editable in place; this
 * bar carries the mode's controls plus the custom-section creator.
 */
export function ChartsLayoutEditBanner({
  isSaving,
  isDirty,
  onSave,
  onCancel,
  onReset,
  onAddSection,
}: ChartsLayoutEditBannerProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [sectionName, setSectionName] = useState("");

  const submitAddSection = () => {
    const name = sectionName.trim();
    if (!name) {
      return;
    }
    onAddSection(name);
    setSectionName("");
    setAddOpen(false);
  };

  return (
    <div
      className="flex items-center justify-between gap-4 rounded-lg border bg-card px-4 py-3 shadow-sm"
      data-testid="charts-layout-editor"
    >
      <div>
        <h3 className="text-sm font-semibold">Edit layout</h3>
        <p className="text-xs text-muted-foreground">
          Drag charts to reorder or move them between sections, drag section
          headers to rearrange, toggle the eye to hide. Saved for everyone on
          this project.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={isSaving}
              data-testid="charts-layout-add-section"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add section
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 space-y-2" align="end">
            <Input
              autoFocus
              placeholder="Section name"
              value={sectionName}
              onChange={(e) => setSectionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  submitAddSection();
                }
              }}
              data-testid="charts-layout-add-section-name"
            />
            <Button
              size="sm"
              className="w-full"
              onClick={submitAddSection}
              disabled={!sectionName.trim()}
              data-testid="charts-layout-add-section-confirm"
            >
              Create section
            </Button>
          </PopoverContent>
        </Popover>
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
