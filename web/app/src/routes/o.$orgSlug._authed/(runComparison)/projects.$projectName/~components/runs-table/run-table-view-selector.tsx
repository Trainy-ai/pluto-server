import { useState, useCallback, useMemo, useRef, useEffect } from "react";
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
  ChevronDownIcon,
  CheckIcon,
  SaveIcon,
  Trash2Icon,
  PlusIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useRunTableViews,
  useCreateRunTableView,
  useUpdateRunTableView,
  useDeleteRunTableView,
  type RunTableView,
} from "../../~queries/run-table-views";
import type { ColumnConfig, BaseColumnOverrides } from "../../~hooks/use-column-config";
import type { RunFilter } from "@/lib/run-filters";
import type { SortingState } from "@tanstack/react-table";

interface RunTableViewConfig {
  version: number;
  columns: ColumnConfig[];
  baseOverrides: Record<string, BaseColumnOverrides>;
  filters: RunFilter[];
  sorting: SortingState;
  pageSize?: number;
}

const DEFAULT_VIEW_NAME = "Default";

interface RunTableViewSelectorProps {
  organizationId: string;
  projectName: string;
  currentColumns: ColumnConfig[];
  currentBaseOverrides: Record<string, BaseColumnOverrides>;
  currentFilters: RunFilter[];
  currentSorting: SortingState;
  currentPageSize: number;
  activeViewId: string | null;
  onActiveViewChange: (viewId: string | null) => void;
  onLoadView: (config: RunTableViewConfig) => void;
  onResetToDefault: () => void;
}

