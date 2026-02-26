import { useState } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  PlusIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
  ZapIcon,
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

interface SectionContainerProps {
  section: Section;
  onUpdate: (section: Section) => void;
  onToggleCollapse: () => void;
  onDelete: () => void;
  onAddWidget: () => void;
  children: React.ReactNode;
  isEditing?: boolean;
  dynamicWidgetCount?: number;
  organizationId: string;
  projectName: string;
  selectedRunIds: string[];
}

export function SectionContainer({
  section,
  onUpdate,
  onToggleCollapse,
  onDelete,
  onAddWidget,
  children,
  isEditing = false,
  dynamicWidgetCount,
  organizationId,
  projectName,
  selectedRunIds,
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
    : section.widgets.length;

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
      <div className="rounded-lg border bg-card">
        <Collapsible open={!section.collapsed} onOpenChange={handleToggleCollapse}>
          <div className="flex items-center justify-between border-b px-4 py-2">
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
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8">
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
                    <Button variant="outline" size="sm" onClick={onAddWidget}>
                      <PlusIcon className="mr-2 size-4" />
                      Add your first widget
                    </Button>
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
        <DialogContent className="sm:max-w-[425px]">
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
        <DialogContent className="sm:max-w-[425px]">
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
