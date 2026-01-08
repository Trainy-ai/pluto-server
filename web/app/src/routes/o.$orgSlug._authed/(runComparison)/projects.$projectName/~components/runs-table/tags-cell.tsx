import { useState } from "react";
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

interface TagsCellProps {
  tags: string[];
  allTags: string[];
  onTagsUpdate: (tags: string[]) => void;
}

export function TagsCell({ tags, allTags, onTagsUpdate }: TagsCellProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");

  const handleTagToggle = (tag: string) => {
    if (tags.includes(tag)) {
      onTagsUpdate(tags.filter((t) => t !== tag));
    } else {
      onTagsUpdate([...tags, tag]);
    }
  };

  const handleAddNewTag = () => {
    const trimmedValue = inputValue.trim();
    if (trimmedValue && !tags.includes(trimmedValue)) {
      onTagsUpdate([...tags, trimmedValue]);
      setInputValue("");
    }
  };

  const handleRemoveTag = (e: React.MouseEvent, tag: string) => {
    e.stopPropagation();
    onTagsUpdate(tags.filter((t) => t !== tag));
  };

  // Combine all tags with current tags for the dropdown
  const availableTags = [...new Set([...allTags, ...tags])].sort();

  return (
    <div className="flex items-center gap-1">
      <div className="flex flex-wrap items-center gap-1 overflow-hidden">
        {tags.slice(0, 2).map((tag) => (
          <Badge
            key={tag}
            variant="secondary"
            className="max-w-[80px] truncate text-xs"
          >
            {tag}
          </Badge>
        ))}
        {tags.length > 2 && (
          <Badge variant="outline" className="text-xs">
            +{tags.length - 2}
          </Badge>
        )}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-64 p-0"
          align="start"
          onClick={(e) => e.stopPropagation()}
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
                  "No tags found."
                )}
              </CommandEmpty>
              <CommandGroup>
                {availableTags.map((tag) => {
                  const isSelected = tags.includes(tag);
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
            </CommandList>
          </Command>
          {tags.length > 0 && (
            <div className="border-t p-2">
              <div className="text-xs text-muted-foreground mb-1">
                Current tags:
              </div>
              <div className="flex flex-wrap gap-1">
                {tags.map((tag) => (
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
        </PopoverContent>
      </Popover>
    </div>
  );
}