export function RunTableViewSelector({
  organizationId,
  projectName,
  currentColumns,
  currentBaseOverrides,
  currentFilters,
  currentSorting,
  currentPageSize,
  activeViewId,
  onActiveViewChange,
  onLoadView,
  onResetToDefault,
}: RunTableViewSelectorProps) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [viewToDelete, setViewToDelete] = useState<RunTableView | null>(null);

  const { data, isLoading } = useRunTableViews(organizationId, projectName);
  const createMutation = useCreateRunTableView(organizationId, projectName);
  const updateMutation = useUpdateRunTableView(organizationId, projectName);
  const deleteMutation = useDeleteRunTableView(organizationId, projectName);

  const views = data?.views ?? [];
  const savedDefaultView = views.find((v) => v.name === DEFAULT_VIEW_NAME);
  const customViews = views.filter((v) => v.name !== DEFAULT_VIEW_NAME);

  const activeView = activeViewId
    ? views.find((v) => v.id === activeViewId)
    : null;

  // Whether we're on the Default view (null activeViewId)
  const isOnDefault = !activeViewId;

  // Track the config snapshot from when a view was last loaded or saved.
  // Compare against this rather than the DB value to avoid false positives
  // on initial page load (where activeViewId is restored from localStorage
  // but the config state hasn't been synced yet).
  const loadedConfigSnapshotRef = useRef<string | null>(null);
  const defaultSnapshotInitialized = useRef(false);

  const getCurrentConfig = useCallback((): RunTableViewConfig => {
    return {
      version: 1,
      columns: currentColumns,
      baseOverrides: currentBaseOverrides,
      filters: currentFilters,
      sorting: currentSorting,
      pageSize: currentPageSize,
    };
  }, [currentColumns, currentBaseOverrides, currentFilters, currentSorting, currentPageSize]);

  const handleSelectView = useCallback(
    (view: RunTableView) => {
      loadedConfigSnapshotRef.current = JSON.stringify(view.config);
      defaultSnapshotInitialized.current = false;
      onActiveViewChange(view.id);
      onLoadView(view.config as RunTableViewConfig);
    },
    [onActiveViewChange, onLoadView]
  );

  const handleSelectDefault = useCallback(() => {
    defaultSnapshotInitialized.current = false;
    if (savedDefaultView) {
      loadedConfigSnapshotRef.current = JSON.stringify(savedDefaultView.config);
      defaultSnapshotInitialized.current = true;
      onActiveViewChange(null);
      onLoadView(savedDefaultView.config as RunTableViewConfig);
    } else {
      loadedConfigSnapshotRef.current = null;
      onActiveViewChange(null);
      onResetToDefault();
    }
  }, [onActiveViewChange, onLoadView, onResetToDefault, savedDefaultView]);

  const [createError, setCreateError] = useState<string | null>(null);

  const handleSaveToNewView = useCallback(() => {
    if (!newViewName.trim()) return;
    setCreateError(null);

    createMutation.mutate(
      {
        organizationId,
        projectName,
        name: newViewName.trim(),
        config: getCurrentConfig(),
      },
      {
        onSuccess: (newView) => {
          setIsCreateDialogOpen(false);
          setNewViewName("");
          setCreateError(null);
          loadedConfigSnapshotRef.current = JSON.stringify(getCurrentConfig());
          onActiveViewChange(newView.id);
        },
        onError: (error) => {
          if (error.message.includes("already exists") || error.message.includes("reserved")) {
            setCreateError("A view with this name already exists.");
          } else {
            setCreateError("Failed to create view.");
          }
        },
      }
    );
  }, [
    newViewName,
    organizationId,
    projectName,
    getCurrentConfig,
    createMutation,
    onActiveViewChange,
  ]);

  const handleSaveToCurrentView = useCallback(() => {
    if (!activeViewId) return;

    updateMutation.mutate({
      organizationId,
      viewId: activeViewId,
      config: getCurrentConfig(),
    });
  }, [activeViewId, organizationId, getCurrentConfig, updateMutation]);

  const handleSaveToDefault = useCallback(() => {
    const config = getCurrentConfig();

    if (savedDefaultView) {
      // Update existing default view
      updateMutation.mutate(
        {
          organizationId,
          viewId: savedDefaultView.id,
          config,
        },
        {
          onSuccess: () => {
            loadedConfigSnapshotRef.current = JSON.stringify(config);
          },
        }
      );
    } else {
      // Create the default view for the first time
      createMutation.mutate(
        {
          organizationId,
          projectName,
          name: DEFAULT_VIEW_NAME,
          config,
        },
        {
          onSuccess: () => {
            loadedConfigSnapshotRef.current = JSON.stringify(config);
          },
        }
      );
    }
  }, [organizationId, projectName, getCurrentConfig, savedDefaultView, updateMutation, createMutation]);

  const handleDeleteView = useCallback(() => {
    if (!viewToDelete) return;

    deleteMutation.mutate(
      {
        organizationId,
        viewId: viewToDelete.id,
      },
      {
        onSuccess: () => {
          setIsDeleteDialogOpen(false);
          if (activeViewId === viewToDelete.id) {
            onActiveViewChange(null);
            onResetToDefault();
          }
          setViewToDelete(null);
        },
      }
    );
  }, [
    viewToDelete,
    organizationId,
    deleteMutation,
    activeViewId,
    onActiveViewChange,
    onResetToDefault,
  ]);

  // Set snapshot when saving to current view
  useEffect(() => {
    if (updateMutation.isSuccess) {
      loadedConfigSnapshotRef.current = JSON.stringify(getCurrentConfig());
    }
  }, [updateMutation.isSuccess, getCurrentConfig]);

  // Initialize snapshot on page reload when activeViewId is restored from localStorage.
  // Also apply the saved config so that fields like pageSize (which aren't independently
  // persisted to localStorage for custom views) get restored into state.
  useEffect(() => {
    if (activeView && loadedConfigSnapshotRef.current === null) {
      loadedConfigSnapshotRef.current = JSON.stringify(activeView.config);
      onLoadView(activeView.config as RunTableViewConfig);
    }
  }, [activeView, onLoadView]);

  // Initialize snapshot for the default view.
  // If a saved default exists, load its config. Otherwise, snapshot the current
  // (hardcoded) config so we can detect changes from it.
  useEffect(() => {
    if (isOnDefault && loadedConfigSnapshotRef.current === null && !defaultSnapshotInitialized.current) {
      if (savedDefaultView) {
        loadedConfigSnapshotRef.current = JSON.stringify(savedDefaultView.config);
        onLoadView(savedDefaultView.config as RunTableViewConfig);
        defaultSnapshotInitialized.current = true;
      } else if (!isLoading) {
        // No saved default — snapshot the current hardcoded default config
        loadedConfigSnapshotRef.current = JSON.stringify(getCurrentConfig());
        defaultSnapshotInitialized.current = true;
      }
    }
  }, [isOnDefault, savedDefaultView, isLoading, onLoadView, getCurrentConfig]);

  const hasUnsavedChanges = useMemo(() => {
    const snapshot = loadedConfigSnapshotRef.current;
    if (snapshot === null) return false;
    // Works for both custom views and default view
    if (activeView || isOnDefault) {
      const current = getCurrentConfig();
      const parsed = JSON.parse(snapshot) as RunTableViewConfig;
      const normalizedSnapshot = { ...parsed, pageSize: parsed.pageSize ?? current.pageSize };
      return JSON.stringify(normalizedSnapshot) !== JSON.stringify(current);
    }
    return false;
  }, [activeView, isOnDefault, savedDefaultView, getCurrentConfig]);

  const displayLabel = activeView ? activeView.name : "Default";
  const isSaving = updateMutation.isPending || createMutation.isPending;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="relative h-9 w-auto max-w-[12rem] gap-2 px-3 text-xs"
            disabled={isLoading}
          >
            {hasUnsavedChanges && (
              <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-primary" />
            )}
            <span className="truncate">{displayLabel}</span>
            <ChevronDownIcon className="size-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[220px] max-w-[36rem]">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Custom views
          </DropdownMenuLabel>
          {/* Default view */}
          <DropdownMenuItem onClick={handleSelectDefault}>
            <span className="flex-1">Default</span>
            {isOnDefault && <CheckIcon className="ml-2 size-4" />}
          </DropdownMenuItem>

          {/* Saved custom views */}
          {customViews.length > 0 && <DropdownMenuSeparator />}
          {customViews.map((view) => (
            <DropdownMenuItem
              key={view.id}
              onClick={() => handleSelectView(view)}
            >
              <span className="flex-1 truncate">{view.name}</span>
              {activeViewId === view.id && (
                <CheckIcon className="ml-2 size-4" />
              )}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />

          {/* Save to new view */}
          <DropdownMenuItem onClick={() => setIsCreateDialogOpen(true)}>
            <PlusIcon className="mr-2 size-4" />
            Save to new view preset
          </DropdownMenuItem>

          {/* Save to Default (when on default view) */}
          {isOnDefault && (
            <DropdownMenuItem
              onClick={handleSaveToDefault}
              disabled={isSaving}
            >
              <SaveIcon className="mr-2 size-4" />
              Save to &quot;Default&quot;
            </DropdownMenuItem>
          )}

          {/* Save to current view (only when on a custom view) */}
          {activeView && activeView.name !== DEFAULT_VIEW_NAME && (
            <DropdownMenuItem
              onClick={handleSaveToCurrentView}
              disabled={updateMutation.isPending}
            >
              <SaveIcon className="mr-2 size-4" />
              <span className="truncate">
                Save to &quot;{activeView.name}&quot;
              </span>
            </DropdownMenuItem>
          )}

          {/* Delete (only for non-default views) */}
          {activeView && activeView.name !== DEFAULT_VIEW_NAME && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => {
                  setViewToDelete(activeView);
                  setIsDeleteDialogOpen(true);
                }}
              >
                <Trash2Icon className="mr-2 size-4" />
                Delete &quot;{activeView.name}&quot;
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Create View Dialog */}
      <Dialog
        open={isCreateDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsCreateDialogOpen(false);
            setNewViewName("");
            setCreateError(null);
          } else {
            setIsCreateDialogOpen(true);
          }
        }}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Save to new view preset</DialogTitle>
            <DialogDescription>
              Save the current table configuration as a named view that can be
              shared with your team.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor="view-name">View Name</Label>
            <Input
              id="view-name"
              placeholder="My custom view"
              value={newViewName}
              onChange={(e) => {
                setNewViewName(e.target.value);
                setCreateError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSaveToNewView();
                }
              }}
              autoFocus
            />
            {createError && (
              <p className="text-sm text-destructive">{createError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsCreateDialogOpen(false);
                setNewViewName("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveToNewView}
              disabled={!newViewName.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete View</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{viewToDelete?.name}&quot;?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteView}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
