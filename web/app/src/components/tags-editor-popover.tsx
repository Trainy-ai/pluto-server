import { useState, useEffect, useCallback, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";
import { LinearIssuePicker } from "@/components/linear-issue-picker";

interface TagsEditorPopoverProps {
  /** Current tags */
  tags: string[];
  /** All available tags for suggestions (optional) */
  allTags?: string[];
  /** Callback when tags are updated */
  onTagsUpdate: (tags: string[]) => void;
  /** The trigger element (button) to open the popover */
  trigger: ReactNode;
  /** Whether to stop propagation on popover content clicks */
  stopPropagation?: boolean;
  /** Custom empty state text when no tags and no input */
  emptyText?: string;
  /** Alignment of the popover */
  align?: "start" | "center" | "end";
  /** Organization ID for Linear integration (optional) */
  organizationId?: string;
}

export function TagsEditorPopover({
  tags,
  allTags = [],
  onTagsUpdate,
  trigger,
  stopPropagation = false,
  emptyText = "No tags found.",
  align = "start",
  organizationId,
}: TagsEditorPopoverProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  // Local state for pending tag changes (batch updates)
  const [pendingTags, setPendingTags] = useState<string[]>(tags);
  const [hasChanges, setHasChanges] = useState(false);

  // Sync pendingTags with tags prop when popover opens or tags change externally
  useEffect(() => {
    if (!open) {
      setPendingTags(tags);
      setHasChanges(false);
    }
  }, [tags, open]);

  // Check if there are pending changes
  useEffect(() => {
    const tagsSet = new Set(tags);
    const pendingSet = new Set(pendingTags);
    const isDifferent =
      tags.length !== pendingTags.length ||
      tags.some((tag) => !pendingSet.has(tag)) ||
      pendingTags.some((tag) => !tagsSet.has(tag));
    setHasChanges(isDifferent);
  }, [tags, pendingTags]);

  const handleTagToggle = (tag: string) => {
    if (pendingTags.includes(tag)) {
      setPendingTags(pendingTags.filter((t) => t !== tag));
    } else {
      setPendingTags([...pendingTags, tag]);
    }
  };

  const handleAddNewTag = () => {
    const trimmedValue = inputValue.trim();
    if (trimmedValue && !pendingTags.includes(trimmedValue)) {
      setPendingTags([...pendingTags, trimmedValue]);
      setInputValue("");
    }
  };

  const handleRemoveTag = (e: React.MouseEvent, tag: string) => {
    e.stopPropagation();
    setPendingTags(pendingTags.filter((t) => t !== tag));
  };

  const handleApply = useCallback(() => {
    if (hasChanges) {
      onTagsUpdate(pendingTags);
    }
    setOpen(false);
  }, [hasChanges, pendingTags, onTagsUpdate]);

  const handleCancel = useCallback(() => {
    setPendingTags(tags);
    setHasChanges(false);
    setOpen(false);
  }, [tags]);

  // Check if Linear integration is configured
  const { data: linearIntegration } = useQuery(
    trpc.organization.integrations.getLinearIntegration.queryOptions(
      { organizationId: organizationId! },
      { enabled: !!organizationId },
    ),
  );

  const linearConfigured = linearIntegration?.configured && linearIntegration?.enabled;

  // Combine all tags with current tags for the dropdown
  const availableTags = [...new Set([...allTags, ...tags, ...pendingTags])].sort();

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && hasChanges) {
          // Apply changes when closing the popover
          onTagsUpdate(pendingTags);
        }
        setOpen(isOpen);
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className="w-64 p-0"
        align={align}
        onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
      >
        <Command>
          <CommandInput
            placeholder="Search or add tag..."
            value={inputValue}
            onValueChange={setInputValue}
            onKeyDown={(e) => {
              if (e.key === "Enter" && inputValue.trim()) {
                e.preventDefault();
                handleAddNewTag();
              }
            }}
          />
          <CommandList>
            <CommandEmpty>
              {inputValue.trim() ? (
                <button
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent"
                  onClick={handleAddNewTag}
                >
                  <Plus className="h-4 w-4" />
                  Create "{inputValue.trim()}"
                </button>
              ) : (
                emptyText
              )}
            </CommandEmpty>
            <CommandGroup>
              {availableTags.map((tag) => {
                const isSelected = pendingTags.includes(tag);
                return (
                  <CommandItem
                    key={tag}
                    value={tag}
                    onSelect={() => handleTagToggle(tag)}
                  >
                    <div
                      className={cn(
                        "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "opacity-50 [&_svg]:invisible"
                      )}
                    >
                      <Check className="h-3 w-3" />
                    </div>
                    <span className="truncate">{tag}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {linearConfigured && organizationId && inputValue.trim() && (
              <LinearIssuePicker
                organizationId={organizationId}
                searchQuery={inputValue.trim()}
                selectedTags={pendingTags}
                onSelectIssue={(identifier) => {
                  const tag = `linear:${identifier}`;
                  if (!pendingTags.includes(tag)) {
                    setPendingTags([...pendingTags, tag]);
                  }
                  setInputValue("");
                }}
              />
            )}
          </CommandList>
        </Command>
        {pendingTags.length > 0 && (
          <div className="border-t p-2">
            <div className="text-xs text-muted-foreground mb-1">
              {hasChanges ? "Pending tags:" : "Current tags:"}
            </div>
            <div className="flex flex-wrap gap-1">
              {pendingTags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="gap-1 pr-1 text-xs"
                >
                  {tag}
                  <button
                    className="ml-1 rounded-full hover:bg-muted"
                    onClick={(e) => handleRemoveTag(e, tag)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        )}
        {hasChanges && (
          <div className="border-t p-2 flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleApply}>
              Apply
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
