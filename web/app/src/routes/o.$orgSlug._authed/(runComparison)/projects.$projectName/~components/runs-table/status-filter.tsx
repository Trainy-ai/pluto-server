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
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Check, CircleDot, X } from "lucide-react";
import { cn } from "@/lib/utils";

const RUN_STATUSES = [
  { value: "RUNNING", label: "Running", color: "bg-blue-500" },
  { value: "COMPLETED", label: "Completed", color: "bg-green-500" },
  { value: "FAILED", label: "Failed", color: "bg-red-500" },
  { value: "TERMINATED", label: "Terminated", color: "bg-orange-500" },
  { value: "CANCELLED", label: "Cancelled", color: "bg-gray-500" },
] as const;

interface StatusFilterProps {
  selectedStatuses: string[];
  onStatusFilterChange: (statuses: string[]) => void;
}

export function StatusFilter({
  selectedStatuses,
  onStatusFilterChange,
}: StatusFilterProps) {
  const [open, setOpen] = useState(false);

  const handleStatusToggle = (status: string) => {
    if (selectedStatuses.includes(status)) {
      onStatusFilterChange(selectedStatuses.filter((s) => s !== status));
    } else {
      onStatusFilterChange([...selectedStatuses, status]);
    }
  };

  const handleClearAll = () => {
    onStatusFilterChange([]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-1",
            selectedStatuses.length > 0 && "border-primary"
          )}
        >
          <CircleDot className="h-4 w-4" />
          <span className="hidden sm:inline">Status</span>
          {selectedStatuses.length > 0 && (
            <Badge
              variant="secondary"
              className="ml-1 rounded-sm px-1 font-normal"
            >
              {selectedStatuses.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-0" align="end">
        <Command>
          <CommandList>
            <CommandGroup>
              {RUN_STATUSES.map((status) => {
                const isSelected = selectedStatuses.includes(status.value);
                return (
                  <CommandItem
                    key={status.value}
                    value={status.value}
                    onSelect={() => handleStatusToggle(status.value)}
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
                    <div className={cn("mr-2 h-2 w-2 rounded-full", status.color)} />
                    <span>{status.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          {selectedStatuses.length > 0 && (
            <>
              <CommandSeparator />
              <div className="p-2">
                <div className="mb-2 flex flex-wrap gap-1">
                  {selectedStatuses.map((status) => {
                    const statusConfig = RUN_STATUSES.find((s) => s.value === status);
                    return (
                      <Badge
                        key={status}
                        variant="secondary"
                        className="gap-1 pr-1 text-xs"
                      >
                        {statusConfig?.label || status}
                        <button
                          className="ml-1 rounded-full hover:bg-muted"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStatusToggle(status);
                          }}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })}
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
