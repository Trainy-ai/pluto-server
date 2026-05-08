import { useState, useEffect, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  PlusIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
  ZapIcon,
  ClipboardPasteIcon,
  GripVerticalIcon,
  FolderIcon,
  ArrowRightIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DynamicPatternPreview } from "./dynamic-pattern-preview";
import { useDynamicWidgetCount, useDynamicMatchedMetrics, splitMetricPath } from "./use-dynamic-section";
import { REGEX_MAX_LENGTH } from "./regex-search-panel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { CheckIcon, XIcon, Settings2Icon } from "lucide-react";
import { fuzzyFilter } from "@/lib/fuzzy-search";

const MULTISELECT_DISPLAY_CAP = 500;
import { isValidRe2Regex } from "../../~lib/validate-re2-regex";
import { useHiddenRunIds } from "@/hooks/use-hidden-run-ids";
import type { Section } from "../../~types/dashboard-types";

interface SectionDragProps {
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onDragLeave?: (e: React.DragEvent) => void;
  isDragging?: boolean;
  isDropTarget?: boolean;
  dropPosition?: "above" | "below" | "inside" | null;
}

interface SectionMoveTarget {
  label: string;
  id: string;
}

interface SectionContainerProps {
  section: Section;
  /** Number of visible widgets (after hiding empty pattern widgets). Defaults to section.widgets.length. */
  visibleWidgetCount?: number;
  onUpdate: (section: Section) => void;
  onToggleCollapse: () => void;
  onDelete: () => void;
  onAddWidget: () => void;
  onPasteWidget?: () => void;
  hasCopiedWidget?: boolean;
  /** Folders this section can be moved into (or "Top level" to move out) */
  onMoveToFolder?: (folderId: string | null) => void;
  moveFolderTargets?: SectionMoveTarget[];
  children: React.ReactNode;
  isEditing?: boolean;
  dynamicWidgetCount?: number;
  /** Report the lightweight dynamic widget count upward (for folder totals) */
  onDynamicCountChange?: (sectionId: string, count: number) => void;
  organizationId: string;
  projectName: string;
  selectedRunIds: string[];
  drag?: SectionDragProps;
}

