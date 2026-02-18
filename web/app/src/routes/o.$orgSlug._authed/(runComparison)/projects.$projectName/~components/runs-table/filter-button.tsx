import { useState, useMemo } from "react";
import { fuzzyFilter } from "@/lib/fuzzy-search";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, ChevronRight, Filter, Loader2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunFilter, FilterableField, FilterCondition, MetricAggregation } from "@/lib/run-filters";
import { getOperatorsForType, getDefaultOperator, formatFilterChip } from "@/lib/run-filters";
import { FilterValueInput } from "./filter-value-input";

const METRIC_AGGREGATIONS: { value: MetricAggregation; label: string }[] = [
  { value: "LAST", label: "Last" },
  { value: "MIN", label: "Min" },
  { value: "MAX", label: "Max" },
  { value: "AVG", label: "Avg" },
  { value: "VARIANCE", label: "Variance" },
];

interface FilterButtonProps {
  filters: RunFilter[];
  filterableFields: FilterableField[];
  activeColumnIds?: { id: string; source: string; aggregation?: string }[];
  metricNames?: string[];
  onAddFilter: (filter: RunFilter) => void;
  onRemoveFilter: (filterId: string) => void;
  onClearFilters: () => void;
  onFieldSearch?: (search: string) => void;
  isSearching?: boolean;
}

type Step = "field" | "configure";

