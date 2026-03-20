import { useState } from "react";
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
import type { Section } from "../../~types/dashboard-types";

interface SectionDragProps {
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onDragLeave?: (e: React.DragEvent) => void;
  isDragging?: boolean;
  isDropTarget?: boolean;
  dropPosition?: "above" | "below" | null;
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
  children: React.ReactNode;
  isEditing?: boolean;
  dynamicWidgetCount?: number;
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
  children,
  isEditing = false,
  dynamicWidgetCount,
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
  const widgetCount = isDynamic
    ? (dynamicWidgetCount ?? 0)
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
              <button className="flex items-center gap-2 text-sm font-medium hover:text-accent-foreground">
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
                <span className="text-xs text-muted-foreground">
                  ({widgetCount} widgets)
                </span>
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
                  <p className="mb-2">No widgets in this section yet.</p>
                  {isEditing && (
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={onAddWidget}>
                        <PlusIcon className="mr-2 size-4" />
                        Add your first widget
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
  return (
    <div className="grid gap-2">
      <Label>Pattern</Label>
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
      />
      <p className="text-xs text-muted-foreground">
        {mode === "search"
          ? "Fuzzy text search. Use * / ? for glob patterns (e.g., train/*)."
          : "Regex pattern matched against metric and file names."}
        {" "}Creates one widget per match. Searches selected runs only.
      </p>
      {pattern.trim() && (
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

interface AddSectionButtonProps {
  onAddSection: (name: string, dynamicPattern?: string, dynamicPatternMode?: "search" | "regex") => void;
  organizationId: string;
  projectName: string;
  selectedRunIds: string[];
}

export function AddSectionButton({ onAddSection, organizationId, projectName, selectedRunIds }: AddSectionButtonProps) {
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
      <div className="flex items-center justify-center py-4">
        <Button variant="outline" onClick={() => setIsDialogOpen(true)}>
          <PlusIcon className="mr-2 size-4" />
          New Section
        </Button>
      </div>

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
