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
import { Check, ChevronRight, Loader2, Settings2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type ColumnConfig,
  type MetricAggregation,
  ALL_SYSTEM_COLUMNS,
} from "../../~hooks/use-column-config";

function ColumnCheckbox({ selected, size = "md" }: { selected: boolean; size?: "md" | "sm" }) {
  const s = size === "sm"
    ? "mr-2 flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-primary"
    : "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary";
  const icon = size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3";
  return (
    <div className={cn(s, selected ? "bg-primary text-primary-foreground" : "opacity-50 [&_svg]:invisible")}>
      <Check className={icon} />
    </div>
  );
}

const METRIC_AGGREGATIONS: { value: MetricAggregation; label: string }[] = [
  { value: "LAST", label: "Last" },
  { value: "MIN", label: "Min" },
  { value: "MAX", label: "Max" },
  { value: "AVG", label: "Avg" },
  { value: "VARIANCE", label: "Variance" },
];

interface ColumnPickerProps {
  columns: ColumnConfig[];
  configKeys: string[];
  systemMetadataKeys: string[];
  metricNames?: string[];
  onColumnToggle: (col: ColumnConfig) => void;
  onClearColumns: () => void;
  isLoading?: boolean;
  onColumnSearch?: (search: string) => void;
  isSearching?: boolean;
}

