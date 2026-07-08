import { useMemo, useState } from "react";

/** Maximum nesting depth allowed in groupBy. Capping this bounds the
 *  upper-bound runs-table data fetch: with footer page size capped at
 *  100, each nested bucket level capped at 10, and runs-per-leaf
 *  capped at 10, depth N produces at most `100 × 10^N × 10` rows when
 *  every visible bucket is expanded. We cap at 5 so the worst case
 *  stays at 100 × 10⁴ × 10 = 10M (theoretical only — actual is
 *  user-click-bound). Beyond this, the bucket tree gets visually
 *  cramped (depth-based padding eats screen width) and probe queries
 *  start to dominate. */
const MAX_GROUP_BY_DEPTH = 5;
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
} from "@/components/ui/command";
import { Group, Plus, X, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SUPPORTED_SYSTEM_GROUP_FIELDS,
  SUPPORTED_TAG_PREFIXES,
  SYSTEM_FIELD_LABELS,
  TAG_PREFIX_LABELS,
  encodeGroupField,
  groupFieldLabel,
  groupFieldSourceLabel,
} from "./group-by-utils";

interface GroupByPickerProps {
  /** Ordered list of encoded group fields — `system:status`, `config:lr`,
   *  `tag-prefix:group`, etc. Empty = no grouping. */
  groupBy: string[];
  onGroupByChange: (groupBy: string[]) => void;
  /** Recent config / systemMetadata keys for the project — already
   *  capped at 100 by the server. The picker lists these as choices. */
  configKeys: string[];
  systemMetadataKeys: string[];
}

/** Source badge for a single picker row. */
function GroupFieldBadge({ source }: { source: string }) {
  const cls =
    source === "system"
      ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
      : source === "config"
        ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
        : source === "sysmeta"
          ? "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
          : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
  return (
    <Badge variant="secondary" className={cn("ml-2 shrink-0 text-[10px]", cls)}>
      {source}
    </Badge>
  );
}

interface FieldPickerInlineProps {
  /** Fields already in the chip stack — disabled in the menu so users
   *  can't add the same field twice. */
  excluded: Set<string>;
  /** Called once the user picks a field. */
  onPick: (field: string) => void;
  configKeys: string[];
  systemMetadataKeys: string[];
  /** Closes the surrounding popover after a pick. */
  onClose: () => void;
}

/** Reusable field picker — same body used both when adding a new chip
 *  and when replacing an existing chip's field. */
