import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  PlusIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
  ZapIcon,
  ClipboardPasteIcon,
  GripVerticalIcon,
  FolderIcon,
  ArrowRightIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { DynamicPatternPreview } from "./dynamic-pattern-preview";
import { useDynamicWidgetCount } from "./use-dynamic-section";
import { REGEX_MAX_LENGTH } from "./regex-search-panel";
import { isValidRe2Regex } from "../../~lib/validate-re2-regex";
import type { Section } from "../../~types/dashboard-types";

interface SectionDragProps {
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onDragLeave?: (e: React.DragEvent) => void;
  isDragging?: boolean;
  isDropTarget?: boolean;
  dropPosition?: "above" | "below" | "inside" | null;
}

interface SectionMoveTarget {
  label: string;
  id: string;
}

interface SectionContainerProps {
  section: Section;
  /** Number of visible widgets (after hiding empty pattern widgets). Defaults to section.widgets.length. */
  visibleWidgetCount?: number;
  onUpdate: (section: Section) => void;
  onToggleCollapse: () => void;
  onDelete: () => void;
  onAddWidget: () => void;
  onPasteWidget?: () => void;
  hasCopiedWidget?: boolean;
  /** Folders this section can be moved into (or "Top level" to move out) */
  onMoveToFolder?: (folderId: string | null) => void;
  moveFolderTargets?: SectionMoveTarget[];
  children: React.ReactNode;
  isEditing?: boolean;
  dynamicWidgetCount?: number;
  /** Report the lightweight dynamic widget count upward (for folder totals) */
  onDynamicCountChange?: (sectionId: string, count: number) => void;
  organizationId: string;
  projectName: string;
  selectedRunIds: string[];
  drag?: SectionDragProps;
}

