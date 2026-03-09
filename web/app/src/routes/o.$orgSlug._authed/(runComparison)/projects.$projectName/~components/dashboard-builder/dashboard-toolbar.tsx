import { Button } from "@/components/ui/button";
import {
  SaveIcon,
  XIcon,
  RotateCcwIcon,
  GridIcon,
  SlidersHorizontalIcon,
  ChevronsUpDownIcon,
  ChevronsDownUpIcon,
} from "lucide-react";

interface DashboardToolbarProps {
  viewName: string;
  hasChanges: boolean;
  isEditing: boolean;
  isSaving: boolean;
  sectionCount: number;
  allCollapsed: boolean;
  coarseMode: boolean;
  onResetAllBounds: () => void;
  onToggleAllSections: () => void;
  onSetCoarseMode: (coarse: boolean) => void;
  onCancel: () => void;
  onSave: () => void;
  onEnterEditMode: () => void;
}

export function DashboardToolbar({
  viewName,
  hasChanges,
  isEditing,
  isSaving,
  sectionCount,
  allCollapsed,
  coarseMode,
  onResetAllBounds,
  onToggleAllSections,
  onSetCoarseMode,
  onCancel,
  onSave,
  onEnterEditMode,
}: DashboardToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-4 pb-2">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">{viewName}</h2>
        {hasChanges && (
          <span className="text-xs text-muted-foreground">(unsaved changes)</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {sectionCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            onClick={onResetAllBounds}
            title="Reset all Y-axis bounds"
          >
            <RotateCcwIcon className="mr-1.5 size-3.5" />
            Reset Bounds
          </Button>
        )}
        {sectionCount >= 2 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            onClick={onToggleAllSections}
            title={allCollapsed ? "Expand all sections" : "Collapse all sections"}
          >
            {allCollapsed ? (
              <>
                <ChevronsUpDownIcon className="mr-1.5 size-3.5" />
                Expand All
              </>
            ) : (
              <>
                <ChevronsDownUpIcon className="mr-1.5 size-3.5" />
                Collapse All
              </>
            )}
          </Button>
        )}
        {isEditing ? (
          <>
            {/* Coarse / Fine toggle */}
            <div className="flex items-center rounded-md border">
              <Button
                variant={coarseMode ? "secondary" : "ghost"}
                size="sm"
                className="rounded-r-none border-0"
                onClick={() => onSetCoarseMode(true)}
              >
                <GridIcon className="mr-1.5 size-3.5" />
                Grid
              </Button>
              <Button
                variant={!coarseMode ? "secondary" : "ghost"}
                size="sm"
                className="rounded-l-none border-0"
                onClick={() => onSetCoarseMode(false)}
              >
                <SlidersHorizontalIcon className="mr-1.5 size-3.5" />
                Free
              </Button>
            </div>
            <Button variant="outline" size="sm" onClick={onCancel}>
              <XIcon className="mr-2 size-4" />
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={onSave}
              loading={isSaving}
              disabled={!hasChanges}
            >
              <SaveIcon className="mr-2 size-4" />
              Save
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={onEnterEditMode} data-testid="edit-dashboard-btn">
            Edit Dashboard
          </Button>
        )}
      </div>
    </div>
  );
}
