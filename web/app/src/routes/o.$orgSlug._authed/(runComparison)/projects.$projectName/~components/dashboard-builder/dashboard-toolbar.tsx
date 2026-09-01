import { Button } from "@/components/ui/button";
import {
  SaveIcon,
  XIcon,
  GridIcon,
  SlidersHorizontalIcon,
  ChevronsUpDownIcon,
  ChevronsDownUpIcon,
  HistoryIcon,
} from "lucide-react";

interface DashboardToolbarProps {
  viewName: string;
  currentVersion: number;
  hasChanges: boolean;
  isEditing: boolean;
  isHistoricalPreview: boolean;
  isSaving: boolean;
  sectionCount: number;
  allCollapsed: boolean;
  coarseMode: boolean;
  onToggleAllSections: () => void;
  /** Whether any folders have child sections */
  hasChildSections?: boolean;
  /** Whether all child sections are collapsed */
  allChildrenCollapsed?: boolean;
  /** Toggle collapse of all child sections inside folders */
  onToggleAllChildSections?: () => void;
  onSetCoarseMode: (coarse: boolean) => void;
  onCancel: () => void;
  onSave: () => void;
  onEnterEditMode: () => void;
  onOpenHistory: () => void;
}
export function DashboardToolbar({
  viewName,
  currentVersion,
  hasChanges,
  isEditing,
  isHistoricalPreview,
  isSaving,
  sectionCount,
  allCollapsed,
  coarseMode,
  onToggleAllSections,
  hasChildSections,
  allChildrenCollapsed,
  onToggleAllChildSections,
  onSetCoarseMode,
  onCancel,
  onSave,
  onEnterEditMode,
  onOpenHistory,
}: DashboardToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pb-2">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="truncate text-lg font-semibold">{viewName}</h2>
        {hasChanges && (
          <span className="text-xs text-muted-foreground">
            (unsaved changes)
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {sectionCount >= 2 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            onClick={onToggleAllSections}
            title={
              allCollapsed ? "Expand all sections" : "Collapse all sections"
            }
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
        {hasChildSections && onToggleAllChildSections && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            onClick={onToggleAllChildSections}
            title={
              allChildrenCollapsed
                ? "Expand all subsections"
                : "Collapse all subsections"
            }
          >
            {allChildrenCollapsed ? (
              <>
                <ChevronsUpDownIcon className="mr-1.5 size-3.5" />
                Expand Subsections
              </>
            ) : (
              <>
                <ChevronsDownUpIcon className="mr-1.5 size-3.5" />
                Collapse Subsections
              </>
            )}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenHistory}
          aria-label={`Open dashboard version history, current version v${currentVersion}`}
        >
          <HistoryIcon className="size-4 sm:mr-1.5" />
          <span className="hidden sm:inline">History</span>
          <span className="ml-1 text-xs text-muted-foreground">
            v{currentVersion}
          </span>
        </Button>
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
              data-testid="dashboard-save-btn"
            >
              <SaveIcon className="mr-2 size-4" />
              Save
            </Button>
          </>
        ) : !isHistoricalPreview ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onEnterEditMode}
            data-testid="dashboard-edit-btn"
          >
            Edit Dashboard
          </Button>
        ) : null}
      </div>
    </div>
  );
}
