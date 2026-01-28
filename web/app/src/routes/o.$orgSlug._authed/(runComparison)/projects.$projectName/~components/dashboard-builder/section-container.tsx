import { useState } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  PlusIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Section } from "../../~types/dashboard-types";

interface SectionContainerProps {
  section: Section;
  onUpdate: (section: Section) => void;
  onDelete: () => void;
  onAddWidget: () => void;
  children: React.ReactNode;
  isEditing?: boolean;
}

export function SectionContainer({
  section,
  onUpdate,
  onDelete,
  onAddWidget,
  children,
  isEditing = false,
}: SectionContainerProps) {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editName, setEditName] = useState(section.name);

  const handleToggleCollapse = () => {
    onUpdate({ ...section, collapsed: !section.collapsed });
  };

  const handleSaveEdit = () => {
    onUpdate({ ...section, name: editName });
    setIsEditDialogOpen(false);
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
                <span className="text-xs text-muted-foreground">
                  ({section.widgets.length} widgets)
                </span>
              </button>
            </CollapsibleTrigger>

            {isEditing && (
              <div className="flex items-center gap-2">
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

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8">
                      <MoreHorizontalIcon className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        setEditName(section.name);
                        setIsEditDialogOpen(true);
                      }}
                    >
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
              {section.widgets.length === 0 ? (
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
              Update the section name.
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
              Are you sure you want to delete "{section.name}"? This will also
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

interface AddSectionButtonProps {
  onAddSection: (name: string) => void;
}

export function AddSectionButton({ onAddSection }: AddSectionButtonProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [name, setName] = useState("");

  const handleCreate = () => {
    if (!name.trim()) return;
    onAddSection(name.trim());
    setIsDialogOpen(false);
    setName("");
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
                placeholder="Enter section name..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleCreate();
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!name.trim()}>
              Create Section
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