export function SectionContainer({
  section,
  visibleWidgetCount,
  onUpdate,
  onToggleCollapse,
  onDelete,
  onAddWidget,
  onPasteWidget,
  hasCopiedWidget = false,
  onMoveToFolder,
  moveFolderTargets,
  children,
  isEditing = false,
  dynamicWidgetCount,
  onDynamicCountChange,
  organizationId,
  projectName,
  selectedRunIds,
  drag,
}: SectionContainerProps) {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editName, setEditName] = useState(section.name);
  const [editIsDynamic, setEditIsDynamic] = useState(!!section.dynamicPattern);
  const [editPattern, setEditPattern] = useState(section.dynamicPattern ?? "");
  const [editPatternMode, setEditPatternMode] = useState<"search" | "regex">(
    section.dynamicPatternMode ?? "search",
  );

  const isDynamic = !!section.dynamicPattern;

  // Lightweight count for dynamic sections — shares query cache, no widget creation
  const dynamicCount = useDynamicWidgetCount(
    isDynamic ? section.dynamicPattern : undefined,
    section.dynamicPatternMode ?? "search",
    organizationId,
    projectName,
    selectedRunIds,
  );

  // Report lightweight count upward so folder totals work even when collapsed
  useEffect(() => {
    if (isDynamic && onDynamicCountChange) {
      onDynamicCountChange(section.id, dynamicCount);
    }
  }, [isDynamic, dynamicCount, section.id, onDynamicCountChange]);

  const widgetCount = isDynamic
    ? (dynamicWidgetCount ?? dynamicCount)
    : (visibleWidgetCount ?? section.widgets.length);

  const handleToggleCollapse = () => {
    onToggleCollapse();
  };

  const handleSaveEdit = () => {
    onUpdate({
      ...section,
      name: editName,
      dynamicPattern: editIsDynamic && editPattern.trim()
        ? editPattern.trim()
        : undefined,
      dynamicPatternMode: editIsDynamic && editPattern.trim()
        ? editPatternMode
        : undefined,
    });
    setIsEditDialogOpen(false);
  };

  const handleOpenEditDialog = () => {
    setEditName(section.name);
    setEditIsDynamic(!!section.dynamicPattern);
    setEditPattern(section.dynamicPattern ?? "");
    setEditPatternMode(section.dynamicPatternMode ?? "search");
    setIsEditDialogOpen(true);
  };

  return (
    <>
      <div
        className={`relative rounded-lg border bg-card ${drag?.isDragging ? "opacity-50" : ""}`}
        data-testid="section-container"
        data-section-name={section.name}
        onDragOver={drag?.onDragOver}
        onDrop={drag?.onDrop}
        onDragLeave={drag?.onDragLeave}
      >
        {/* Drop indicator line */}
        {drag?.isDropTarget && drag.dropPosition === "above" && (
          <div className="absolute -top-[2px] left-0 right-0 z-10 h-[3px] rounded-full bg-primary" />
        )}
        {drag?.isDropTarget && drag.dropPosition === "below" && (
          <div className="absolute -bottom-[2px] left-0 right-0 z-10 h-[3px] rounded-full bg-primary" />
        )}

        <Collapsible open={!section.collapsed} onOpenChange={handleToggleCollapse}>
          <div className="flex items-center justify-between border-b px-4 py-2">
            {isEditing && drag?.onDragStart && (
              <button
                draggable
                onDragStart={drag.onDragStart}
                onDragEnd={drag.onDragEnd}
                className="mr-1 cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
                aria-label="Drag to reorder section"
              >
                <GripVerticalIcon className="size-4" />
              </button>
            )}
            <CollapsibleTrigger asChild>
              <button className="flex flex-1 items-center gap-2 text-sm font-medium hover:text-accent-foreground">
                {section.collapsed ? (
                  <ChevronRightIcon className="size-4" />
                ) : (
                  <ChevronDownIcon className="size-4" />
                )}
                <span>{section.name}</span>
                {isDynamic && (
                  <Badge variant="secondary" className="gap-1 text-xs font-normal">
                    <ZapIcon className="size-3" />
                    {section.dynamicPattern}
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs font-normal">
                  {widgetCount} widget{widgetCount !== 1 ? "s" : ""}
                </Badge>
              </button>
            </CollapsibleTrigger>

            {isEditing && (
              <div className="flex items-center gap-2">
                {!isDynamic && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddWidget();
                      }}
                    >
                      <PlusIcon className="mr-1 size-4" />
                      Add Widget
                    </Button>
                    {hasCopiedWidget && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPasteWidget?.();
                        }}
                      >
                        <ClipboardPasteIcon className="mr-1 size-4" />
                        Paste Widget
                      </Button>
                    )}
                  </>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8" data-testid="section-menu-btn">
                      <MoreHorizontalIcon className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleOpenEditDialog}>
                      <PencilIcon className="mr-2 size-4" />
                      Edit Section
                    </DropdownMenuItem>
                    {onMoveToFolder && moveFolderTargets && moveFolderTargets.length > 0 && (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <ArrowRightIcon className="mr-2 size-4" />
                          Move to...
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="max-h-60 overflow-y-auto">
                          {moveFolderTargets.map((target) => (
                            <DropdownMenuItem
                              key={target.id ?? "top-level"}
                              onClick={() => onMoveToFolder(target.id)}
                            >
                              {target.id ? (
                                <FolderIcon className="mr-2 size-3.5 text-primary/60" />
                              ) : null}
                              <span className="truncate">{target.label}</span>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => setIsDeleteDialogOpen(true)}
                    >
                      <Trash2Icon className="mr-2 size-4" />
                      Delete Section
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>

          <CollapsibleContent>
            <div className="p-4">
              {!isDynamic && section.widgets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                  <p className="mb-2">This section is empty.</p>
                  {isEditing && (
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={onAddWidget}>
                        <PlusIcon className="mr-2 size-4" />
                        Add a widget
                      </Button>
                      {hasCopiedWidget && (
                        <Button variant="outline" size="sm" onClick={onPasteWidget}>
                          <ClipboardPasteIcon className="mr-2 size-4" />
                          Paste Widget
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                children
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Edit Section Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Section</DialogTitle>
            <DialogDescription>
              Update the section name and configuration.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="section-name">Section Name</Label>
              <Input
                id="section-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="dynamic-toggle">Dynamic section</Label>
                <p className="text-xs text-muted-foreground">
                  Auto-create widgets from a pattern
                </p>
              </div>
              <Switch
                id="dynamic-toggle"
                checked={editIsDynamic}
                onCheckedChange={setEditIsDynamic}
              />
            </div>
            {editIsDynamic && (
              <DynamicPatternInput
                pattern={editPattern}
                onPatternChange={setEditPattern}
                mode={editPatternMode}
                onModeChange={setEditPatternMode}
                organizationId={organizationId}
                projectName={projectName}
                selectedRunIds={selectedRunIds}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Section</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{section.name}&quot;? This will also
              delete all widgets in this section.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={onDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Shared pattern input with Search/Regex toggle + preview
interface DynamicPatternInputProps {
  pattern: string;
  onPatternChange: (value: string) => void;
  mode: "search" | "regex";
  onModeChange: (mode: "search" | "regex") => void;
  organizationId: string;
  projectName: string;
  selectedRunIds: string[];
  onEnter?: () => void;
}

function DynamicPatternInput({
  pattern,
  onPatternChange,
  mode,
  onModeChange,
  organizationId,
  projectName,
  selectedRunIds,
  onEnter,
}: DynamicPatternInputProps) {
  const isRegex = mode === "regex";
  const isTooLong = isRegex && pattern.length > REGEX_MAX_LENGTH;
  const isNearLimit = isRegex && pattern.length > REGEX_MAX_LENGTH * 0.8;
  const isInvalidRe2 = isRegex && pattern.trim().length > 0 && !isTooLong && !isValidRe2Regex(pattern.trim());
  const hasError = isTooLong || isInvalidRe2;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <Label>Pattern</Label>
        {isNearLimit && (
          <span className={cn("text-xs", isTooLong ? "text-destructive" : "text-muted-foreground")}>
            {pattern.length}/{REGEX_MAX_LENGTH}
          </span>
        )}
      </div>
      <Tabs
        value={mode}
        onValueChange={(v) => onModeChange(v as "search" | "regex")}
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="search">Search</TabsTrigger>
          <TabsTrigger value="regex">Regex</TabsTrigger>
        </TabsList>
      </Tabs>
      <Input
        placeholder={
          mode === "search"
            ? "Search metrics and files... (use * or ? for glob)"
            : "Regex pattern... e.g. (train|val)/.+"
        }
        value={pattern}
        onChange={(e) => onPatternChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) {
            onEnter();
          }
        }}
        className={cn(hasError && "border-destructive text-destructive")}
      />
      {isTooLong && (
        <p className="text-xs text-destructive">
          Pattern too long ({pattern.length}/{REGEX_MAX_LENGTH} characters).
        </p>
      )}
      {isInvalidRe2 && (
        <p className="text-xs text-destructive">
          Invalid regex. ClickHouse uses re2 — lookaheads, backreferences, and unbalanced parentheses are not supported.
        </p>
      )}
      {!hasError && (
        <p className="text-xs text-muted-foreground">
          {mode === "search"
            ? "Fuzzy text search. Use * / ? for glob patterns (e.g., train/*)."
            : "Regex pattern matched against metric and file names."}
          {" "}Creates one widget per match. Searches selected runs only.
        </p>
      )}
      {pattern.trim() && !hasError && (
        <DynamicPatternPreview
          pattern={pattern.trim()}
          mode={mode}
          organizationId={organizationId}
          projectName={projectName}
          selectedRunIds={selectedRunIds}
        />
      )}
    </div>
  );
}

// ─── Folder container (outer grouping layer) ────────────────────────

interface FolderContainerProps {
  section: Section;
  onUpdate: (section: Section) => void;
  onToggleCollapse: () => void;
  onDelete: () => void;
  onAddChildSection: (name: string, dynamicPattern?: string, dynamicPatternMode?: "search" | "regex") => void;
  organizationId: string;
  projectName: string;
  selectedRunIds: string[];
  onAddWidget: () => void;
  onPasteWidget?: () => void;
  hasCopiedWidget?: boolean;
  /** Dynamic widget counts keyed by child section ID */
  dynamicWidgetCounts?: Record<string, number>;
  children: React.ReactNode;
  isEditing?: boolean;
  drag?: SectionDragProps;
}

export function FolderContainer({
  section,
  onUpdate,
  onToggleCollapse,
  onDelete,
  onAddChildSection,
  organizationId,
  projectName,
  selectedRunIds,
  onAddWidget,
  onPasteWidget,
  hasCopiedWidget = false,
  dynamicWidgetCounts = {},
  children,
  isEditing = false,
  drag,
}: FolderContainerProps) {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editName, setEditName] = useState(section.name);

  const childCount = section.children?.length ?? 0;
  const directWidgetCount = section.widgets.length;
  const totalWidgetCount = directWidgetCount +
    (section.children ?? []).reduce((sum, c) => {
      if (c.dynamicPattern) {
        return sum + (dynamicWidgetCounts[c.id] ?? 0);
      }
      return sum + c.widgets.length;
    }, 0);

  const handleSaveEdit = () => {
    onUpdate({ ...section, name: editName });
    setIsEditDialogOpen(false);
  };

  const handleOpenEditDialog = () => {
    setEditName(section.name);
    setIsEditDialogOpen(true);
  };

  return (
    <>
      <div
        className={cn(
          "relative rounded-lg border-2 shadow-sm transition-colors",
          drag?.isDropTarget && drag.dropPosition === "inside"
            ? "border-primary bg-primary/10"
            : "border-primary/20 bg-primary/[0.02]",
          drag?.isDragging && "opacity-50",
        )}
        data-testid="folder-container"
        data-section-name={section.name}
        onDragOver={drag?.onDragOver}
        onDrop={drag?.onDrop}
        onDragLeave={drag?.onDragLeave}
      >
        {/* Drop indicator lines for above/below reorder */}
        {drag?.isDropTarget && drag.dropPosition === "above" && (
          <div className="absolute -top-[2px] left-0 right-0 z-10 h-[3px] rounded-full bg-primary" />
        )}
        {drag?.isDropTarget && drag.dropPosition === "below" && (
          <div className="absolute -bottom-[2px] left-0 right-0 z-10 h-[3px] rounded-full bg-primary" />
        )}

        <Collapsible open={!section.collapsed} onOpenChange={onToggleCollapse}>
          <div className="flex items-center justify-between border-b border-primary/10 px-4 py-2">
            {isEditing && drag?.onDragStart && (
              <button
                draggable
                onDragStart={drag.onDragStart}
                onDragEnd={drag.onDragEnd}
                className="mr-1 cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
                aria-label="Drag to reorder folder"
              >
                <GripVerticalIcon className="size-4" />
              </button>
            )}
            <CollapsibleTrigger asChild>
              <button className="flex flex-1 items-center gap-2 text-sm font-semibold hover:text-accent-foreground">
                {section.collapsed ? (
                  <ChevronRightIcon className="size-4" />
                ) : (
                  <ChevronDownIcon className="size-4" />
                )}
                <FolderIcon className="size-4 text-primary/60" />
                <span>{section.name}</span>
                <Badge variant="outline" className="text-xs font-normal">
                  {childCount} section{childCount !== 1 ? "s" : ""}
                </Badge>
                {directWidgetCount > 0 && (
                  <Badge variant="outline" className="text-xs font-normal">
                    {directWidgetCount} widget{directWidgetCount !== 1 ? "s" : ""}
                  </Badge>
                )}
                {totalWidgetCount > 0 && (
                  <Badge variant="outline" className="text-xs font-normal">
                    {totalWidgetCount} total widget{totalWidgetCount !== 1 ? "s" : ""}
                  </Badge>
                )}
              </button>
            </CollapsibleTrigger>

            {isEditing && (
              <div className="flex items-center gap-2">
                <AddSectionButton
                  onAddSection={onAddChildSection}
                  organizationId={organizationId}
                  projectName={projectName}
                  selectedRunIds={selectedRunIds}
                  buttonVariant="ghost"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddWidget();
                  }}
                >
                  <PlusIcon className="mr-1 size-4" />
                  Add Widget
                </Button>
                {hasCopiedWidget && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPasteWidget?.();
                    }}
                  >
                    <ClipboardPasteIcon className="mr-1 size-4" />
                    Paste
                  </Button>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8" data-testid="folder-menu-btn">
                      <MoreHorizontalIcon className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleOpenEditDialog}>
                      <PencilIcon className="mr-2 size-4" />
                      Edit Folder
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => setIsDeleteDialogOpen(true)}
                    >
                      <Trash2Icon className="mr-2 size-4" />
                      Delete Folder
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>

          <CollapsibleContent>
            <div className="space-y-3 p-3">
              {childCount === 0 && directWidgetCount === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground">
                  <p className="mb-2">This folder is empty.</p>
                  {isEditing && (
                    <div className="flex items-center gap-2">
                      <AddSectionButton
                        onAddSection={onAddChildSection}
                        organizationId={organizationId}
                        projectName={projectName}
                        selectedRunIds={selectedRunIds}
                      />
                      <Button variant="outline" size="sm" onClick={onAddWidget}>
                        <PlusIcon className="mr-2 size-4" />
                        Add a widget
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                children
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Edit Folder Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Folder</DialogTitle>
            <DialogDescription>
              Update the folder name.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="folder-name">Folder Name</Label>
              <Input
                id="folder-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveEdit();
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Folder Confirmation */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Folder</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{section.name}&quot;? This will also
              delete all sections and widgets inside it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Add buttons ─────────────────────────────────────────────────────

interface AddFolderButtonProps {
  onAddFolder: (name: string) => void;
}

export function AddFolderButton({ onAddFolder }: AddFolderButtonProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [name, setName] = useState("");

  const handleCreate = () => {
    onAddFolder(name.trim() || "New Folder");
    setIsDialogOpen(false);
    setName("");
  };

  return (
    <>
      <Button variant="outline" size="sm" className="text-muted-foreground" onClick={() => setIsDialogOpen(true)}>
        <PlusIcon className="mr-1.5 size-3.5" />
        Add Folder
      </Button>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Create New Folder</DialogTitle>
            <DialogDescription>
              Create a folder to group sections together.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="new-folder-name">Folder Name</Label>
              <Input
                id="new-folder-name"
                placeholder="New Folder"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate}>Create Folder</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface AddSectionButtonProps {
  onAddSection: (name: string, dynamicPattern?: string, dynamicPatternMode?: "search" | "regex") => void;
  organizationId: string;
  projectName: string;
  selectedRunIds: string[];
  /** Button variant — "outline" (default, for bottom area) or "ghost" (for header bars) */
  buttonVariant?: "outline" | "ghost";
}

export function AddSectionButton({ onAddSection, organizationId, projectName, selectedRunIds, buttonVariant = "outline" }: AddSectionButtonProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [isDynamic, setIsDynamic] = useState(false);
  const [pattern, setPattern] = useState("");
  const [patternMode, setPatternMode] = useState<"search" | "regex">("search");

  const handleCreate = () => {
    const sectionName = name.trim() || "New Section";
    const dynamicPattern = isDynamic && pattern.trim() ? pattern.trim() : undefined;
    const mode = isDynamic && pattern.trim() ? patternMode : undefined;
    onAddSection(sectionName, dynamicPattern, mode);
    setIsDialogOpen(false);
    setName("");
    setIsDynamic(false);
    setPattern("");
    setPatternMode("search");
  };

  return (
    <>
      <Button variant={buttonVariant} size="sm" className={buttonVariant === "outline" ? "text-muted-foreground" : ""} onClick={() => setIsDialogOpen(true)}>
        <PlusIcon className="mr-1.5 size-3.5" />
        Add Section
      </Button>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Section</DialogTitle>
            <DialogDescription>
              Create a section to organize your dashboard widgets.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="new-section-name">Section Name</Label>
              <Input
                id="new-section-name"
                placeholder="New Section"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleCreate();
                  }
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="new-dynamic-toggle">Dynamic section</Label>
                <p className="text-xs text-muted-foreground">
                  Auto-create widgets from a pattern
                </p>
              </div>
              <Switch
                id="new-dynamic-toggle"
                checked={isDynamic}
                onCheckedChange={setIsDynamic}
              />
            </div>
            {isDynamic && (
              <DynamicPatternInput
                pattern={pattern}
                onPatternChange={setPattern}
                mode={patternMode}
                onModeChange={setPatternMode}
                organizationId={organizationId}
                projectName={projectName}
                selectedRunIds={selectedRunIds}
                onEnter={handleCreate}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={isDynamic && !pattern.trim()}>
              Create Section
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