export function ColumnPicker({
  columns,
  configKeys,
  systemMetadataKeys,
  metricNames = [],
  onColumnToggle,
  onClearColumns,
  isLoading,
  onColumnSearch,
  isSearching,
}: ColumnPickerProps) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [expandedMetric, setExpandedMetric] = useState<string | null>(null);

  const isSearchActive = searchValue.length > 0;

  const filteredSystemCols = useMemo(
    () => isSearchActive
      ? ALL_SYSTEM_COLUMNS.filter((col) =>
          fuzzyFilter([col.label], searchValue).length > 0)
      : ALL_SYSTEM_COLUMNS,
    [isSearchActive, searchValue],
  );
  const filteredMetrics = useMemo(
    () => isSearchActive ? fuzzyFilter(metricNames, searchValue) : metricNames,
    [isSearchActive, searchValue, metricNames],
  );
  const filteredConfigKeys = useMemo(
    () => isSearchActive ? fuzzyFilter(configKeys, searchValue) : configKeys,
    [isSearchActive, searchValue, configKeys],
  );
  const filteredSysMetaKeys = useMemo(
    () => isSearchActive ? fuzzyFilter(systemMetadataKeys, searchValue) : systemMetadataKeys,
    [isSearchActive, searchValue, systemMetadataKeys],
  );

  const isSelected = (source: ColumnConfig["source"], id: string, aggregation?: MetricAggregation) =>
    columns.some((c) => c.source === source && c.id === id && c.aggregation === aggregation);

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (!isOpen) {
          setSearchValue("");
          setExpandedMetric(null);
          onColumnSearch?.("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-1",
            columns.length > 0 && "border-primary",
          )}
        >
          <Settings2 className="h-4 w-4" />
          <span className="hidden sm:inline">Columns</span>
          {columns.length > 0 && (
            <Badge
              variant="secondary"
              className="ml-1 rounded-sm px-1 font-normal"
            >
              {columns.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto min-w-[20rem] max-w-[36rem] p-0" align="end" onFocusOutside={(e) => e.preventDefault()}>
        <Command shouldFilter={false}>
          <div className="relative">
            <CommandInput
              placeholder="Search columns..."
              onValueChange={(value) => {
                setSearchValue(value);
                onColumnSearch?.(value);
              }}
            />
            {isSearching && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
          <CommandList>
            <CommandEmpty>No columns found.</CommandEmpty>

            {isSearchActive ? (
              /* Flat search results view — all matching columns in one list */
              <CommandGroup heading="Search Results">
                {filteredSystemCols.map((col) => {
                  const selected = isSelected(col.source, col.id);
                  return (
                    <CommandItem
                      key={`search:system:${col.id}`}
                      value={`system ${col.label}`}
                      onSelect={() => onColumnToggle(col)}
                    >
                      <ColumnCheckbox selected={selected} />
                      <span className="flex-1 truncate">{col.label}</span>
                      <ColumnSourceBadge source="system" />
                    </CommandItem>
                  );
                })}
                {filteredMetrics.map((name) => (
                  <MetricExpandableItem
                    key={`search:metric:${name}`}
                    metricName={name}
                    isExpanded={expandedMetric === name}
                    onExpand={() => setExpandedMetric(expandedMetric === name ? null : name)}
                    isSelected={(agg) => isSelected("metric", name, agg)}
                    onToggle={(agg) =>
                      onColumnToggle({
                        id: name,
                        source: "metric",
                        label: `${name} (${agg})`,
                        aggregation: agg,
                      })
                    }
                    showBadge={true}
                  />
                ))}
                {filteredConfigKeys.map((key) => {
                  const selected = isSelected("config", key);
                  return (
                    <CommandItem
                      key={`search:config:${key}`}
                      value={`config ${key}`}
                      onSelect={() =>
                        onColumnToggle({
                          id: key,
                          source: "config",
                          label: key,
                        })
                      }
                    >
                      <ColumnCheckbox selected={selected} />
                      <span className="flex-1 truncate font-mono text-xs">{key}</span>
                      <ColumnSourceBadge source="config" />
                    </CommandItem>
                  );
                })}
                {filteredSysMetaKeys.map((key) => {
                  const selected = isSelected("systemMetadata", key);
                  return (
                    <CommandItem
                      key={`search:sysmeta:${key}`}
                      value={`systemMetadata ${key}`}
                      onSelect={() =>
                        onColumnToggle({
                          id: key,
                          source: "systemMetadata",
                          label: key,
                        })
                      }
                    >
                      <ColumnCheckbox selected={selected} />
                      <span className="flex-1 truncate font-mono text-xs">{key}</span>
                      <ColumnSourceBadge source="systemMetadata" />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : (
              /* Default grouped view */
              <>
                {/* System Fields */}
                <CommandGroup heading="System Fields">
                  {ALL_SYSTEM_COLUMNS.map((col) => {
                    const selected = isSelected(col.source, col.id);
                    return (
                      <CommandItem
                        key={`system-${col.id}`}
                        value={`system ${col.label}`}
                        onSelect={() => onColumnToggle(col)}
                      >
                        <ColumnCheckbox selected={selected} />
                        <span className="truncate">{col.label}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>

                {/* Metrics */}
                {metricNames.length > 0 && (
                  <CommandGroup heading="Metrics (A-Z, max 500 — search for more)">
                    {metricNames.map((name) => (
                      <MetricExpandableItem
                        key={`metric-${name}`}
                        metricName={name}
                        isExpanded={expandedMetric === name}
                        onExpand={() => setExpandedMetric(expandedMetric === name ? null : name)}
                        isSelected={(agg) => isSelected("metric", name, agg)}
                        onToggle={(agg) =>
                          onColumnToggle({
                            id: name,
                            source: "metric",
                            label: `${name} (${agg})`,
                            aggregation: agg,
                          })
                        }
                      />
                    ))}
                  </CommandGroup>
                )}

                {/* Config Keys */}
                {configKeys.length > 0 && (
                  <CommandGroup heading="Config (recent 100 — search for more)">
                    {configKeys.map((key) => {
                      const selected = isSelected("config", key);
                      return (
                        <CommandItem
                          key={`config-${key}`}
                          value={`config ${key}`}
                          onSelect={() =>
                            onColumnToggle({
                              id: key,
                              source: "config",
                              label: key,
                            })
                          }
                        >
                          <ColumnCheckbox selected={selected} />
                          <span className="truncate font-mono text-xs">{key}</span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                )}

                {/* System Metadata Keys */}
                {systemMetadataKeys.length > 0 && (
                  <CommandGroup heading="System Metadata (recent 100 — search for more)">
                    {systemMetadataKeys.map((key) => {
                      const selected = isSelected("systemMetadata", key);
                      return (
                        <CommandItem
                          key={`sysmeta-${key}`}
                          value={`systemMetadata ${key}`}
                          onSelect={() =>
                            onColumnToggle({
                              id: key,
                              source: "systemMetadata",
                              label: key,
                            })
                          }
                        >
                          <ColumnCheckbox selected={selected} />
                          <span className="truncate font-mono text-xs">{key}</span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                )}

                {isLoading && (
                  <CommandGroup>
                    <CommandItem disabled>Loading keys...</CommandItem>
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
          {columns.length > 0 && (
            <>
              <CommandSeparator />
              <div className="p-2">
                <div className="mb-2 flex flex-wrap gap-1">
                  {columns.map((col) => (
                    <Badge
                      key={`${col.source}-${col.id}`}
                      variant="secondary"
                      className="max-w-full gap-1 pr-1 text-xs"
                    >
                      <span className="truncate">{col.label}</span>
                      <button
                        className="ml-1 shrink-0 rounded-full hover:bg-muted"
                        onClick={(e) => {
                          e.stopPropagation();
                          onColumnToggle(col);
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
                  onClick={onClearColumns}
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

function MetricExpandableItem({
  metricName,
  isExpanded,
  onExpand,
  isSelected,
  onToggle,
  showBadge,
}: {
  metricName: string;
  isExpanded: boolean;
  onExpand: () => void;
  isSelected: (agg: MetricAggregation) => boolean;
  onToggle: (agg: MetricAggregation) => void;
  showBadge?: boolean;
}) {
  const selectedCount = METRIC_AGGREGATIONS.filter((a) => isSelected(a.value)).length;

  return (
    <>
      <CommandItem
        value={`metric ${metricName}`}
        onSelect={onExpand}
        className="gap-1"
      >
        <ChevronRight className={cn("h-3 w-3 shrink-0 transition-transform", isExpanded && "rotate-90")} />
        <span className="flex-1 truncate font-mono text-xs">{metricName}</span>
        {selectedCount > 0 && (
          <Badge variant="secondary" className="rounded-sm px-1 text-[10px]">
            {selectedCount}
          </Badge>
        )}
        {showBadge && <ColumnSourceBadge source="metric" />}
      </CommandItem>
      {isExpanded && (
        <div className="ml-4 border-l pl-2">
          {METRIC_AGGREGATIONS.map((agg) => {
            const selected = isSelected(agg.value);
            return (
              <CommandItem
                key={`${metricName}-${agg.value}`}
                value={`metric ${metricName} ${agg.value}`}
                onSelect={() => onToggle(agg.value)}
                className="h-7 text-xs"
              >
                <ColumnCheckbox selected={selected} size="sm" />
                <span>{agg.label}</span>
              </CommandItem>
            );
          })}
        </div>
      )}
    </>
  );
}

function ColumnSourceBadge({ source }: { source: string }) {
  const labels: Record<string, string> = {
    system: "sys",
    config: "config",
    systemMetadata: "meta",
    metric: "metric",
  };
  return (
    <span className="ml-1 inline-flex rounded px-1 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
      {labels[source] ?? source}
    </span>
  );
}