export function FilterButton({
  filters,
  filterableFields,
  activeColumnIds,
  metricNames = [],
  onAddFilter,
  onRemoveFilter,
  onClearFilters,
  onFieldSearch,
  isSearching,
}: FilterButtonProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("field");
  const [selectedField, setSelectedField] = useState<FilterableField | null>(null);
  const [operator, setOperator] = useState<string>("");
  const [values, setValues] = useState<unknown[]>([]);
  const [extraConditions, setExtraConditions] = useState<FilterCondition[]>([]);
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [expandedMetric, setExpandedMetric] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const [showValidation, setShowValidation] = useState(false);

  // Stable key for activeColumnIds — avoids memo invalidation on array reference changes
  const activeColumnKey = useMemo(
    () => (activeColumnIds ?? []).map((c) =>
      c.source === "metric" && c.aggregation
        ? `${c.source}:${c.id}|${c.aggregation}`
        : `${c.source}:${c.id}`
    ).join(","),
    [activeColumnIds],
  );

  // Group non-metric filterable fields
  const grouped = useMemo(() => {
    const activeKeys = new Set(activeColumnKey.split(",").filter(Boolean));
    activeKeys.add("system:name");
    activeKeys.add("system:status");

    // Build set of fields that have active filters (non-metric only)
    const filteredKeys = new Set(
      filters
        .filter((f) => f.source !== "metric")
        .map((f) => `${f.source}:${f.field}`)
    );

    const filtered: FilterableField[] = [];
    const pinned: FilterableField[] = [];
    const system: FilterableField[] = [];
    const config: FilterableField[] = [];
    const sysMeta: FilterableField[] = [];

    for (const f of filterableFields) {
      // Skip metric entries — metrics handled separately via metricNames prop
      if (f.source === "metric") continue;

      const key = `${f.source}:${f.id}`;
      if (filteredKeys.has(key)) {
        filtered.push(f);
      } else if (activeKeys.has(key)) {
        pinned.push(f);
      } else if (f.source === "system") {
        system.push(f);
      } else if (f.source === "config") {
        config.push(f);
      } else {
        sysMeta.push(f);
      }
    }

    return { filtered, pinned, system, config, sysMeta };
  }, [filterableFields, activeColumnKey, filters]);

  // Map of metricName → Set<aggregation> for metrics that have active filters
  const metricFilterInfo = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const f of filters) {
      if (f.source === "metric" && f.aggregation) {
        if (!map.has(f.field)) {
          map.set(f.field, new Set());
        }
        map.get(f.field)!.add(f.aggregation);
      }
    }
    return map;
  }, [filters]);

  const filteredFields = useMemo(() => {
    const nonMetric = filterableFields.filter((f) => f.source !== "metric");
    if (!isSearchActive) return nonMetric;
    const matchedLabels = new Set(
      fuzzyFilter(nonMetric.map((f) => f.label), searchValue),
    );
    return nonMetric.filter((f) => matchedLabels.has(f.label));
  }, [isSearchActive, searchValue, filterableFields]);
  const filteredMetrics = useMemo(
    () => isSearchActive ? fuzzyFilter(metricNames, searchValue) : metricNames,
    [isSearchActive, searchValue, metricNames],
  );

  const operators = useMemo(
    () => (selectedField ? getOperatorsForType(selectedField.dataType) : []),
    [selectedField]
  );

  const handleSelectField = (field: FilterableField) => {
    setSelectedField(field);
    const defaultOp = getDefaultOperator(field.dataType);
    setOperator(defaultOp);
    setValues([]);
    setExtraConditions([]);
    setStep("configure");
  };

  const handleSelectMetricAgg = (metricName: string, agg: MetricAggregation) => {
    const field: FilterableField = {
      id: metricName,
      source: "metric",
      label: `${metricName} (${agg})`,
      dataType: "number",
      aggregation: agg,
    };
    handleSelectField(field);
  };

  const isBetweenBoundsValid = (op: string, vals: unknown[]): boolean => {
    if ((op === "is between" || op === "is not between") && selectedField?.dataType === "number") {
      const hasMin = vals[0] != null && String(vals[0]) !== "";
      const hasMax = vals[1] != null && String(vals[1]) !== "";
      if (hasMin !== hasMax) return false;
    }
    return true;
  };

  const handleApply = () => {
    if (!selectedField) return;
    setShowValidation(true);
    // Block apply if any between operator has incomplete bounds
    if (!isBetweenBoundsValid(operator, values)) return;
    for (const cond of extraConditions) {
      if (!isBetweenBoundsValid(cond.operator, cond.values)) return;
    }
    const filter: RunFilter = {
      id: crypto.randomUUID(),
      field: selectedField.id,
      source: selectedField.source,
      dataType: selectedField.dataType,
      operator,
      values,
      ...(extraConditions.length > 0 && { conditions: extraConditions }),
      ...(selectedField.source === "metric" && selectedField.aggregation
        ? { aggregation: selectedField.aggregation }
        : {}),
    };
    onAddFilter(filter);
    handleReset();
  };

  const handleReset = () => {
    setStep("field");
    setSelectedField(null);
    setOperator("");
    setValues([]);
    setExtraConditions([]);
    setShowValidation(false);
    setOpen(false);
  };

  const handleAddCondition = () => {
    if (!selectedField) return;
    setExtraConditions((prev) => [
      ...prev,
      { operator: getDefaultOperator(selectedField.dataType), values: [] },
    ]);
  };

  const handleUpdateCondition = (index: number, updates: Partial<FilterCondition>) => {
    setExtraConditions((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...updates } : c))
    );
  };

  const handleRemoveCondition = (index: number) => {
    setExtraConditions((prev) => prev.filter((_, i) => i !== index));
  };

  const hasValue =
    values.length > 0 &&
    values.some((v) => {
      if (Array.isArray(v)) return v.length > 0;
      return v != null && v !== "";
    });

  const primaryValid =
    operator === "exists" ||
    operator === "not exists" ||
    hasValue;

  const extrasValid = extraConditions.every((c) => {
    if (c.operator === "exists" || c.operator === "not exists") return true;
    return c.values.length > 0 && c.values.some((v) => {
      if (Array.isArray(v)) return v.length > 0;
      return v != null && v !== "";
    });
  });

  const canApply = primaryValid && extrasValid;

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (!isOpen) {
          setStep("field");
          setSelectedField(null);
          setOperator("");
          setValues([]);
          setExtraConditions([]);
          setIsSearchActive(false);
          setExpandedMetric(null);
          setSearchValue("");
          onFieldSearch?.("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-1",
            filters.length > 0 && "border-primary"
          )}
        >
          <Filter className="h-4 w-4" />
          <span className="hidden sm:inline">Filter</span>
          {filters.length > 0 && (
            <Badge
              variant="secondary"
              className="ml-1 rounded-sm px-1 font-normal"
            >
              {filters.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto min-w-[20rem] max-w-[36rem] p-0" align="end">
        {step === "field" ? (
          <Command shouldFilter={false}>
            <div className="relative">
              <CommandInput
                placeholder="Search columns..."
                onValueChange={(value) => {
                  setSearchValue(value);
                  setIsSearchActive(value.length > 0);
                  onFieldSearch?.(value);
                }}
              />
              {isSearching && (
                <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
            </div>
            <CommandList className="max-h-64">
              <CommandEmpty>No columns found.</CommandEmpty>
              {isSearchActive ? (
                /* Flat search results view — non-metric fields + matching metric expandable items */
                <CommandGroup heading="Search Results">
                  {filteredFields.map((f) => {
                      const key = `${f.source}:${f.id}`;
                      const isFiltered = filters.some(
                        (fl) => `${fl.source}:${fl.field}` === key
                      );
                      return (
                        <CommandItem
                          key={`search:${key}`}
                          value={key}
                          onSelect={() => handleSelectField(f)}
                          className={cn(isFiltered && "bg-primary/5")}
                        >
                          {isFiltered && (
                            <div
                              role="button"
                              className="mr-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary bg-primary text-primary-foreground hover:bg-primary/80"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                const matchingFilters = filters.filter(
                                  (fl) => `${fl.source}:${fl.field}` === key
                                );
                                for (const fl of matchingFilters) {
                                  onRemoveFilter(fl.id);
                                }
                              }}
                            >
                              <Check className="h-3 w-3" />
                            </div>
                          )}
                          <span className={cn("flex-1", f.source !== "system" && "font-mono text-xs")}>
                            {f.label}
                          </span>
                          <SourceBadge source={f.source} />
                          <TypeBadge type={f.dataType} />
                        </CommandItem>
                      );
                    })}
                  {filteredMetrics.map((name) => (
                    <FilterMetricExpandableItem
                      key={`search:metric:${name}`}
                      metricName={name}
                      isExpanded={expandedMetric === name}
                      onExpand={() => setExpandedMetric(expandedMetric === name ? null : name)}
                      activeAggregations={metricFilterInfo.get(name)}
                      onSelectAgg={(agg) => handleSelectMetricAgg(name, agg)}
                      showBadge={true}
                    />
                  ))}
                </CommandGroup>
              ) : (
                /* Default grouped view */
                <>
                  {grouped.filtered.length > 0 && (
                    <CommandGroup heading="Filtered">
                      {grouped.filtered.map((f) => {
                        const key = `${f.source}:${f.id}`;
                        const matchingFilters = filters.filter(
                          (fl) => `${fl.source}:${fl.field}` === key
                        );
                        return (
                          <CommandItem
                            key={`filtered:${key}`}
                            value={key}
                            onSelect={() => handleSelectField(f)}
                            className="bg-primary/5"
                          >
                            <div
                              role="button"
                              className="mr-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary bg-primary text-primary-foreground hover:bg-primary/80"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                for (const fl of matchingFilters) {
                                  onRemoveFilter(fl.id);
                                }
                              }}
                            >
                              <Check className="h-3 w-3" />
                            </div>
                            <span className={cn("flex-1", f.source !== "system" && "font-mono text-xs")}>
                              {f.label}
                            </span>
                            <TypeBadge type={f.dataType} />
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  )}
                  {grouped.pinned.length > 0 && (
                    <CommandGroup heading="Active Columns">
                      {grouped.pinned.map((f) => {
                        const key = `${f.source}:${f.id}`;
                        return (
                          <CommandItem
                            key={`pinned:${key}`}
                            value={key}
                            onSelect={() => handleSelectField(f)}
                          >
                            <span className={cn("flex-1", f.source !== "system" && "font-mono text-xs")}>
                              {f.label}
                            </span>
                            <TypeBadge type={f.dataType} />
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  )}
                  {grouped.system.length > 0 && (
                    <CommandGroup heading="System">
                      {grouped.system.map((f) => (
                        <CommandItem
                          key={`${f.source}:${f.id}`}
                          value={`${f.source}:${f.id}`}
                          onSelect={() => handleSelectField(f)}
                        >
                          <span className="flex-1">{f.label}</span>
                          <TypeBadge type={f.dataType} />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                  {metricNames.length > 0 && (
                    <CommandGroup heading="Metrics (A-Z, max 500 — search for more)">
                      {metricNames.map((name) => (
                        <FilterMetricExpandableItem
                          key={`metric-${name}`}
                          metricName={name}
                          isExpanded={expandedMetric === name}
                          onExpand={() => setExpandedMetric(expandedMetric === name ? null : name)}
                          activeAggregations={metricFilterInfo.get(name)}
                          onSelectAgg={(agg) => handleSelectMetricAgg(name, agg)}
                        />
                      ))}
                    </CommandGroup>
                  )}
                  {grouped.config.length > 0 && (
                    <CommandGroup heading="Config (recent 100 — search for more)">
                      {grouped.config.map((f) => (
                        <CommandItem
                          key={`${f.source}:${f.id}`}
                          value={`${f.source}:${f.id}`}
                          onSelect={() => handleSelectField(f)}
                        >
                          <span className="flex-1 font-mono text-xs">{f.label}</span>
                          <TypeBadge type={f.dataType} />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                  {grouped.sysMeta.length > 0 && (
                    <CommandGroup heading="System Metadata (recent 100 — search for more)">
                      {grouped.sysMeta.map((f) => (
                        <CommandItem
                          key={`${f.source}:${f.id}`}
                          value={`${f.source}:${f.id}`}
                          onSelect={() => handleSelectField(f)}
                        >
                          <span className="flex-1 font-mono text-xs">{f.label}</span>
                          <TypeBadge type={f.dataType} />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </>
              )}
            </CommandList>
            {filters.length > 0 && (
              <>
                <CommandSeparator />
                <div className="p-2">
                  <div className="mb-2 flex flex-wrap gap-1">
                    {filters.map((filter) => (
                      <Badge
                        key={filter.id}
                        variant="secondary"
                        className="max-w-full gap-1 pr-1 text-xs"
                      >
                        <span className="truncate">{formatFilterChip(filter)}</span>
                        <button
                          className="ml-1 shrink-0 rounded-full hover:bg-muted"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveFilter(filter.id);
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
                    onClick={onClearFilters}
                  >
                    Clear all
                  </Button>
                </div>
              </>
            )}
          </Command>
        ) : (
          <div className="space-y-3 p-3">
            <div className="text-sm font-medium">
              {selectedField?.label}
              <TypeBadge type={selectedField?.dataType ?? "text"} className="ml-2" />
            </div>

            {/* Primary condition */}
            <Select value={operator} onValueChange={(v) => { setOperator(v); setShowValidation(false); }}>
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {operators.map((op) => (
                  <SelectItem key={op.value} value={op.value}>
                    {op.label}
                  </SelectItem>
                ))}
                <SelectItem value="exists">exists</SelectItem>
                <SelectItem value="not exists">not exists</SelectItem>
              </SelectContent>
            </Select>

            <FilterValueInput
              dataType={selectedField?.dataType ?? "text"}
              operator={operator}
              values={values}
              onChange={(v) => { setValues(v); setShowValidation(false); }}
              options={selectedField?.options}
              showValidation={showValidation}
            />

            {/* Extra AND conditions */}
            {extraConditions.map((cond, idx) => (
              <div key={idx} className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-[10px] font-medium uppercase text-muted-foreground">and</span>
                  <div className="h-px flex-1 bg-border" />
                  <button
                    type="button"
                    className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => handleRemoveCondition(idx)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <Select
                  value={cond.operator}
                  onValueChange={(op) => { handleUpdateCondition(idx, { operator: op }); setShowValidation(false); }}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {operators.map((op) => (
                      <SelectItem key={op.value} value={op.value}>
                        {op.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="exists">exists</SelectItem>
                    <SelectItem value="not exists">not exists</SelectItem>
                  </SelectContent>
                </Select>
                <FilterValueInput
                  dataType={selectedField?.dataType ?? "text"}
                  operator={cond.operator}
                  values={cond.values}
                  onChange={(v) => { handleUpdateCondition(idx, { values: v }); setShowValidation(false); }}
                  options={selectedField?.options}
                  showValidation={showValidation}
                />
              </div>
            ))}

            {/* Actions */}
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-muted-foreground"
                onClick={handleAddCondition}
              >
                <Plus className="h-3 w-3" />
                AND
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7"
                  onClick={() => {
                    setStep("field");
                    setSelectedField(null);
                    setExtraConditions([]);
                  }}
                >
                  Back
                </Button>
                <Button
                  size="sm"
                  className="h-7"
                  disabled={!canApply}
                  onClick={handleApply}
                >
                  Apply
                </Button>
              </div>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function FilterMetricExpandableItem({
  metricName,
  isExpanded,
  onExpand,
  activeAggregations,
  onSelectAgg,
  showBadge,
}: {
  metricName: string;
  isExpanded: boolean;
  onExpand: () => void;
  activeAggregations?: Set<string>;
  onSelectAgg: (agg: MetricAggregation) => void;
  showBadge?: boolean;
}) {
  const activeCount = activeAggregations?.size ?? 0;

  return (
    <>
      <CommandItem
        value={`metric ${metricName}`}
        onSelect={onExpand}
        className="gap-1"
      >
        <ChevronRight className={cn("h-3 w-3 shrink-0 transition-transform", isExpanded && "rotate-90")} />
        <span className="flex-1 truncate font-mono text-xs">{metricName}</span>
        {activeCount > 0 && (
          <Badge variant="secondary" className="rounded-sm px-1 text-[10px]">
            {activeCount}
          </Badge>
        )}
        {showBadge && <SourceBadge source="metric" />}
      </CommandItem>
      {isExpanded && (
        <div className="ml-4 border-l pl-2">
          {METRIC_AGGREGATIONS.map((agg) => {
            const isActive = activeAggregations?.has(agg.value) ?? false;
            return (
              <CommandItem
                key={`${metricName}-${agg.value}`}
                value={`metric ${metricName} ${agg.value}`}
                onSelect={() => onSelectAgg(agg.value)}
                className="h-7 text-xs"
              >
                {isActive && (
                  <Check className="mr-2 h-3 w-3 shrink-0 text-primary" />
                )}
                <span>{agg.label}</span>
              </CommandItem>
            );
          })}
        </div>
      )}
    </>
  );
}

function SourceBadge({ source }: { source: string }) {
  const labels: Record<string, string> = {
    system: "sys",
    config: "config",
    systemMetadata: "meta",
    metric: "metric",
  };
  return (
    <span className="mr-1 inline-flex rounded px-1 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
      {labels[source] ?? source}
    </span>
  );
}

function TypeBadge({ type, className }: { type: string; className?: string }) {
  const colors: Record<string, string> = {
    text: "bg-blue-500/10 text-blue-600",
    number: "bg-green-500/10 text-green-600",
    date: "bg-purple-500/10 text-purple-600",
    option: "bg-orange-500/10 text-orange-600",
    multiOption: "bg-pink-500/10 text-pink-600",
  };
  return (
    <span
      className={cn(
        "inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium",
        colors[type] ?? "bg-muted text-muted-foreground",
        className
      )}
    >
      {type === "multiOption" ? "multi" : type}
    </span>
  );
}
