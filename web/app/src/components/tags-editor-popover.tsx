import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Check, Loader2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";
import { fuzzyFilter } from "@/lib/fuzzy-search";
import { useTagSearch, TAG_SEARCH_LIMIT } from "@/hooks/use-tag-search";
import { LinearIssuePicker } from "@/components/linear-issue-picker";

/** Mirror of server `MAX_TAGS_PER_RUN` in web/server/lib/limits.ts. */
const MAX_TAGS_PER_RUN = 50;

interface TagsEditorPopoverProps {
  /** Current tags */
  tags: string[];
  /** All available tags for suggestions (optional) */
  allTags?: string[];
  /** Callback when tags are updated */
  onTagsUpdate: (tags: string[]) => void;
  /** The trigger element (button) to open the popover */
  trigger: ReactNode;
  /** Whether to stop propagation on popover content clicks */
  stopPropagation?: boolean;
  /** Custom empty state text when no tags and no input */
  emptyText?: string;
  /** Alignment of the popover */
  align?: "start" | "center" | "end";
  /** Organization ID for Linear integration + backend tag search (optional) */
  organizationId?: string;
  /** Project name — enables backend tag search when set alongside organizationId */
  projectName?: string;
  /** Called when the popover open state changes */
  onOpenChange?: (open: boolean) => void;
}

/** Extract run display ID from a baseline tag, e.g. "baseline:T0-123" → "T0-123" */
function getBaselineRunId(tag: string): string | null {
  const m = tag.match(/^baseline:([A-Z]+-\d+)$/i);
  return m ? m[1].toUpperCase() : null;
}

/** Check if a baseline for the given run ID already exists in the tags list */
function hasExistingBaseline(runId: string, tags: string[]): boolean {
  return tags.some((t) => getBaselineRunId(t) === runId);
}