function FieldPickerInline({
  excluded,
  onPick,
  configKeys,
  systemMetadataKeys,
  onClose,
}: FieldPickerInlineProps) {
  const [search, setSearch] = useState("");
  const isSearchActive = search.length > 0;

  const systemFields = useMemo(() => {
    const all = SUPPORTED_SYSTEM_GROUP_FIELDS.map((key) => ({
      field: encodeGroupField("system", key),
      label: SYSTEM_FIELD_LABELS[key] ?? key,
    }));
    if (!isSearchActive) return all;
    return all.filter((f) => fuzzyFilter([f.label], search).length > 0);
  }, [isSearchActive, search]);

  const tagPrefixes = useMemo(() => {
    const all = SUPPORTED_TAG_PREFIXES.map((key) => ({
      field: encodeGroupField("tag-prefix", key),
      label: TAG_PREFIX_LABELS[key] ?? key,
    }));
    if (!isSearchActive) return all;
    return all.filter((f) => fuzzyFilter([f.label], search).length > 0);
  }, [isSearchActive, search]);

  const filteredConfig = useMemo(() => {
    if (!isSearchActive) return configKeys;
    return fuzzyFilter(configKeys, search);
  }, [isSearchActive, search, configKeys]);

  const filteredSysMeta = useMemo(() => {
    if (!isSearchActive) return systemMetadataKeys;
    return fuzzyFilter(systemMetadataKeys, search);
  }, [isSearchActive, search, systemMetadataKeys]);

  function pick(field: string) {
    if (excluded.has(field)) return;
    onPick(field);
    setSearch("");
    onClose();
  }

  return (
    <Command shouldFilter={false}>
      <CommandInput
        placeholder="Search fields..."
        value={search}
        onValueChange={setSearch}
        autoFocus
      />
      <CommandList className="max-h-[20rem]">
        <CommandEmpty>No fields found.</CommandEmpty>

        {systemFields.length > 0 && (
          <CommandGroup heading="System">
            {systemFields.map(({ field, label }) => (
              <CommandItem
                key={field}
                value={`system ${label}`}
                onSelect={() => pick(field)}
                disabled={excluded.has(field)}
                className={cn(excluded.has(field) && "opacity-50")}
              >
                <span className="flex-1 truncate">{label}</span>
                <GroupFieldBadge source="system" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {tagPrefixes.length > 0 && (
          <CommandGroup heading="Tag-derived">
            {tagPrefixes.map(({ field, label }) => (
              <CommandItem
                key={field}
                value={`tag ${label}`}
                onSelect={() => pick(field)}
                disabled={excluded.has(field)}
                className={cn(excluded.has(field) && "opacity-50")}
              >
                <span className="flex-1 truncate">{label}</span>
                <GroupFieldBadge source="tag" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {filteredConfig.length > 0 && (
          <CommandGroup heading="Config (recent 100 — search for more)">
            {filteredConfig.map((key) => {
              const field = encodeGroupField("config", key);
              return (
                <CommandItem
                  key={field}
                  value={`config ${key}`}
                  onSelect={() => pick(field)}
                  disabled={excluded.has(field)}
                  className={cn(excluded.has(field) && "opacity-50")}
                >
                  <span className="flex-1 truncate font-mono text-xs">{key}</span>
                  <GroupFieldBadge source="config" />
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {filteredSysMeta.length > 0 && (
          <CommandGroup heading="System metadata (recent 100 — search for more)">
            {filteredSysMeta.map((key) => {
              const field = encodeGroupField("systemMetadata", key);
              return (
                <CommandItem
                  key={field}
                  value={`sysmeta ${key}`}
                  onSelect={() => pick(field)}
                  disabled={excluded.has(field)}
                  className={cn(excluded.has(field) && "opacity-50")}
                >
                  <span className="flex-1 truncate font-mono text-xs">{key}</span>
                  <GroupFieldBadge source="sysmeta" />
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

/** A single chip in the grouping stack. Clicking the field name swaps
 *  in the field picker so the user can replace this level; clicking ✕
 *  removes the level entirely. */
function GroupingChip({
  field,
  index,
  onRemove,
  onReplace,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  excluded,
  configKeys,
  systemMetadataKeys,
}: {
  field: string;
  index: number;
  onRemove: () => void;
  onReplace: (newField: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  excluded: Set<string>;
  configKeys: string[];
  systemMetadataKeys: string[];
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div
      className="group/chip flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1"
      data-testid={`grouping-chip-${index}`}
    >
      <span className="text-xs font-medium text-muted-foreground">{index + 1}.</span>
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left text-sm hover:bg-accent"
            aria-label={`Change grouping field for level ${index + 1}`}
          >
            <span className="truncate">{groupFieldLabel(field)}</span>
            <GroupFieldBadge source={groupFieldSourceLabel(field)} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[22rem] p-0" align="start">
          <FieldPickerInline
            // Exclude OTHER chip fields but allow re-picking this one
            // (so the menu doesn't immediately look broken when opened).
            excluded={new Set([...excluded].filter((f) => f !== field))}
            onPick={onReplace}
            onClose={() => setPickerOpen(false)}
            configKeys={configKeys}
            systemMetadataKeys={systemMetadataKeys}
          />
        </PopoverContent>
      </Popover>
      <div className="flex shrink-0 items-center">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onMoveUp}
          disabled={!canMoveUp}
          aria-label={`Move level ${index + 1} up`}
        >
          <ChevronUp className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onMoveDown}
          disabled={!canMoveDown}
          aria-label={`Move level ${index + 1} down`}
        >
          <ChevronDown className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label={`Remove grouping level ${index + 1}`}
          data-testid={`grouping-chip-remove-${index}`}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

export function GroupByPicker({
  groupBy,
  onGroupByChange,
  configKeys,
  systemMetadataKeys,
}: GroupByPickerProps) {
  const [open, setOpen] = useState(false);
  const [adderOpen, setAdderOpen] = useState(false);

  const excluded = useMemo(() => new Set(groupBy), [groupBy]);

  function addField(field: string) {
    if (excluded.has(field)) return;
    // Hard cap — UI gate. The button below is disabled at the same
    // threshold; this guard catches programmatic / drag-and-drop
    // additions that bypass the button.
    if (groupBy.length >= MAX_GROUP_BY_DEPTH) return;
    onGroupByChange([...groupBy, field]);
  }
  const atDepthCap = groupBy.length >= MAX_GROUP_BY_DEPTH;

  function removeAt(index: number) {
    onGroupByChange(groupBy.filter((_, i) => i !== index));
  }

  function replaceAt(index: number, newField: string) {
    if (groupBy[index] === newField) return;
    if (excluded.has(newField)) return;
    const next = [...groupBy];
    next[index] = newField;
    onGroupByChange(next);
  }

  function moveBy(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= groupBy.length) return;
    const next = [...groupBy];
    [next[index], next[target]] = [next[target], next[index]];
    onGroupByChange(next);
  }

  const active = groupBy.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-9 gap-1", active && "border-primary")}
          data-testid="group-by-picker-trigger"
        >
          <Group className="h-4 w-4" />
          <span className="hidden sm:inline">Group</span>
          {active && (
            <Badge variant="secondary" className="ml-1 rounded-sm px-1 font-normal">
              {groupBy.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[26rem] p-3"
        align="end"
        data-testid="group-by-picker-content"
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Group runs by</span>
          {active && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onGroupByChange([])}
              data-testid="group-by-picker-clear"
            >
              Clear
            </Button>
          )}
        </div>

        {groupBy.length === 0 ? (
          <p className="mb-3 text-xs text-muted-foreground">
            No grouping. Add a field below to group runs into buckets.
          </p>
        ) : (
          <div className="mb-3 space-y-1.5">
            {groupBy.map((field, i) => (
              <GroupingChip
                key={`${field}-${i}`}
                field={field}
                index={i}
                excluded={excluded}
                configKeys={configKeys}
                systemMetadataKeys={systemMetadataKeys}
                onRemove={() => removeAt(i)}
                onReplace={(newField) => replaceAt(i, newField)}
                onMoveUp={() => moveBy(i, -1)}
                onMoveDown={() => moveBy(i, 1)}
                canMoveUp={i > 0}
                canMoveDown={i < groupBy.length - 1}
              />
            ))}
          </div>
        )}

        <Popover
          open={adderOpen && !atDepthCap}
          onOpenChange={(o) => {
            if (atDepthCap) return;
            setAdderOpen(o);
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-1"
              data-testid="group-by-picker-add"
              disabled={atDepthCap}
              title={atDepthCap ? `Max ${MAX_GROUP_BY_DEPTH} grouping fields` : undefined}
            >
              <Plus className="h-4 w-4" />
              <span>
                {atDepthCap
                  ? `Max ${MAX_GROUP_BY_DEPTH} grouping fields`
                  : "Add grouping field"}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[22rem] p-0" align="start">
            <FieldPickerInline
              excluded={excluded}
              onPick={addField}
              onClose={() => setAdderOpen(false)}
              configKeys={configKeys}
              systemMetadataKeys={systemMetadataKeys}
            />
          </PopoverContent>
        </Popover>
      </PopoverContent>
    </Popover>
  );
}