export function SectionContainer({
  section,
  visibleWidgetCount,
  onUpdate,
  onToggleCollapse,
  onDelete,
  onAddWidget,
  onPasteWidget,
  hasCopiedWidget = false,
  onMoveToFolder,
  moveFolderTargets,
  children,
  isEditing = false,
  dynamicWidgetCount,
  onDynamicCountChange,
  organizationId,
  projectName,
  selectedRunIds,
  drag,
}: SectionContainerProps) {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editName, setEditName] = useState(section.name);
  const [editIsDynamic, setEditIsDynamic] = useState(!!section.dynamicPattern);
  const [editPattern, setEditPattern] = useState(section.dynamicPattern ?? "");
  const [editPatternMode, setEditPatternMode] = useState<"search" | "regex">(
    section.dynamicPatternMode ?? "search",
  );
  const [editGroupBy, setEditGroupBy] = useState<string[]>(section.dynamicGroupBy ?? []);
  const [editGroupPrefixes, setEditGroupPrefixes] = useState<string[]>(
    section.dynamicGroupPrefixes ?? [],
  );
  const [editGroupPrefixRegex, setEditGroupPrefixRegex] = useState<string>(
    section.dynamicGroupPrefixRegex ?? "",
  );
  // Mode for the prefix-grouping input: "simple" = pick prefixes from a list,
  // "regex" = type a regex with capture groups. Initial value derives from
  // whether the saved section has a regex set.
  const [editPrefixMode, setEditPrefixMode] = useState<"simple" | "regex">(
    section.dynamicGroupPrefixRegex && section.dynamicGroupPrefixRegex.trim().length > 0
      ? "regex"
      : "simple",
  );

  const isDynamic = !!section.dynamicPattern;

  // Exclude hidden runs so count matches what DynamicSectionGrid actually renders
  const hiddenRunIds = useHiddenRunIds();
  const visibleRunIds = useMemo(
    () =>
      hiddenRunIds.size === 0
        ? selectedRunIds
        : selectedRunIds.filter((id) => !hiddenRunIds.has(id)),
    [selectedRunIds, hiddenRunIds],
  );

  // Lightweight count for dynamic sections — shares query cache, no widget creation
  const { count: dynamicCount, isLoading: dynamicCountLoading } = useDynamicWidgetCount(
    isDynamic ? section.dynamicPattern : undefined,
    section.dynamicPatternMode ?? "search",
    organizationId,
    projectName,
    visibleRunIds,
    section.dynamicGroupBy,
    section.dynamicGroupPrefixes,
    section.dynamicGroupPrefixRegex,
  );

  // Report lightweight count upward so folder totals work even when collapsed
  useEffect(() => {
    if (isDynamic && onDynamicCountChange) {
      onDynamicCountChange(section.id, dynamicCount);
    }
  }, [isDynamic, dynamicCount, section.id, onDynamicCountChange]);

  const widgetCount = isDynamic
    ? (dynamicWidgetCount ?? dynamicCount)
    : (visibleWidgetCount ?? section.widgets.length);

  const handleToggleCollapse = () => {
    onToggleCollapse();
  };

  const handleSaveEdit = () => {
    const isDynamicValid = editIsDynamic && editPattern.trim().length > 0;
    const trimmedRegex = editGroupPrefixRegex.trim();
    // Save only the field for the active mode so the persisted section is
    // unambiguous about which grouping strategy is in use.
    const saveSimplePrefixes = isDynamicValid && editPrefixMode === "simple" && editGroupPrefixes.length > 0;
    const saveRegex = isDynamicValid && editPrefixMode === "regex" && trimmedRegex.length > 0;
    onUpdate({
      ...section,
      name: editName,
      dynamicPattern: isDynamicValid ? editPattern.trim() : undefined,
      dynamicPatternMode: isDynamicValid ? editPatternMode : undefined,
      dynamicGroupBy: isDynamicValid && editGroupBy.length > 0 ? editGroupBy : undefined,
      dynamicGroupPrefixes: saveSimplePrefixes ? editGroupPrefixes : undefined,
      dynamicGroupPrefixRegex: saveRegex ? trimmedRegex : undefined,
    });
    setIsEditDialogOpen(false);
  };

  const handleOpenEditDialog = () => {
    setEditName(section.name);
    setEditIsDynamic(!!section.dynamicPattern);
    setEditPattern(section.dynamicPattern ?? "");
    setEditPatternMode(section.dynamicPatternMode ?? "search");
    setEditGroupBy(section.dynamicGroupBy ?? []);
    setEditGroupPrefixes(section.dynamicGroupPrefixes ?? []);
    setEditGroupPrefixRegex(section.dynamicGroupPrefixRegex ?? "");
    setEditPrefixMode(
      section.dynamicGroupPrefixRegex && section.dynamicGroupPrefixRegex.trim().length > 0
        ? "regex"
        : "simple",
    );
    setIsEditDialogOpen(true);
  };

  return (
    <>
      <div
        className={`relative rounded-lg border bg-card ${drag?.isDragging ? "opacity-50" : ""}`}
        data-testid="section-container"
        data-section-name={section.name}
        onDragOver={drag?.onDragOver}
        onDrop={drag?.onDrop}
        onDragLeave={drag?.onDragLeave}
      >
        {/* Drop indicator line */}
        {drag?.isDropTarget && drag.dropPosition === "above" && (
          <div className="absolute -top-[2px] left-0 right-0 z-10 h-[3px] rounded-full bg-primary" />
        )}
        {drag?.isDropTarget && drag.dropPosition === "below" && (
          <div className="absolute -bottom-[2px] left-0 right-0 z-10 h-[3px] rounded-full bg-primary" />
        )}

        <Collapsible open={!section.collapsed} onOpenChange={handleToggleCollapse}>
          <div className="flex items-center justify-between border-b px-4 py-2">
            {isEditing && drag?.onDragStart && (
              <button
                draggable
                onDragStart={drag.onDragStart}
                onDragEnd={drag.onDragEnd}
                className="mr-1 cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
                aria-label="Drag to reorder section"
              >
                <GripVerticalIcon className="size-4" />
              </button>
            )}
            <CollapsibleTrigger asChild>
              <button className="flex flex-1 items-center gap-2 text-sm font-medium hover:text-accent-foreground">
                {section.collapsed ? (
                  <ChevronRightIcon className="size-4" />
                ) : (
                  <ChevronDownIcon className="size-4" />
                )}
                <span>{section.name}</span>
                {isDynamic && (
                  <Badge variant="secondary" className="gap-1 text-xs font-normal">
                    <ZapIcon className="size-3" />
                    {section.dynamicPattern}
                  </Badge>
                )}
                {isDynamic && dynamicCountLoading ? (
                  <Skeleton className="h-5 w-16 rounded-full" />
                ) : (
                  <Badge variant="outline" className="text-xs font-normal">
                    {widgetCount} widget{widgetCount !== 1 ? "s" : ""}
                  </Badge>
                )}
              </button>
            </CollapsibleTrigger>

            {isEditing && (
              <div className="flex items-center gap-2">
                {!isDynamic && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddWidget();
                      }}
                    >
                      <PlusIcon className="mr-1 size-4" />
                      Add Widget
                    </Button>
                    {hasCopiedWidget && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPasteWidget?.();
                        }}
                      >
                        <ClipboardPasteIcon className="mr-1 size-4" />
                        Paste Widget
                      </Button>
                    )}
                  </>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8" data-testid="section-menu-btn">
                      <MoreHorizontalIcon className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleOpenEditDialog}>
                      <PencilIcon className="mr-2 size-4" />
                      Edit Section
                    </DropdownMenuItem>
                    {onMoveToFolder && moveFolderTargets && moveFolderTargets.length > 0 && (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <ArrowRightIcon className="mr-2 size-4" />
                          Move to...
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="max-h-60 overflow-y-auto">
                          {moveFolderTargets.map((target) => (
                            <DropdownMenuItem
                              key={target.id ?? "top-level"}
                              onClick={() => onMoveToFolder(target.id)}
                            >
                              {target.id ? (
                                <FolderIcon className="mr-2 size-3.5 text-primary/60" />
                              ) : null}
                              <span className="truncate">{target.label}</span>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => setIsDeleteDialogOpen(true)}
                    >
                      <Trash2Icon className="mr-2 size-4" />
                      Delete Section
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>

          <CollapsibleContent>
            <div className="p-4">
              {!isDynamic && section.widgets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                  <p className="mb-2">This section is empty.</p>
                  {isEditing && (
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={onAddWidget}>
                        <PlusIcon className="mr-2 size-4" />
                        Add a widget
                      </Button>
                      {hasCopiedWidget && (
                        <Button variant="outline" size="sm" onClick={onPasteWidget}>
                          <ClipboardPasteIcon className="mr-2 size-4" />
                          Paste Widget
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                children
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Edit Section Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Section</DialogTitle>
            <DialogDescription>
              Update the section name and configuration.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="section-name">Section Name</Label>
              <Input
                id="section-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="dynamic-toggle">Dynamic section</Label>
                <p className="text-xs text-muted-foreground">
                  Auto-create widgets from a pattern
                </p>
              </div>
              <Switch
                id="dynamic-toggle"
                checked={editIsDynamic}
                onCheckedChange={setEditIsDynamic}
              />
            </div>
            {editIsDynamic && (
              <DynamicPatternInput
                pattern={editPattern}
                onPatternChange={setEditPattern}
                mode={editPatternMode}
                onModeChange={setEditPatternMode}
                groupBy={editGroupBy}
                onGroupByChange={setEditGroupBy}
                groupPrefixes={editGroupPrefixes}
                onGroupPrefixesChange={setEditGroupPrefixes}
                groupPrefixRegex={editGroupPrefixRegex}
                onGroupPrefixRegexChange={setEditGroupPrefixRegex}
                prefixMode={editPrefixMode}
                onPrefixModeChange={setEditPrefixMode}
                organizationId={organizationId}
                projectName={projectName}
                selectedRunIds={selectedRunIds}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Section</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{section.name}&quot;? This will also
              delete all widgets in this section.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={onDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Multi-select dropdown ──────────────────────────────────────────

interface MultiSelectDropdownProps {
  /** Currently selected values. */
  selected: string[];
  onChange: (next: string[]) => void;
  /** All options shown in the dropdown. */
  options: string[];
  /** Placeholder shown when no values are selected. */
  placeholder: string;
  /** Empty-state message when no options are available yet. */
  emptyText: string;
  /** Loading state — disables interaction and shows skeleton text. */
  isLoading?: boolean;
  /** Truncate selected-badge labels to this many chars (kept short to fit in
   *  the trigger button — full path is in the title attribute on hover). */
  badgeMaxLen?: number;
  /** Test id for the trigger button. */
  testId?: string;
}

function MultiSelectDropdown({
  selected,
  onChange,
  options,
  placeholder,
  emptyText,
  isLoading,
  badgeMaxLen,
  testId,
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Reset search when popover closes
  useEffect(() => {
    if (!open) setSearchValue("");
  }, [open]);

  // Custom filtering — fuzzy search via Fuse.js (matches column-picker pattern),
  // capped to MULTISELECT_DISPLAY_CAP so the DOM stays small even when the
  // section pattern matches thousands of metrics. Always include selected items
  // so users can deselect even if they're outside the visible window.
  const { visibleOptions, totalMatching } = useMemo(() => {
    const matched = searchValue.trim().length > 0 ? fuzzyFilter(options, searchValue) : options;
    const total = matched.length;
    const truncated = matched.slice(0, MULTISELECT_DISPLAY_CAP);
    const visibleSet = new Set(truncated);
    // Pin selected items at the top so users can always deselect them
    const selectedNotInVisible = selected.filter((s) => !visibleSet.has(s));
    return {
      visibleOptions: [...selectedNotInVisible, ...truncated],
      totalMatching: total,
    };
  }, [options, searchValue, selected]);

  const isTruncated = totalMatching > MULTISELECT_DISPLAY_CAP;

  const toggle = (value: string) => {
    if (selectedSet.has(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  // Show the tail of long paths (the meaningful varying part — e.g. for
  // `training/gradient/norms/model.decoder.cross_attention.k_proj` we want to
  // see `…cross_attention.k_proj` not the leading boilerplate). Hover for full.
  const displayLabel = (val: string) => {
    if (!badgeMaxLen || val.length <= badgeMaxLen) return val;
    return `…${val.slice(-(badgeMaxLen - 1))}`;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          // hover:bg-background prevents the outline-variant's default
          // hover:bg-accent flash, which otherwise blends into the chips'
          // bg-secondary and makes the selected chips hard to see on hover.
          className="h-auto min-h-9 w-full justify-between gap-2 px-3 py-1.5 text-left font-normal hover:bg-background"
          disabled={isLoading}
          data-testid={testId}
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {selected.length === 0 ? (
              <span className="text-muted-foreground">
                {isLoading ? "Loading…" : placeholder}
              </span>
            ) : (
              selected.map((v) => (
                <Badge
                  key={v}
                  variant="secondary"
                  className="max-w-full truncate font-normal"
                  title={v}
                >
                  {displayLabel(v)}
                </Badge>
              ))
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {selected.length > 0 && (
              <span
                role="button"
                aria-label="Clear selection"
                onClick={clear}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </span>
            )}
            <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        {/* shouldFilter={false} — we run our own fuzzy filter + truncation. cmdk's
            built-in filter would otherwise re-filter and double-count. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search…"
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {visibleOptions.map((opt) => (
                <CommandItem
                  key={opt}
                  value={opt}
                  onSelect={() => toggle(opt)}
                  className="cursor-pointer"
                >
                  <CheckIcon
                    className={cn(
                      "mr-2 size-4 shrink-0",
                      selectedSet.has(opt) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate" title={opt}>
                    {opt}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            {isTruncated && (
              <div className="border-t px-3 py-1.5 text-xs text-muted-foreground">
                Showing {MULTISELECT_DISPLAY_CAP.toLocaleString()} of{" "}
                {totalMatching.toLocaleString()} matches — type to narrow.
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Shared pattern input with Search/Regex toggle + preview
interface DynamicPatternInputProps {
  pattern: string;
  onPatternChange: (value: string) => void;
  mode: "search" | "regex";
  onModeChange: (mode: "search" | "regex") => void;
  /** Suffixes (last path segment) that combine into one widget per shared prefix. */
  groupBy: string[];
  onGroupByChange: (next: string[]) => void;
  /** Optional prefix allowlist — if set, only metrics with these prefixes participate. */
  groupPrefixes: string[];
  onGroupPrefixesChange: (next: string[]) => void;
  /** Optional regex with capture groups — REPLACES the literal allowlist when set. */
  groupPrefixRegex: string;
  onGroupPrefixRegexChange: (next: string) => void;
  /** Which prefix-grouping mode is active in the UI (simple list vs regex). */
  prefixMode: "simple" | "regex";
  onPrefixModeChange: (next: "simple" | "regex") => void;
  organizationId: string;
  projectName: string;
  selectedRunIds: string[];
  onEnter?: () => void;
}

function DynamicPatternInput({
  pattern,
  onPatternChange,
  mode,
  onModeChange,
  groupBy,
  onGroupByChange,
  groupPrefixes,
  onGroupPrefixesChange,
  groupPrefixRegex,
  onGroupPrefixRegexChange,
  prefixMode,
  onPrefixModeChange,
  organizationId,
  projectName,
  selectedRunIds,
  onEnter,
}: DynamicPatternInputProps) {
  const isRegex = mode === "regex";
  const isTooLong = isRegex && pattern.length > REGEX_MAX_LENGTH;
  const isNearLimit = isRegex && pattern.length > REGEX_MAX_LENGTH * 0.8;
  const isInvalidRe2 = isRegex && pattern.trim().length > 0 && !isTooLong && !isValidRe2Regex(pattern.trim());
  const hasError = isTooLong || isInvalidRe2;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <Label>Pattern</Label>
        {isNearLimit && (
          <span className={cn("text-xs", isTooLong ? "text-destructive" : "text-muted-foreground")}>
            {pattern.length}/{REGEX_MAX_LENGTH}
          </span>
        )}
      </div>
      <Tabs
        value={mode}
        onValueChange={(v) => onModeChange(v as "search" | "regex")}
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="search">Search</TabsTrigger>
          <TabsTrigger value="regex">Regex</TabsTrigger>
        </TabsList>
      </Tabs>
      <Input
        placeholder={
          mode === "search"
            ? "Search metrics and files... (use * or ? for glob)"
            : "Regex pattern... e.g. (train|val)/.+"
        }
        value={pattern}
        onChange={(e) => onPatternChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) {
            onEnter();
          }
        }}
        className={cn(hasError && "border-destructive text-destructive")}
      />
      {isTooLong && (
        <p className="text-xs text-destructive">
          Pattern too long ({pattern.length}/{REGEX_MAX_LENGTH} characters).
        </p>
      )}
      {isInvalidRe2 && (
        <p className="text-xs text-destructive">
          Invalid regex. ClickHouse uses re2 — lookaheads, backreferences, and unbalanced parentheses are not supported.
        </p>
      )}
      {!hasError && (
        <p className="text-xs text-muted-foreground">
          {mode === "search"
            ? "Fuzzy text search. Use * / ? for glob patterns (e.g., train/*)."
            : "Regex pattern matched against metric and file names."}
          {" "}Creates one widget per match. Searches selected runs only.
        </p>
      )}
      {pattern.trim() && !hasError && (
        <DynamicPatternPreview
          pattern={pattern.trim()}
          mode={mode}
          organizationId={organizationId}
          projectName={projectName}
          selectedRunIds={selectedRunIds}
        />
      )}
      <AdvancedGroupingPanel hasGrouping={groupBy.length > 0 || groupPrefixes.length > 0 || groupPrefixRegex.trim().length > 0}>
        <DynamicGroupingControls
          pattern={pattern}
          mode={mode}
          organizationId={organizationId}
          projectName={projectName}
          selectedRunIds={selectedRunIds}
          groupBy={groupBy}
          onGroupByChange={onGroupByChange}
          groupPrefixes={groupPrefixes}
          onGroupPrefixesChange={onGroupPrefixesChange}
          groupPrefixRegex={groupPrefixRegex}
          onGroupPrefixRegexChange={onGroupPrefixRegexChange}
          prefixMode={prefixMode}
          onPrefixModeChange={onPrefixModeChange}
          hasError={hasError}
        />
      </AdvancedGroupingPanel>
    </div>
  );
}

/**
 * Collapsible "Advanced" wrapper for the grouping controls. Hidden by default
 * to keep the simple add-section flow uncluttered. Auto-opens when grouping
 * is already configured so users editing an existing section see their settings.
 */
function AdvancedGroupingPanel({
  children,
  hasGrouping,
}: {
  children: React.ReactNode;
  hasGrouping: boolean;
}) {
  const [open, setOpen] = useState(hasGrouping);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="pt-1">
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-full justify-start gap-1.5 px-1 text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
          type="button"
        >
          {open ? (
            <ChevronDownIcon className="size-3.5" />
          ) : (
            <ChevronRightIcon className="size-3.5" />
          )}
          <Settings2Icon className="size-3.5" />
          Advanced
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

// Two multiselects + an optional regex: which suffixes combine, which
// prefixes to include, and an optional regex with capture groups that bucks
// metrics by capture-tuple instead of literal prefix.
// Options come from the metrics that match the section's pattern.
function DynamicGroupingControls({
  pattern,
  mode,
  organizationId,
  projectName,
  selectedRunIds,
  groupBy,
  onGroupByChange,
  groupPrefixes,
  onGroupPrefixesChange,
  groupPrefixRegex,
  onGroupPrefixRegexChange,
  prefixMode,
  onPrefixModeChange,
  hasError,
}: {
  pattern: string;
  mode: "search" | "regex";
  organizationId: string;
  projectName: string;
  selectedRunIds: string[];
  groupBy: string[];
  onGroupByChange: (next: string[]) => void;
  groupPrefixes: string[];
  onGroupPrefixesChange: (next: string[]) => void;
  groupPrefixRegex: string;
  onGroupPrefixRegexChange: (next: string) => void;
  prefixMode: "simple" | "regex";
  onPrefixModeChange: (next: "simple" | "regex") => void;
  hasError: boolean;
}) {
  const trimmed = pattern.trim();
  const enabled = trimmed.length > 0 && !hasError;
  const { metricNames, isLoading } = useDynamicMatchedMetrics(
    enabled ? trimmed : undefined,
    mode,
    organizationId,
    projectName,
    selectedRunIds,
  );

  const { availablePrefixes, availableSuffixes } = useMemo(() => {
    const prefixSet = new Set<string>();
    const suffixSet = new Set<string>();
    for (const m of metricNames) {
      const { prefix, suffix } = splitMetricPath(m);
      if (prefix.length > 0) prefixSet.add(prefix);
      if (suffix.length > 0) suffixSet.add(suffix);
    }
    return {
      availablePrefixes: [...prefixSet].sort((a, b) => a.localeCompare(b)),
      availableSuffixes: [...suffixSet].sort((a, b) => a.localeCompare(b)),
    };
  }, [metricNames]);

  return (
    <div className="grid gap-3 rounded-md border bg-muted/30 p-3">
      <div className="space-y-0.5">
        <Label className="text-sm font-medium">
          Group metrics within widgets
        </Label>
        <p className="text-xs text-muted-foreground">
          Combine metrics that share a prefix into a single widget. Optionally restrict
          which prefixes participate.
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs text-muted-foreground">Combine these suffixes</Label>
        <MultiSelectDropdown
          selected={groupBy}
          onChange={onGroupByChange}
          options={availableSuffixes}
          placeholder="Select suffixes (e.g. min, max, mean)"
          emptyText={enabled ? "No metric suffixes match this pattern." : "Enter a pattern first."}
          isLoading={enabled && isLoading}
          testId="dynamic-group-by-select"
        />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs text-muted-foreground">
          Restrict which prefixes combine{" "}
          <span className="font-normal text-muted-foreground/80">(optional)</span>
        </Label>
        <Tabs
          value={prefixMode}
          onValueChange={(v) => onPrefixModeChange(v as "simple" | "regex")}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="simple" data-testid="prefix-mode-simple">Simple</TabsTrigger>
            <TabsTrigger value="regex" data-testid="prefix-mode-regex">Regex</TabsTrigger>
          </TabsList>
        </Tabs>
        {prefixMode === "simple" ? (
          <MultiSelectDropdown
            selected={groupPrefixes}
            onChange={onGroupPrefixesChange}
            options={availablePrefixes}
            placeholder="All prefixes eligible"
            emptyText={enabled ? "No matching prefixes yet." : "Enter a pattern first."}
            isLoading={enabled && isLoading}
            badgeMaxLen={28}
            testId="dynamic-group-prefixes-select"
          />
        ) : (
          <RegexPrefixInput
            value={groupPrefixRegex}
            onChange={onGroupPrefixRegexChange}
          />
        )}
      </div>
      {groupBy.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {prefixMode === "regex" && groupPrefixRegex.trim().length > 0 ? (
            <>
              Metrics matching the regex bucket by their capture-group tuple,
              combining{" "}
              <span className="font-medium">{groupBy.join(", ")}</span> per bucket.
              Other suffixes — and metrics that don&apos;t match the regex —
              still appear as their own widgets.
            </>
          ) : (
            <>
              Each shared prefix becomes one widget combining its{" "}
              <span className="font-medium">{groupBy.join(", ")}</span> metrics.
              Other suffixes
              {prefixMode === "simple" && groupPrefixes.length > 0
                ? " — and metrics outside the selected prefixes — "
                : " "}
              still appear as their own widgets.
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** Regex input for capture-group prefix grouping. Validated for re2 compatibility
 *  (the same restriction as the section pattern's regex mode). When set,
 *  takes precedence over the literal prefix allowlist. */
function RegexPrefixInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const trimmed = value.trim();
  const isInvalidRe2 = trimmed.length > 0 && !isValidRe2Regex(trimmed);
  // Compile-test as JS regex for early feedback (the bucketing fn does the
  // same; we just want to surface a hint to the user).
  let isInvalidJs = false;
  if (trimmed.length > 0 && !isInvalidRe2) {
    try {
      new RegExp(trimmed);
    } catch {
      isInvalidJs = true;
    }
  }
  const hasError = isInvalidRe2 || isInvalidJs;
  const captureCount = (() => {
    if (trimmed.length === 0 || hasError) return 0;
    try {
      const m = new RegExp(`${trimmed}|`).exec("");
      return (m?.length ?? 1) - 1;
    } catch {
      return 0;
    }
  })();

  return (
    <div className="grid gap-1.5">
      <Input
        id="dynamic-group-prefix-regex"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. validation/(.*?)/(original|smoothed)/"
        className={cn(
          "h-9 font-mono text-xs",
          hasError && "border-destructive text-destructive",
        )}
        data-testid="dynamic-group-prefix-regex"
      />
      {isInvalidRe2 && (
        <p className="text-xs text-destructive">
          Invalid regex. ClickHouse uses re2 — lookaheads, backreferences, and
          unbalanced parentheses are not supported.
        </p>
      )}
      {isInvalidJs && !isInvalidRe2 && (
        <p className="text-xs text-destructive">Invalid regex syntax.</p>
      )}
      {!hasError && trimmed.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {captureCount === 0
            ? "0 capture groups → matching metrics combine into a single widget."
            : `${captureCount} capture group${captureCount === 1 ? "" : "s"} → metrics with the same captured ${
                captureCount === 1 ? "value" : "tuple"
              } combine.`}
        </p>
      )}
    </div>
  );
}

// ─── Helper: compute dynamic widget count for a single child (always mounted) ──

/** Renderless component that runs useDynamicWidgetCount for a single section
 *  and reports the result upward. Mounted unconditionally inside FolderContainer
 *  so counts are available even when the folder is collapsed. */
function DynamicChildCounter({
  section,
  organizationId,
  projectName,
  selectedRunIds,
  onCount,
}: {
  section: Section;
  organizationId: string;
  projectName: string;
  selectedRunIds: string[];
  onCount: (sectionId: string, count: number, isLoading: boolean) => void;
}) {
  // Exclude hidden runs so folder totals match rendered widget counts
  const hiddenRunIds = useHiddenRunIds();
  const visibleRunIds = useMemo(
    () =>
      hiddenRunIds.size === 0
        ? selectedRunIds
        : selectedRunIds.filter((id) => !hiddenRunIds.has(id)),
    [selectedRunIds, hiddenRunIds],
  );

  const { count, isLoading } = useDynamicWidgetCount(
    section.dynamicPattern,
    section.dynamicPatternMode ?? "search",
    organizationId,
    projectName,
    visibleRunIds,
    section.dynamicGroupBy,
    section.dynamicGroupPrefixes,
    section.dynamicGroupPrefixRegex,
  );

  useEffect(() => {
    onCount(section.id, count, isLoading);
  }, [count, isLoading, section.id, onCount]);

  return null;
}

// ─── Folder container (outer grouping layer) ────────────────────────

interface FolderContainerProps {
  section: Section;
  onUpdate: (section: Section) => void;
  onToggleCollapse: () => void;
  onDelete: () => void;
  onAddChildSection: (
    name: string,
    dynamicPattern?: string,
    dynamicPatternMode?: "search" | "regex",
    dynamicGroupBy?: string[],
    dynamicGroupPrefixes?: string[],
    dynamicGroupPrefixRegex?: string,
  ) => void;
  organizationId: string;
  projectName: string;
  selectedRunIds: string[];
  onAddWidget: () => void;
  onPasteWidget?: () => void;
  hasCopiedWidget?: boolean;
  /** Dynamic widget counts keyed by child section ID */
  dynamicWidgetCounts?: Record<string, number>;
  children: React.ReactNode;
  isEditing?: boolean;
  drag?: SectionDragProps;
}

export function FolderContainer({
  section,
  onUpdate,
  onToggleCollapse,
  onDelete,
  onAddChildSection,
  organizationId,
  projectName,
  selectedRunIds,
  onAddWidget,
  onPasteWidget,
  hasCopiedWidget = false,
  dynamicWidgetCounts = {},
  children,
  isEditing = false,
  drag,
}: FolderContainerProps) {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editName, setEditName] = useState(section.name);

  // Local dynamic counts populated by DynamicChildCounter (always-mounted)
  const [localDynamicCounts, setLocalDynamicCounts] = useState<Record<string, number>>({});
  const [dynamicLoading, setDynamicLoading] = useState<Record<string, boolean>>({});
  const handleDynamicCount = useCallback((sectionId: string, count: number, isLoading: boolean) => {
    setLocalDynamicCounts((prev) => {
      if (prev[sectionId] === count) return prev;
      return { ...prev, [sectionId]: count };
    });
    setDynamicLoading((prev) => {
      if (prev[sectionId] === isLoading) return prev;
      return { ...prev, [sectionId]: isLoading };
    });
  }, []);

  // Merge: prefer local counts (from always-mounted DynamicChildCounter) over
  // parent-provided counts. Parent counts come from DynamicSectionGrid which is
  // unmounted when the folder is collapsed, so they go stale when runs are hidden.
  const mergedCounts = { ...dynamicWidgetCounts, ...localDynamicCounts };

  const dynamicChildren = (section.children ?? []).filter((c) => !!c.dynamicPattern);
  const anyDynamicChildLoading = dynamicChildren.length > 0 &&
    dynamicChildren.some((c) => dynamicLoading[c.id] !== false);

  const childCount = section.children?.length ?? 0;
  const directWidgetCount = section.widgets.length;
  const totalWidgetCount = directWidgetCount +
    (section.children ?? []).reduce((sum, c) => {
      if (c.dynamicPattern) {
        return sum + (mergedCounts[c.id] ?? 0);
      }
      return sum + c.widgets.length;
    }, 0);

  const handleSaveEdit = () => {
    onUpdate({ ...section, name: editName });
    setIsEditDialogOpen(false);
  };

  const handleOpenEditDialog = () => {
    setEditName(section.name);
    setIsEditDialogOpen(true);
  };

  return (
    <>
      {/* Always-mounted counters for dynamic children so totals are correct when collapsed */}
      {dynamicChildren.map((child) => (
        <DynamicChildCounter
          key={child.id}
          section={child}
          organizationId={organizationId}
          projectName={projectName}
          selectedRunIds={selectedRunIds}
          onCount={handleDynamicCount}
        />
      ))}
      <div
        className={cn(
          "relative rounded-lg border-2 shadow-sm transition-colors",
          drag?.isDropTarget && drag.dropPosition === "inside"
            ? "border-primary bg-primary/10"
            : "border-primary/20 bg-primary/[0.02]",
          drag?.isDragging && "opacity-50",
        )}
        data-testid="folder-container"
        data-section-name={section.name}
        onDragOver={drag?.onDragOver}
        onDrop={drag?.onDrop}
        onDragLeave={drag?.onDragLeave}
      >
        {/* Drop indicator lines for above/below reorder */}
        {drag?.isDropTarget && drag.dropPosition === "above" && (
          <div className="absolute -top-[2px] left-0 right-0 z-10 h-[3px] rounded-full bg-primary" />
        )}
        {drag?.isDropTarget && drag.dropPosition === "below" && (
          <div className="absolute -bottom-[2px] left-0 right-0 z-10 h-[3px] rounded-full bg-primary" />
        )}

        <Collapsible open={!section.collapsed} onOpenChange={onToggleCollapse}>
          <div className="flex items-center justify-between border-b border-primary/10 px-4 py-2">
            {isEditing && drag?.onDragStart && (
              <button
                draggable
                onDragStart={drag.onDragStart}
                onDragEnd={drag.onDragEnd}
                className="mr-1 cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
                aria-label="Drag to reorder folder"
              >
                <GripVerticalIcon className="size-4" />
              </button>
            )}
            <CollapsibleTrigger asChild>
              <button className="flex flex-1 items-center gap-2 text-sm font-semibold hover:text-accent-foreground">
                {section.collapsed ? (
                  <ChevronRightIcon className="size-4" />
                ) : (
                  <ChevronDownIcon className="size-4" />
                )}
                <FolderIcon className="size-4 text-primary/60" />
                <span>{section.name}</span>
                <Badge variant="outline" className="text-xs font-normal">
                  {childCount} section{childCount !== 1 ? "s" : ""}
                </Badge>
                {directWidgetCount > 0 && (
                  <Badge variant="outline" className="text-xs font-normal">
                    {directWidgetCount} widget{directWidgetCount !== 1 ? "s" : ""}
                  </Badge>
                )}
                {anyDynamicChildLoading ? (
                  <Skeleton className="h-5 w-24 rounded-full" />
                ) : totalWidgetCount > 0 ? (
                  <Badge variant="outline" className="text-xs font-normal">
                    {totalWidgetCount} total widget{totalWidgetCount !== 1 ? "s" : ""}
                  </Badge>
                ) : null}
              </button>
            </CollapsibleTrigger>

            {isEditing && (
              <div className="flex items-center gap-2">
                <AddSectionButton
                  onAddSection={onAddChildSection}
                  organizationId={organizationId}
                  projectName={projectName}
                  selectedRunIds={selectedRunIds}
                  buttonVariant="ghost"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddWidget();
                  }}
                >
                  <PlusIcon className="mr-1 size-4" />
                  Add Widget
                </Button>
                {hasCopiedWidget && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPasteWidget?.();
                    }}
                  >
                    <ClipboardPasteIcon className="mr-1 size-4" />
                    Paste
                  </Button>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8" data-testid="folder-menu-btn">
                      <MoreHorizontalIcon className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleOpenEditDialog}>
                      <PencilIcon className="mr-2 size-4" />
                      Edit Folder
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => setIsDeleteDialogOpen(true)}
                    >
                      <Trash2Icon className="mr-2 size-4" />
                      Delete Folder
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>

          <CollapsibleContent>
            <div className="space-y-3 p-3">
              {childCount === 0 && directWidgetCount === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground">
                  <p className="mb-2">This folder is empty.</p>
                  {isEditing && (
                    <div className="flex items-center gap-2">
                      <AddSectionButton
                        onAddSection={onAddChildSection}
                        organizationId={organizationId}
                        projectName={projectName}
                        selectedRunIds={selectedRunIds}
                      />
                      <Button variant="outline" size="sm" onClick={onAddWidget}>
                        <PlusIcon className="mr-2 size-4" />
                        Add a widget
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                children
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Edit Folder Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Folder</DialogTitle>
            <DialogDescription>
              Update the folder name.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="folder-name">Folder Name</Label>
              <Input
                id="folder-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveEdit();
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Folder Confirmation */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Folder</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{section.name}&quot;? This will also
              delete all sections and widgets inside it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Add buttons ─────────────────────────────────────────────────────

interface AddFolderButtonProps {
  onAddFolder: (name: string) => void;
}

export function AddFolderButton({ onAddFolder }: AddFolderButtonProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [name, setName] = useState("");

  const handleCreate = () => {
    onAddFolder(name.trim() || "New Folder");
    setIsDialogOpen(false);
    setName("");
  };

  return (
    <>
      <Button variant="outline" size="sm" className="text-muted-foreground" onClick={() => setIsDialogOpen(true)}>
        <PlusIcon className="mr-1.5 size-3.5" />
        Add Folder
      </Button>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Create New Folder</DialogTitle>
            <DialogDescription>
              Create a folder to group sections together.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="new-folder-name">Folder Name</Label>
              <Input
                id="new-folder-name"
                placeholder="New Folder"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate}>Create Folder</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface AddSectionButtonProps {
  onAddSection: (
    name: string,
    dynamicPattern?: string,
    dynamicPatternMode?: "search" | "regex",
    dynamicGroupBy?: string[],
    dynamicGroupPrefixes?: string[],
    dynamicGroupPrefixRegex?: string,
  ) => void;
  organizationId: string;
  projectName: string;
  selectedRunIds: string[];
  /** Button variant — "outline" (default, for bottom area) or "ghost" (for header bars) */
  buttonVariant?: "outline" | "ghost";
}

export function AddSectionButton({ onAddSection, organizationId, projectName, selectedRunIds, buttonVariant = "outline" }: AddSectionButtonProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [isDynamic, setIsDynamic] = useState(false);
  const [pattern, setPattern] = useState("");
  const [patternMode, setPatternMode] = useState<"search" | "regex">("search");
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [groupPrefixes, setGroupPrefixes] = useState<string[]>([]);
  const [groupPrefixRegex, setGroupPrefixRegex] = useState<string>("");
  const [prefixMode, setPrefixMode] = useState<"simple" | "regex">("simple");

  const handleCreate = () => {
    const sectionName = name.trim() || "New Section";
    const dynamicPattern = isDynamic && pattern.trim() ? pattern.trim() : undefined;
    const mode = isDynamic && pattern.trim() ? patternMode : undefined;
    const dynamicGroupBy = dynamicPattern && groupBy.length > 0 ? groupBy : undefined;
    // Save only the field for the active mode so the persisted section is
    // unambiguous about which grouping strategy is in use.
    const trimmedRegex = groupPrefixRegex.trim();
    const dynamicGroupPrefixes =
      dynamicPattern && prefixMode === "simple" && groupPrefixes.length > 0
        ? groupPrefixes
        : undefined;
    const dynamicGroupPrefixRegex =
      dynamicPattern && prefixMode === "regex" && trimmedRegex.length > 0
        ? trimmedRegex
        : undefined;
    onAddSection(
      sectionName,
      dynamicPattern,
      mode,
      dynamicGroupBy,
      dynamicGroupPrefixes,
      dynamicGroupPrefixRegex,
    );
    setIsDialogOpen(false);
    setName("");
    setIsDynamic(false);
    setPattern("");
    setPatternMode("search");
    setGroupBy([]);
    setGroupPrefixes([]);
    setGroupPrefixRegex("");
    setPrefixMode("simple");
  };

  return (
    <>
      <Button variant={buttonVariant} size="sm" className={buttonVariant === "outline" ? "text-muted-foreground" : ""} onClick={() => setIsDialogOpen(true)}>
        <PlusIcon className="mr-1.5 size-3.5" />
        Add Section
      </Button>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Section</DialogTitle>
            <DialogDescription>
              Create a section to organize your dashboard widgets.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="new-section-name">Section Name</Label>
              <Input
                id="new-section-name"
                placeholder="New Section"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleCreate();
                  }
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="new-dynamic-toggle">Dynamic section</Label>
                <p className="text-xs text-muted-foreground">
                  Auto-create widgets from a pattern
                </p>
              </div>
              <Switch
                id="new-dynamic-toggle"
                checked={isDynamic}
                onCheckedChange={setIsDynamic}
              />
            </div>
            {isDynamic && (
              <DynamicPatternInput
                pattern={pattern}
                onPatternChange={setPattern}
                mode={patternMode}
                onModeChange={setPatternMode}
                groupBy={groupBy}
                onGroupByChange={setGroupBy}
                groupPrefixes={groupPrefixes}
                onGroupPrefixesChange={setGroupPrefixes}
                groupPrefixRegex={groupPrefixRegex}
                onGroupPrefixRegexChange={setGroupPrefixRegex}
                prefixMode={prefixMode}
                onPrefixModeChange={setPrefixMode}
                organizationId={organizationId}
                projectName={projectName}
                selectedRunIds={selectedRunIds}
                onEnter={handleCreate}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={isDynamic && !pattern.trim()}>
              Create Section
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