export function TagsEditorPopover({
  tags,
  allTags = [],
  onTagsUpdate,
  trigger,
  stopPropagation = false,
  emptyText = "No tags found.",
  align = "start",
  organizationId,
  projectName,
  onOpenChange: onOpenChangeProp,
}: TagsEditorPopoverProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  // Local state for pending tag changes (batch updates)
  const [pendingTags, setPendingTags] = useState<string[]>(tags);
  const [hasChanges, setHasChanges] = useState(false);
  const [baselineError, setBaselineError] = useState<string | null>(null);
  // Guard against double-fire: handleApply calls onTagsUpdate then closes,
  // which would trigger onOpenChange to call onTagsUpdate again.
  const appliedRef = useRef(false);

  // Sync pendingTags with tags prop when popover opens or tags change externally
  useEffect(() => {
    if (!open) {
      setPendingTags(tags);
      setHasChanges(false);
    }
  }, [tags, open]);

  // Check if there are pending changes
  useEffect(() => {
    const tagsSet = new Set(tags);
    const pendingSet = new Set(pendingTags);
    const isDifferent =
      tags.length !== pendingTags.length ||
      tags.some((tag) => !pendingSet.has(tag)) ||
      pendingTags.some((tag) => !tagsSet.has(tag));
    setHasChanges(isDifferent);
  }, [tags, pendingTags]);

  const handleTagToggle = (tag: string) => {
    if (pendingTags.includes(tag)) {
      setPendingTags(pendingTags.filter((t) => t !== tag));
      setBaselineError(null);
    } else {
      if (pendingTags.length >= MAX_TAGS_PER_RUN) {
        setBaselineError(`A run can have at most ${MAX_TAGS_PER_RUN} tags`);
        return;
      }
      const issueId = getBaselineRunId(tag);
      if (issueId && hasExistingBaseline(issueId, pendingTags)) {
        setBaselineError(`A baseline for ${issueId} already exists on this run`);
        return;
      }
      setBaselineError(null);
      setPendingTags([...pendingTags, tag]);
    }
  };


  const handleAddNewTag = () => {
    const trimmedValue = inputValue.trim();
    if (trimmedValue && !pendingTags.includes(trimmedValue)) {
      if (pendingTags.length >= MAX_TAGS_PER_RUN) {
        setBaselineError(`A run can have at most ${MAX_TAGS_PER_RUN} tags`);
        return;
      }
      const issueId = getBaselineRunId(trimmedValue);
      if (issueId && hasExistingBaseline(issueId, pendingTags)) {
        setBaselineError(`A baseline for ${issueId} already exists on this run`);
        return;
      }
      setBaselineError(null);
      setPendingTags([...pendingTags, trimmedValue]);
      setInputValue("");
    }
  };

  const handleRemoveTag = (e: React.MouseEvent, tag: string) => {
    e.stopPropagation();
    setPendingTags(pendingTags.filter((t) => t !== tag));
  };

  const handleApply = useCallback(() => {
    if (hasChanges) {
      appliedRef.current = true;
      onTagsUpdate(pendingTags);
    }
    setOpen(false);
  }, [hasChanges, pendingTags, onTagsUpdate]);

  const handleCancel = useCallback(() => {
    setPendingTags(tags);
    setHasChanges(false);
    setOpen(false);
  }, [tags]);

  // Check if Linear integration is configured
  const { data: linearIntegration } = useQuery(
    trpc.organization.integrations.getLinearIntegration.queryOptions(
      { organizationId: organizationId! },
      { enabled: !!organizationId, refetchOnWindowFocus: false },
    ),
  );

  const linearConfigured = linearIntegration?.configured && linearIntegration?.enabled;

  // Backend tag search: typing reaches every tag in the project, not just
  // the loaded-run tags passed in `allTags`. Falls back to client-side
  // filtering when there's no project context (e.g. single-run page).
  const query = inputValue.trim();
  const serverMode = !!organizationId && !!projectName;
  const { results: searchResults, isSearching } = useTagSearch(
    organizationId,
    projectName,
    inputValue,
  );

  // Candidate tags for the checkbox list, capped so a project with tens of
  // thousands of tags can't bloat the popover DOM. Search filters the full
  // set (server-side when possible) before the cap is applied.
  //
  // `newlyAdded` are tags the user just created in this popover session
  // (in pendingTags but not yet on any run, so they don't appear in the
  // server-search results or the loaded-run set). Surfaced above the
  // regular candidates so the user gets immediate confirmation that the
  // tag was created and selected.
  const { newlyAdded, candidates, truncated, hasExactMatch } = useMemo(() => {
    const base = serverMode
      ? query
        ? searchResults
        : allTags
      : query
        ? fuzzyFilter(allTags, query)
        : allTags;
    const baseSet = new Set(base);

    const pendingNotInBase = pendingTags.filter((t) => !baseSet.has(t));
    const newlyAdded = query
      ? pendingNotInBase.filter((t) =>
          t.toLowerCase().includes(query.toLowerCase()),
        )
      : pendingNotInBase;

    const capped = base.slice(0, TAG_SEARCH_LIMIT);
    const cappedSet = new Set(capped);
    // Keep already-selected base tags mounted even if they fall past the cap.
    const hiddenSelected = pendingTags.filter(
      (t) => baseSet.has(t) && !cappedSet.has(t),
    );
    const candidates = hiddenSelected.length
      ? [...capped, ...hiddenSelected]
      : capped;

    const hasExactMatch =
      !!query && (baseSet.has(query) || pendingTags.includes(query));

    const truncated =
      base.length > capped.length ||
      (serverMode && query.length > 0 && searchResults.length >= TAG_SEARCH_LIMIT);

    return { newlyAdded, candidates, truncated, hasExactMatch };
  }, [serverMode, query, searchResults, allTags, pendingTags]);

  // Inline "Create '<query>'" row at the top of the list whenever the query
  // doesn't already match an existing or pending tag exactly.
  const showCreate = !!query && !hasExactMatch && !isSearching;

  // cmdk persists its "selected" item across renders and scrollIntoView's
  // it whenever the items change — which buries the Create row at the top
  // every time new server results arrive. Reset the list scroll *after*
  // every render that could have changed the items (query change OR
  // debounced search results coming back). requestAnimationFrame defers
  // past cmdk's own scrollIntoView so we win the race.
  const popoverContentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = popoverContentRef.current?.querySelector(
      '[data-slot="command-list"]',
    ) as HTMLElement | null;
    if (!list) return;
    const id = requestAnimationFrame(() => { list.scrollTop = 0; });
    return () => cancelAnimationFrame(id);
  }, [query, searchResults]);

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        if (isOpen) {
          appliedRef.current = false;
          setOpen(true);
          onOpenChangeProp?.(true);
        } else {
          // Auto-save pending changes on close (click-outside, Escape, etc.)
          if (hasChanges && !appliedRef.current) {
            onTagsUpdate(pendingTags);
          }
          setOpen(false);
          onOpenChangeProp?.(false);
        }
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        ref={popoverContentRef}
        // Cap to the actual room Radix has placed us in (viewport edge
        // minus trigger position), not the full viewport. Otherwise the
        // popover can extend past the bottom edge when the trigger is
        // mid-screen and adding rows (e.g. the inline "Create" row) at
        // the top pushes Apply off-screen.
        className="flex w-64 max-h-[var(--radix-popover-content-available-height)] flex-col overflow-hidden p-0"
        align={align}
        collisionPadding={8}
        onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
      >
        {/* Scrollable middle: command + pending tags. Apply/Cancel are
            kept outside this wrapper so they're always pinned at the
            bottom of the popover, never clipped by overflow. The wrapper
            scrolls as a last-resort fallback for very short viewports
            where even the capped inner sections don't all fit. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Command shouldFilter={false}>
          <div className="relative">
            <CommandInput
              placeholder="Search or add tag..."
              value={inputValue}
              maxLength={30}
              onValueChange={(v) => { setInputValue(v.slice(0, 30)); setBaselineError(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && inputValue.trim()) {
                  e.preventDefault();
                  handleAddNewTag();
                }
              }}
            />
            {isSearching && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
          <CommandList className="max-h-44">
            {/* Inline "Create '<query>'" affordance at the top of the list,
                visible whenever the query has no exact match — even when
                there are partial matches below. */}
            {showCreate && (
              <button
                type="button"
                data-testid="tag-editor-create"
                className="flex w-full items-center gap-2 border-b px-2 py-1.5 text-sm font-medium text-primary hover:bg-accent"
                onClick={handleAddNewTag}
              >
                <Plus className="h-4 w-4 shrink-0" />
                <span className="truncate">Create "{query}"</span>
              </button>
            )}
            <CommandEmpty>
              {isSearching ? (
                <span className="text-muted-foreground">Searching…</span>
              ) : showCreate ? null : (
                emptyText
              )}
            </CommandEmpty>
            <CommandGroup>
              {/* Tags the user just created in this session — surfaced at
                  the top, always rendered as selected. */}
              {newlyAdded.map((tag) => (
                <CommandItem
                  key={`new:${tag}`}
                  value={tag}
                  onSelect={() => handleTagToggle(tag)}
                >
                  <div className="mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </div>
                  <span className="truncate">{tag}</span>
                </CommandItem>
              ))}
              {candidates.map((tag) => {
                const isSelected = pendingTags.includes(tag);
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
            {linearConfigured && organizationId && inputValue.trim() && (() => {
              const raw = inputValue.trim();

              // Only show Linear picker when input has a recognized prefix with a search term after it.
              // This avoids firing Linear API calls for partial typing like "l", "li", "lin", etc.
              const prefixMatch = raw.match(/^(linear|baseline):(.+)/i);
              if (!prefixMatch) return null;

              const tagPrefix = prefixMatch[1].toLowerCase() === "baseline" ? "baseline" as const : "linear" as const;
              const searchQuery = prefixMatch[2];

              return (
                <LinearIssuePicker
                  organizationId={organizationId}
                  searchQuery={searchQuery}
                  selectedTags={pendingTags}
                  tagPrefix={tagPrefix}
                  onSelectIssue={(identifier) => {
                    const tag = `${tagPrefix}:${identifier}`;
                    if (pendingTags.includes(tag)) return;
                    if (pendingTags.length >= MAX_TAGS_PER_RUN) {
                      setBaselineError(`A run can have at most ${MAX_TAGS_PER_RUN} tags`);
                      return;
                    }
                    if (tagPrefix === "baseline" && hasExistingBaseline(identifier.toUpperCase(), pendingTags)) {
                      setBaselineError(`A baseline for ${identifier} already exists on this run`);
                      return;
                    }
                    setBaselineError(null);
                    setPendingTags([...pendingTags, tag]);
                    setInputValue("");
                  }}
                />
              );
            })()}
          </CommandList>
          {truncated && (
            <div className="border-t px-2 py-1.5 text-xs text-muted-foreground">
              max {TAG_SEARCH_LIMIT} — search for more
            </div>
          )}
        </Command>
        {baselineError && (
          <div
            data-testid="tag-editor-error"
            className="border-t px-3 py-2 text-xs text-destructive"
          >
            {baselineError}
          </div>
        )}
        {pendingTags.length > 0 && (
          <div className="border-t p-2">
            <div className="text-xs text-muted-foreground mb-1">
              {hasChanges ? "Pending tags:" : "Current tags:"}
            </div>
            <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
              {pendingTags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="gap-1 pr-1 text-xs max-w-full"
                  title={tag}
                >
                  <span className="truncate">{tag}</span>
                  <button
                    className="ml-1 rounded-full hover:bg-muted"
                    onClick={(e) => handleRemoveTag(e, tag)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        )}
        </div>
        {hasChanges && (
          <div className="shrink-0 border-t p-2 flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              Cancel
            </Button>
            <Button size="sm" data-testid="tag-editor-apply" onClick={handleApply}>
              Apply
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
