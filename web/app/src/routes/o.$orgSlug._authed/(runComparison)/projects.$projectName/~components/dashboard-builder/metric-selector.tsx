import { useState, useMemo, useEffect } from "react";
import { fuzzyFilter } from "@/lib/fuzzy-search";
import { CheckIcon, ChevronsUpDownIcon, Loader2Icon, TriangleAlertIcon, SparklesIcon, CircleHelpIcon, Code2 } from "lucide-react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import {
  useDistinctMetricNames,
  useRunMetricNames,
  useSearchMetricNames,
} from "../../~queries/metric-summaries";
import { isGlobValue, getGlobPattern, makeGlobValue, globToRegex, isRegexValue, getRegexPattern, isPatternValue } from "./glob-utils";

interface MetricSelectorProps {
  organizationId: string;
  projectName: string;
  value: string | string[];
  onChange: (value: string | string[]) => void;
  placeholder?: string;
  multiple?: boolean;
  className?: string;
  /** When provided, metrics not present in these runs show a warning */
  selectedRunIds?: string[];
}

export function MetricSelector({
  organizationId,
  projectName,
  value,
  onChange,
  placeholder = "Select metric...",
  multiple = false,
  className,
  selectedRunIds,
}: MetricSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Detect glob pattern (contains * or ?)
  const isGlob = search.includes("*") || search.includes("?");

  // Debounce search for server-side query
  // For globs: strip * and ? to get a loose server query (e.g. "test/*" → "test/")
  useEffect(() => {
    const timer = setTimeout(() => {
      if (isGlob) {
        setDebouncedSearch(search.replace(/[*?]/g, ""));
      } else {
        setDebouncedSearch(search);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search, isGlob]);

  // Fetch initial project-wide metrics (up to 500)
  const { data: initialMetrics, isLoading: isLoadingInitial } =
    useDistinctMetricNames(organizationId, projectName);

  // Fetch metrics scoped to selected runs (for "not present" warnings)
  const { data: runMetrics } = useRunMetricNames(
    organizationId,
    projectName,
    selectedRunIds ?? []
  );

  // Set of metrics that exist in the selected runs
  const runMetricSet = useMemo(() => {
    if (!runMetrics?.metricNames) return null;
    return new Set(runMetrics.metricNames);
  }, [runMetrics]);

  // Server-side ILIKE search when user types
  const { data: searchResults, isFetching: isSearching } =
    useSearchMetricNames(organizationId, projectName, debouncedSearch);

  // Merge initial + search results, deduplicate, then filter
  const filteredMetrics = useMemo(() => {
    const initial = initialMetrics?.metricNames ?? [];
    const searched = searchResults?.metricNames ?? [];

    const merged = Array.from(new Set([...searched, ...initial]));

    const trimmed = search.trim();
    if (!trimmed) {
      // No search — show all initial metrics alphabetically
      return merged.sort((a, b) => a.localeCompare(b));
    }

    // Glob: server already returned loose matches, now filter precisely client-side
    if (isGlob) {
      try {
        const regex = globToRegex(trimmed);
        return merged.filter((m) => regex.test(m)).sort((a, b) => a.localeCompare(b));
      } catch {
        return [];
      }
    }

    // Normal text: Fuse.js narrows down the loose backend results
    return fuzzyFilter(merged, search);
  }, [initialMetrics, searchResults, search, isGlob]);

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

  // Add a glob dynamic selection from search box
  const handleApplyGlob = () => {
    const trimmed = search.trim();
    if (!trimmed || !multiple) return;
    const globVal = makeGlobValue(trimmed);
    if (!selectedValues.includes(globVal)) {
      onChange([...selectedValues, globVal]);
    }
    setSearch("");
  };

  // Select all currently visible metrics individually
  const handleSelectAll = () => {
    if (!multiple) return;
    const newValues = [...selectedValues];
    for (const metric of filteredMetrics) {
      if (!newValues.includes(metric)) {
        newValues.push(metric);
      }
    }
    onChange(newValues);
  };

  // Count of literal (non-pattern) selected values
  const literalValues = selectedValues.filter((v) => !isPatternValue(v));
  const patternValues = selectedValues.filter((v) => isPatternValue(v));

  const displayValue = useMemo(() => {
    if (selectedValues.length === 0) return null;

    if (multiple) {
      const parts: string[] = [];
      if (literalValues.length > 0) {
        parts.push(`${literalValues.length} metric${literalValues.length !== 1 ? "s" : ""}`);
      }
      if (patternValues.length > 0) {
        parts.push(`${patternValues.length} pattern${patternValues.length !== 1 ? "s" : ""}`);
      }
      if (selectedValues.length === 1 && literalValues.length === 1) {
        return literalValues[0];
      }
      if (selectedValues.length === 1 && patternValues.length === 1) {
        const pv = patternValues[0];
        return isGlobValue(pv) ? getGlobPattern(pv) : getRegexPattern(pv);
      }
      return parts.join(" + ") + " selected";
    }

    return selectedValues[0];
  }, [selectedValues, multiple, literalValues, patternValues]);

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
              <CommandGroup heading={
                <div className="flex items-center justify-between">
                  <span>Metrics</span>
                  {multiple && search.trim() && filteredMetrics.length > 0 && (
                    <button
                      className="text-xs font-medium text-primary hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectAll();
                      }}
                    >
                      Select all
                    </button>
                  )}
                </div>
              }>
                {filteredMetrics.map((metric) => {
                  const notInRuns = runMetricSet != null && !runMetricSet.has(metric);
                  return (
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
                      <span className={cn("truncate", notInRuns && "text-muted-foreground")}>{metric}</span>
                      {notInRuns && (
                        <span
                          className="group/warn relative ml-auto shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <TriangleAlertIcon className="size-3.5 text-amber-500" />
                          <span className="pointer-events-none absolute bottom-full right-0 z-[999] mb-1.5 hidden whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-hover/warn:block">
                            Field is not present for selected run(s)
                          </span>
                        </span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
          {isLoading && filteredMetrics.length > 0 && (
            <div className="flex items-center justify-center gap-2 border-t py-2 text-xs text-muted-foreground">
              <Loader2Icon className="size-3 animate-spin" />
              Searching...
            </div>
          )}
          {/* Glob dynamic selection — shown when glob pattern detected in search */}
          {isGlob && multiple && search.trim() && (
            <div className="border-t px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <SparklesIcon className="size-3" />
                  Dynamic selection
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger asChild>
                      <CircleHelpIcon className="size-3 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="z-[999] max-w-[220px]">
                      <p className="text-xs">
                        Automatically includes any metric matching this pattern, even new ones added later.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="flex-1 rounded bg-muted px-2 py-1 text-xs">
                  {search.trim()}
                </code>
                <Button
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={handleApplyGlob}
                  disabled={selectedValues.includes(makeGlobValue(search.trim()))}
                >
                  {selectedValues.includes(makeGlobValue(search.trim())) ? "Applied" : "Apply"}
                </Button>
              </div>
            </div>
          )}
        </Command>
        {multiple && selectedValues.length > 0 && (
          <div className="border-t p-2">
            <div className="flex flex-wrap gap-1">
              {selectedValues.slice(0, 5).map((v) => {
                const isGlobVal = isGlobValue(v);
                const isRegex = isRegexValue(v);
                const isDynamic = isGlobVal || isRegex;
                return (
                  <Badge
                    key={v}
                    variant={isDynamic ? "default" : "secondary"}
                    className={cn(
                      "cursor-pointer",
                      isDynamic && "bg-primary/90 text-primary-foreground"
                    )}
                    onClick={() => handleSelect(v)}
                  >
                    {isGlobVal && <SparklesIcon className="mr-1 size-3" />}
                    {isRegex && <Code2 className="mr-1 size-3" />}
                    {isGlobVal ? getGlobPattern(v) : isRegex ? getRegexPattern(v) : v}
                    <span className="ml-1">&times;</span>
                  </Badge>
                );
              })}
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
