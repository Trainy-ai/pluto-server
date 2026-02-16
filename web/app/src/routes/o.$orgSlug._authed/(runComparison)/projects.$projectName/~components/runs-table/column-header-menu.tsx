import { useState, useRef, useEffect } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  MoreHorizontal,
  Pencil,
  Palette,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Subset of COLORS from color-picker for the column background tint
const COLUMN_COLORS = [
  "#FF6B6B", "#FFA94D", "#FFD43B", "#51CF66",
  "#20C997", "#22B8CF", "#339AF0", "#5C7CFA",
  "#7950F2", "#E64980", "#868E96", "#343A40",
];

export interface ColumnHeaderMenuProps {
  label: string;
  columnId: string;
  canRemove: boolean;
  canSort: boolean;
  sortDirection: "asc" | "desc" | false;
  backgroundColor?: string;
  onSort: (direction: "asc" | "desc" | false) => void;
  onRename: (newName: string) => void;
  onSetColor: (color: string | undefined) => void;
  onRemove?: () => void;
}

export function ColumnHeaderMenu({
  label,
  canRemove,
  canSort,
  sortDirection,
  backgroundColor,
  onSort,
  onRename,
  onSetColor,
  onRemove,
}: ColumnHeaderMenuProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync rename value when label changes
  useEffect(() => {
    setRenameValue(label);
  }, [label]);

  // Focus input when dialog opens
  useEffect(() => {
    if (renameOpen) {
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [renameOpen]);

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== label) {
      onRename(trimmed);
    }
    setRenameOpen(false);
  };

  return (
    <>
      <div className="flex w-full items-center gap-1 pr-5">
        <span className="truncate text-xs font-medium">{label}</span>
        {sortDirection && (
          <span className="flex-shrink-0">
            {sortDirection === "asc" ? (
              <ArrowUp className="h-3 w-3 text-primary" />
            ) : (
              <ArrowDown className="h-3 w-3 text-primary" />
            )}
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="absolute right-2.5 top-1/2 -translate-y-1/2 flex-shrink-0 rounded p-px opacity-0 transition-opacity group-hover:opacity-100 group-hover:bg-zinc-300 hover:bg-zinc-400 dark:group-hover:bg-zinc-600 dark:hover:bg-zinc-500 z-10"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {canSort && (
              <>
                <DropdownMenuItem
                  onClick={() => onSort(sortDirection === "asc" ? false : "asc")}
                >
                  <ArrowUp className="mr-2 h-4 w-4" />
                  Sort ascending
                  {sortDirection === "asc" && (
                    <span className="ml-auto text-xs text-primary">Active</span>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onSort(sortDirection === "desc" ? false : "desc")}
                >
                  <ArrowDown className="mr-2 h-4 w-4" />
                  Sort descending
                  {sortDirection === "desc" && (
                    <span className="ml-auto text-xs text-primary">Active</span>
                  )}
                </DropdownMenuItem>
                {sortDirection && (
                  <DropdownMenuItem onClick={() => onSort(false)}>
                    <ArrowUpDown className="mr-2 h-4 w-4" />
                    Clear sort
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={() => setRenameOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              Rename column
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Palette className="mr-2 h-4 w-4" />
                Background color
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="p-2">
                <div className="grid grid-cols-4 gap-1">
                  {COLUMN_COLORS.map((color) => (
                    <button
                      key={color}
                      className={cn(
                        "h-6 w-6 rounded transition-all hover:scale-110 hover:shadow-md",
                        backgroundColor === color && "ring-2 ring-ring scale-110",
                      )}
                      style={{ backgroundColor: color }}
                      onClick={() => onSetColor(color)}
                    />
                  ))}
                </div>
                {backgroundColor && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 h-7 w-full text-xs"
                    onClick={() => onSetColor(undefined)}
                  >
                    Clear color
                  </Button>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {canRemove && onRemove && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onRemove}
                  className="text-destructive focus:text-destructive"
                >
                  <X className="mr-2 h-4 w-4" />
                  Remove column
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Rename dialog — rendered outside dropdown to avoid portal issues */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename column</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleRenameSubmit();
            }}
          >
            <Input
              ref={inputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="Column name"
              className="mb-4"
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRenameOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
