import { useState, useMemo, useEffect } from "react";
import { fuzzyFilter } from "@/lib/fuzzy-search";
import { CheckIcon, ChevronsUpDownIcon, Loader2Icon } from "lucide-react";
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
import {
  useDistinctMetricNames,
  useSearchMetricNames,
} from "../../~queries/metric-summaries";

interface MetricSelectorProps {
  organizationId: string;
  projectName: string;
  value: string | string[];
  onChange: (value: string | string[]) => void;
  placeholder?: string;
  multiple?: boolean;
  className?: string;
}

export function MetricSelector({
  organizationId,
  projectName,
  value,
  onChange,
  placeholder = "Select metric...",
  multiple = false,
  className,
}: MetricSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search for server-side query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch initial project-wide metrics (up to 500)
  const { data: initialMetrics, isLoading: isLoadingInitial } =
    useDistinctMetricNames(organizationId, projectName);

  // Server-side ILIKE search when user types
  const { data: searchResults, isFetching: isSearching } =
    useSearchMetricNames(organizationId, projectName, debouncedSearch);

  // Merge initial + search results, deduplicate, then Fuse.js filter
  const filteredMetrics = useMemo(() => {
    const initial = initialMetrics?.metricNames ?? [];
    const searched = searchResults?.metricNames ?? [];

    // Merge and deduplicate
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const name of [...searched, ...initial]) {
      if (!seen.has(name)) {
        seen.add(name);
        merged.push(name);
      }
    }

    if (!search.trim()) {
      // No search — show all initial metrics alphabetically
      return merged.sort((a, b) => a.localeCompare(b));
    }

    // Fuse.js narrows down the loose backend results
    return fuzzyFilter(merged, search);
  }, [initialMetrics, searchResults, search]);

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

  const isLoading = isLoadingInitial || isSearching;

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
            placeholder="Search metrics..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-[300px]">
            {isLoading && filteredMetrics.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
                Loading metrics...
              </div>
            ) : filteredMetrics.length === 0 ? (
              <CommandEmpty>No metrics found.</CommandEmpty>
            ) : (
              <CommandGroup heading="Metrics (A-Z, max 500 — search for more)">
                {filteredMetrics.map((metric) => (
                  <CommandItem
                    key={metric}
                    value={metric}
                    onSelect={() => handleSelect(metric)}
                  >
                    <CheckIcon
                      className={cn(
                        "mr-2 size-4",
                        selectedValues.includes(metric)
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                    />
                    <span className="truncate">{metric}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
          {isLoading && filteredMetrics.length > 0 && (
            <div className="flex items-center justify-center gap-2 border-t py-2 text-xs text-muted-foreground">
              <Loader2Icon className="size-3 animate-spin" />
              Searching...
            </div>
          )}
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
