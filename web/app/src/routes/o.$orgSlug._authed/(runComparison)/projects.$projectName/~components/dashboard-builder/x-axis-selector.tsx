import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import { CheckIcon, ChevronsUpDownIcon, Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDistinctMetricNames, useRunMetricNames, useSearchMetricNames } from "../../~queries/metric-summaries";
import { fuzzyFilter } from "@/lib/fuzzy-search";

interface XAxisSelectorProps {
  value: string;
  onChange: (value: string) => void;
  yMetrics: string[];
  organizationId: string;
  projectName: string;
  selectedRunIds?: string[];
}

export function XAxisSelector({
  value,
  onChange,
  yMetrics,
  organizationId,
  projectName,
  selectedRunIds,
}: XAxisSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: initialMetrics } = useDistinctMetricNames(organizationId, projectName);
  const { data: runMetrics } = useRunMetricNames(organizationId, projectName, selectedRunIds ?? []);
  const { data: searchResults, isFetching: isSearching } =
    useSearchMetricNames(organizationId, projectName, debouncedSearch);

  const customMetrics = useMemo(() => {
    const initial = initialMetrics?.metricNames ?? [];
    const searched = searchResults?.metricNames ?? [];
    const runNames = runMetrics?.metricNames ?? [];
    const merged = Array.from(new Set([...searched, ...runNames, ...initial]));
    const ySet = new Set(yMetrics);
    const filtered = merged.filter((m) => !ySet.has(m));

    const trimmed = search.trim();
    if (!trimmed) {
      return filtered.sort((a, b) => a.localeCompare(b));
    }
    return fuzzyFilter(filtered, search);
  }, [initialMetrics, searchResults, runMetrics, yMetrics, search]);

  const normalizedValue = value === "time" ? "absolute-time" : value;

  const isCustomMetric =
    normalizedValue !== "step" &&
    normalizedValue !== "absolute-time" &&
    normalizedValue !== "relative-time";

  const displayLabel = useMemo(() => {
    switch (normalizedValue) {
      case "step": return "Step";
      case "absolute-time": return "Absolute Time";
      case "relative-time": return "Relative Time";
      default: return normalizedValue;
    }
  }, [normalizedValue]);

  const builtInOptions = useMemo(() => {
    const options = [
      { value: "step", label: "Step" },
      { value: "absolute-time", label: "Absolute Time" },
      { value: "relative-time", label: "Relative Time" },
    ];
    const trimmed = search.trim();
    if (!trimmed) return options;
    const filteredLabels = fuzzyFilter(options.map((o) => o.label), trimmed);
    return options.filter((o) => filteredLabels.includes(o.label));
  }, [search]);

  const handleSelect = (selected: string) => {
    onChange(selected);
    setOpen(false);
    setSearch("");
  };

  return (
    <div className="grid gap-2">
      <Label>X-Axis</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            <span className="truncate">{displayLabel}</span>
            <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search metrics..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList className="max-h-[250px]">
              {builtInOptions.length > 0 && (
                <CommandGroup heading="Built-in">
                  {builtInOptions.map((opt) => (
                    <CommandItem
                      key={opt.value}
                      value={opt.value}
                      onSelect={() => handleSelect(opt.value)}
                    >
                      <CheckIcon
                        className={cn(
                          "mr-2 size-4",
                          normalizedValue === opt.value ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {opt.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {customMetrics.length > 0 && (
                <CommandGroup heading="Metrics (parametric)">
                  {customMetrics.map((metric) => (
                    <CommandItem
                      key={metric}
                      value={metric}
                      onSelect={() => handleSelect(metric)}
                    >
                      <CheckIcon
                        className={cn(
                          "mr-2 size-4",
                          normalizedValue === metric ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <span className="truncate">{metric}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {builtInOptions.length === 0 && customMetrics.length === 0 && (
                <CommandEmpty>No matching options.</CommandEmpty>
              )}
            </CommandList>
            {isSearching && (
              <div className="flex items-center justify-center gap-2 border-t py-2 text-xs text-muted-foreground">
                <Loader2Icon className="size-3 animate-spin" />
                Searching...
              </div>
            )}
          </Command>
        </PopoverContent>
      </Popover>
      {isCustomMetric && (
        <p className="text-xs text-muted-foreground">
          Parametric curve: plots y-metrics vs. <code className="rounded bg-muted px-1">{normalizedValue}</code>, joined by step.
        </p>
      )}
    </div>
  );
}
