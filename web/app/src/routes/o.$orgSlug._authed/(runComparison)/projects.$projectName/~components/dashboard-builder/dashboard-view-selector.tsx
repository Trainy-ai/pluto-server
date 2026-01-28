import { useState, useRef, useCallback } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlusIcon, Trash2Icon, PencilIcon, ChevronDownIcon, DownloadIcon, UploadIcon, FileJsonIcon } from "lucide-react";
import type { DashboardViewConfig } from "../../~types/dashboard-types";
import {
  useDashboardViews,
  useCreateDashboardView,
  useDeleteDashboardView,
  type DashboardView,
} from "../../~queries/dashboard-views";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface DashboardViewSelectorProps {
  organizationId: string;
  projectName: string;
  selectedViewId: string | null;
  onViewChange: (viewId: string | null) => void;
  onEditView?: (view: DashboardView) => void;
}

export function DashboardViewSelector({
  organizationId,
  projectName,
  selectedViewId,
  onViewChange,
  onEditView,
}: DashboardViewSelectorProps) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [viewToDelete, setViewToDelete] = useState<DashboardView | null>(null);
  const [createMode, setCreateMode] = useState<"new" | "import">("new");
  const [importedConfig, setImportedConfig] = useState<DashboardViewConfig | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useDashboardViews(organizationId, projectName);
  const createMutation = useCreateDashboardView(organizationId, projectName);
  const deleteMutation = useDeleteDashboardView(organizationId, projectName);

  const views = data?.views ?? [];
  const selectedView = selectedViewId ? views.find((v: DashboardView) => v.id === selectedViewId) : null;
  const isChartsTab = selectedViewId !== null;

  const handleCreateView = () => {
    if (!newViewName.trim()) return;

    // If importing, validate that we have a config
    if (createMode === "import" && !importedConfig) {
      setImportError("Please select a valid dashboard file to import");
      return;
    }

    createMutation.mutate(
      {
        organizationId,
        projectName,
        name: newViewName.trim(),
        ...(createMode === "import" && importedConfig ? { config: importedConfig } : {}),
      },
      {
        onSuccess: (newView) => {
          resetCreateDialog();
          onViewChange(newView.id);
        },
      }
    );
  };

  const handleDeleteView = () => {
    if (!viewToDelete) return;

    deleteMutation.mutate(
      {
        organizationId,
        viewId: viewToDelete.id,
      },
      {
        onSuccess: () => {
          setIsDeleteDialogOpen(false);
          setViewToDelete(null);
          // If the deleted view was selected, switch to all metrics
          if (selectedViewId === viewToDelete.id) {
            onViewChange(null);
          }
        },
      }
    );
  };

  // Export current view as JSON
  const handleExport = useCallback((view: DashboardView) => {
    const exportData = {
      name: view.name,
      config: view.config,
      exportedAt: new Date().toISOString(),
      exportVersion: 1,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${view.name.replace(/[^a-z0-9]/gi, "_")}_dashboard.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  // Handle file selection for import
  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportError(null);
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const data = JSON.parse(text);

        // Validate the imported data
        if (!data.config || typeof data.config !== "object") {
          throw new Error("Invalid dashboard file: missing config");
        }

        if (!data.config.version || !data.config.sections || !data.config.settings) {
          throw new Error("Invalid dashboard file: config is missing required fields");
        }

        // Set the imported config and name
        setImportedConfig(data.config as DashboardViewConfig);
        if (data.name) {
          setNewViewName(data.name);
        }
      } catch (err) {
        setImportError(err instanceof Error ? err.message : "Failed to parse file");
        setImportedConfig(null);
      }
    };

    reader.onerror = () => {
      setImportError("Failed to read file");
      setImportedConfig(null);
    };

    reader.readAsText(file);
  }, []);

  // Reset create dialog state
  const resetCreateDialog = useCallback(() => {
    setIsCreateDialogOpen(false);
    setNewViewName("");
    setCreateMode("new");
    setImportedConfig(null);
    setImportError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  return (
    <>
      <div className="flex items-center">
        {/* Tabs container */}
        <div className="flex items-center rounded-lg border bg-muted p-1">
          {/* All Metrics Tab */}
          <button
            onClick={() => onViewChange(null)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              !isChartsTab
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            All Metrics
          </button>

          {/* Charts Tab with Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  isChartsTab
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span>{isChartsTab && selectedView ? selectedView.name : "Charts"}</span>
                <ChevronDownIcon className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[200px]">
              {views.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  No saved charts yet
                </div>
              ) : (
                views.map((view: DashboardView) => (
                  <DropdownMenuItem
                    key={view.id}
                    onClick={() => onViewChange(view.id)}
                    className={cn(
                      "flex items-center justify-between",
                      selectedViewId === view.id && "bg-accent"
                    )}
                  >
                    <span className="truncate">{view.name}</span>
                    {view.isDefault && (
                      <span className="ml-2 text-xs text-muted-foreground">(default)</span>
                    )}
                  </DropdownMenuItem>
                ))
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setIsCreateDialogOpen(true)}>
                <PlusIcon className="mr-2 size-4" />
                Create New Chart
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Actions for selected custom view */}
        {selectedViewId && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="ml-1">
                <PencilIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onEditView && (
                <DropdownMenuItem
                  onClick={() => {
                    const view = views.find((v: DashboardView) => v.id === selectedViewId);
                    if (view) {
                      onEditView(view);
                    }
                  }}
                >
                  <PencilIcon className="mr-2 size-4" />
                  Edit View
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => {
                  const view = views.find((v: DashboardView) => v.id === selectedViewId);
                  if (view) {
                    handleExport(view);
                  }
                }}
              >
                <DownloadIcon className="mr-2 size-4" />
                Export as JSON
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => {
                  const view = views.find((v: DashboardView) => v.id === selectedViewId);
                  if (view) {
                    setViewToDelete(view);
                    setIsDeleteDialogOpen(true);
                  }
                }}
              >
                <Trash2Icon className="mr-2 size-4" />
                Delete View
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Create View Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={(open) => {
        if (!open) resetCreateDialog();
        else setIsCreateDialogOpen(true);
      }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Create New Chart</DialogTitle>
            <DialogDescription>
              Create a new chart from scratch or import an existing dashboard configuration.
            </DialogDescription>
          </DialogHeader>
          <Tabs value={createMode} onValueChange={(v) => setCreateMode(v as "new" | "import")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="new">
                <PlusIcon className="mr-2 size-4" />
                New Chart
              </TabsTrigger>
              <TabsTrigger value="import">
                <UploadIcon className="mr-2 size-4" />
                Import JSON
              </TabsTrigger>
            </TabsList>
            <TabsContent value="new" className="space-y-4 pt-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Chart Name</Label>
                <Input
                  id="name"
                  placeholder="My Custom Chart"
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleCreateView();
                    }
                  }}
                />
              </div>
            </TabsContent>
            <TabsContent value="import" className="space-y-4 pt-4">
              <div className="grid gap-2">
                <Label htmlFor="import-file">Dashboard File</Label>
                <div className="flex gap-2">
                  <Input
                    ref={fileInputRef}
                    id="import-file"
                    type="file"
                    accept=".json"
                    onChange={handleFileSelect}
                    className="flex-1"
                  />
                </div>
                {importError && (
                  <p className="text-sm text-destructive">{importError}</p>
                )}
                {importedConfig && (
                  <div className="rounded-lg border bg-muted/50 p-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <FileJsonIcon className="size-4" />
                      <span>
                        Loaded config with {importedConfig.sections.length} section(s)
                        {importedConfig.sections.reduce((acc, s) => acc + s.widgets.length, 0)} widget(s)
                      </span>
                    </div>
                  </div>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="import-name">Chart Name</Label>
                <Input
                  id="import-name"
                  placeholder="My Imported Chart"
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && importedConfig) {
                      handleCreateView();
                    }
                  }}
                />
              </div>
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={resetCreateDialog}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateView}
              loading={createMutation.isPending}
              disabled={
                !newViewName.trim() ||
                (createMode === "import" && !importedConfig)
              }
            >
              {createMode === "import" ? "Import" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Chart</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{viewToDelete?.name}"? This action
              cannot be undone.
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
              loading={deleteMutation.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
