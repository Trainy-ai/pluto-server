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
  CommandSeparator,
} from "@/components/ui/command";
import { Check, Filter, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface TagsFilterProps {
  allTags: string[];
  selectedTags: string[];
  onTagFilterChange: (tags: string[]) => void;
}

export function TagsFilter({
  allTags,
  selectedTags,
  onTagFilterChange,
}: TagsFilterProps) {
  const [open, setOpen] = useState(false);

  const handleTagToggle = (tag: string) => {
    if (selectedTags.includes(tag)) {
      onTagFilterChange(selectedTags.filter((t) => t !== tag));
    } else {
      onTagFilterChange([...selectedTags, tag]);
    }
  };

  const handleClearAll = () => {
    onTagFilterChange([]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-1",
            selectedTags.length > 0 && "border-primary"
          )}
        >
          <Filter className="h-4 w-4" />
          <span className="hidden sm:inline">Tags</span>
          {selectedTags.length > 0 && (
            <Badge
              variant="secondary"
              className="ml-1 rounded-sm px-1 font-normal"
            >
              {selectedTags.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="end">
        <Command>
          <CommandInput placeholder="Search tags..." />
          <CommandList>
            <CommandEmpty>No tags found.</CommandEmpty>
            <CommandGroup>
              {allTags.map((tag) => {
                const isSelected = selectedTags.includes(tag);
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
          {selectedTags.length > 0 && (
            <>
              <CommandSeparator />
              <div className="p-2">
                <div className="mb-2 flex flex-wrap gap-1">
                  {selectedTags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="gap-1 pr-1 text-xs"
                    >
                      {tag}
                      <button
                        className="ml-1 rounded-full hover:bg-muted"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTagToggle(tag);
                        }}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-full text-xs"
                  onClick={handleClearAll}
                >
                  Clear all
                </Button>
              </div>
            </>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
