import { useState, useMemo } from "react";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import type { GroupedMetrics } from "@/lib/grouping/types";

interface MetricSelectorProps {
  groupedMetrics: GroupedMetrics;
  value: string | string[];
  onChange: (value: string | string[]) => void;
  placeholder?: string;
  multiple?: boolean;
  className?: string;
}

interface MetricOption {
  value: string;
  label: string;
  group: string;
  type: string;
}

export function MetricSelector({
  groupedMetrics,
  value,
  onChange,
  placeholder = "Select metric...",
  multiple = false,
  className,
}: MetricSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Flatten grouped metrics into a list of options
  const options = useMemo((): MetricOption[] => {
    const result: MetricOption[] = [];

    Object.entries(groupedMetrics).forEach(([groupKey, group]) => {
      group.metrics.forEach((metric) => {
        // Only include METRIC type for chart widgets
        if (metric.type === "METRIC") {
          result.push({
            value: metric.name,
            label: metric.name,
            group: group.groupName,
            type: metric.type,
          });
        }
      });
    });

    return result;
  }, [groupedMetrics]);

  // Filter options based on search (supports regex)
  const filteredOptions = useMemo(() => {
    if (!search) return options;

    try {
      // Try to use as regex if it looks like one
      const isRegex = search.startsWith("/") || search.includes("*") || search.includes(".");
      if (isRegex) {
        const pattern = search.replace(/\*/g, ".*");
        const regex = new RegExp(pattern, "i");
        return options.filter((opt) => regex.test(opt.value));
      }
    } catch {
      // Fall back to simple substring match
    }

    const lowerSearch = search.toLowerCase();
    return options.filter(
      (opt) =>
        opt.value.toLowerCase().includes(lowerSearch) ||
        opt.group.toLowerCase().includes(lowerSearch)
    );
  }, [options, search]);

  // Group filtered options by their group
  const groupedOptions = useMemo(() => {
    const groups: Record<string, MetricOption[]> = {};

    filteredOptions.forEach((opt) => {
      if (!groups[opt.group]) {
        groups[opt.group] = [];
      }
      groups[opt.group].push(opt);
    });

    return groups;
  }, [filteredOptions]);

  const selectedValues = Array.isArray(value) ? value : value ? [value] : [];

  const handleSelect = (metricValue: string) => {
    if (multiple) {
      const newValue = selectedValues.includes(metricValue)
        ? selectedValues.filter((v) => v !== metricValue)
        : [...selectedValues, metricValue];
      onChange(newValue);
    } else {
      onChange(metricValue);
      setOpen(false);
    }
  };

  const displayValue = useMemo(() => {
    if (selectedValues.length === 0) return null;

    if (multiple) {
      if (selectedValues.length === 1) {
        return selectedValues[0];
      }
      return `${selectedValues.length} metrics selected`;
    }

    return selectedValues[0];
  }, [selectedValues, multiple]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between", className)}
        >
          <span className="truncate">
            {displayValue ?? placeholder}
          </span>
          <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search metrics with regex..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-[300px]">
            <CommandEmpty>No metrics found.</CommandEmpty>
            {Object.entries(groupedOptions).map(([groupName, groupOptions]) => (
              <CommandGroup key={groupName} heading={groupName}>
                {groupOptions.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => handleSelect(option.value)}
                  >
                    <CheckIcon
                      className={cn(
                        "mr-2 size-4",
                        selectedValues.includes(option.value)
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                    />
                    <span className="truncate">{option.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
        {multiple && selectedValues.length > 0 && (
          <div className="border-t p-2">
            <div className="flex flex-wrap gap-1">
              {selectedValues.slice(0, 5).map((v) => (
                <Badge
                  key={v}
                  variant="secondary"
                  className="cursor-pointer"
                  onClick={() => handleSelect(v)}
                >
                  {v}
                  <span className="ml-1">&times;</span>
                </Badge>
              ))}
              {selectedValues.length > 5 && (
                <Badge variant="outline">
                  +{selectedValues.length - 5} more
                </Badge>
              )}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
