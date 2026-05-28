import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fuzzyFilter } from "@/lib/fuzzy-search";
import { useTagSearch, TAG_SEARCH_LIMIT } from "@/hooks/use-tag-search";
import type { ColumnDataType } from "@/lib/filters";

/** Identifies a project so a value dropdown can search the backend. */
export interface TagSearchContext {
  organizationId: string;
  projectName: string;
}

/**
 * Max option rows mounted at once. A project can accumulate thousands of
 * distinct values (e.g. tags); rendering them all would bloat the DOM.
 * Search filters the full list *before* this cap is applied, so every
 * value stays reachable — only the rendered slice is bounded.
 */
const OPTION_RENDER_LIMIT = 500;

interface FilterValueInputProps {
  dataType: ColumnDataType;
  operator: string;
  values: unknown[];
  onChange: (values: unknown[]) => void;
  options?: { label: string; value: string }[];
  showValidation?: boolean;
  /** When set, option dropdowns search the backend instead of the loaded set. */
  tagSearch?: TagSearchContext;
}

export function FilterValueInput({
  dataType,
  operator,
  values,
  onChange,
  options,
  showValidation,
  tagSearch,
}: FilterValueInputProps) {
  // "exists" / "not exists" need no value input
  if (operator === "exists" || operator === "not exists") {
    return null;
  }

  const isBetween = operator === "is between" || operator === "is not between";

  switch (dataType) {
    case "text":
      return (
        <Input
          placeholder="Enter value..."
          value={(values[0] as string) ?? ""}
          onChange={(e) => onChange([e.target.value])}
          className="h-8"
          autoFocus
        />
      );

    case "number":
      if (isBetween) {
        const hasMin = values[0] != null && String(values[0]) !== "";
        const hasMax = values[1] != null && String(values[1]) !== "";
        const needsBoth = hasMin !== hasMax;
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                placeholder="Min"
                value={hasMin ? String(values[0]) : ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  onChange([raw === "" ? undefined : raw, values[1]]);
                }}
                className="h-8"
                autoFocus
              />
              <span className="text-xs text-muted-foreground">and</span>
              <Input
                type="number"
                placeholder="Max"
                value={hasMax ? String(values[1]) : ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  onChange([values[0], raw === "" ? undefined : raw]);
                }}
                className="h-8"
              />
            </div>
            {showValidation && needsBoth && (
              <p className="text-xs text-destructive">Both min and max values are required</p>
            )}
          </div>
        );
      }
      return (
        <Input
          type="number"
          placeholder="Enter value..."
          value={values[0] != null ? String(values[0]) : ""}
          onChange={(e) => {
            const raw = e.target.value;
            onChange([raw === "" ? undefined : raw]);
          }}
          className="h-8"
          autoFocus
        />
      );

    case "date":
      if (isBetween) {
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <DateInput
                value={values[0] as string | undefined}
                onChange={(v) => onChange([v, values[1]])}
                autoFocus
              />
              <span className="text-xs text-muted-foreground">and</span>
              <DateInput
                value={values[1] as string | undefined}
                onChange={(v) => onChange([values[0], v])}
              />
            </div>
            <RelativeDateShortcuts onChange={(v1, v2) => onChange([v1, v2])} />
          </div>
        );
      }
      return (
        <div className="space-y-2">
          <DateInput
            value={values[0] as string | undefined}
            onChange={(v) => onChange([v])}
            autoFocus
          />
          <RelativeDateShortcuts onChange={(v1) => onChange([v1])} />
        </div>
      );

    case "option":
      return (
        <OptionSelect
          options={options ?? []}
          selected={values as string[]}
          onChange={onChange}
          multi={operator === "is any of" || operator === "is none of"}
          tagSearch={tagSearch}
        />
      );

    case "multiOption":
      return (
        <OptionSelect
          options={options ?? []}
          selected={Array.isArray(values[0]) ? (values[0] as string[]) : (values as string[])}
          onChange={(selected) => onChange([selected])}
          multi
          tagSearch={tagSearch}
        />
      );

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Parse a YYYY-MM-DD string into a local-midnight Date */
function localDateFromYMD(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Format a Date or ISO string as YYYY-MM-DD using local time */
function toYMD(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function DateInput({
  value,
  onChange,
  autoFocus,
}: {
  value: string | undefined;
  onChange: (val: string) => void;
  autoFocus?: boolean;
}) {
  // Seed the input from the stored value only as defaultValue
  const initialValue = value ? toYMD(value) : "";

  return (
    <Input
      type="date"
      defaultValue={initialValue}
      onChange={(e) => {
        // Only propagate when the browser has a fully valid date
        // (valueAsDate is null while the user is mid-typing a partial year)
        const d = e.target.valueAsDate;
        if (d && d.getFullYear() >= 1970) {
          onChange(localDateFromYMD(e.target.value).toISOString());
        }
      }}
      className="h-8"
      autoFocus={autoFocus}
    />
  );
}

function RelativeDateShortcuts({
  onChange,
}: {
  onChange: (v1: string, v2?: string) => void;
}) {
  const shortcuts = [
    { label: "Last 24h", hours: 24 },
    { label: "Last 7d", hours: 7 * 24 },
    { label: "Last 30d", hours: 30 * 24 },
  ];

  return (
    <div className="flex gap-1">
      {shortcuts.map((s) => (
        <button
          key={s.label}
          type="button"
          className="rounded border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
          onClick={() => {
            const now = new Date();
            const past = new Date(now.getTime() - s.hours * 60 * 60 * 1000);
            onChange(past.toISOString(), now.toISOString());
          }}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

function OptionSelect({
  options,
  selected,
  onChange,
  multi,
  tagSearch,
}: {
  options: { label: string; value: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
  multi: boolean;
  tagSearch?: TagSearchContext;
}) {
  const [query, setQuery] = useState("");

  // When tagSearch is set, typing queries the backend across every run in
  // the project; otherwise we fuzzy-filter the locally-provided options.
  const serverMode = !!tagSearch;
  const { results, isSearching } = useTagSearch(
    tagSearch?.organizationId,
    tagSearch?.projectName,
    serverMode ? query : ""
  );

  const matched = useMemo(() => {
    const q = query.trim();
    if (serverMode) {
      // Empty query → loaded-run tags; active query → backend results.
      if (!q) {
        return options;
      }
      return results.map((t) => ({ label: t, value: t }));
    }
    // Fuzzy-filter the FULL option list (not just the rendered slice) so
    // search reaches every value, including ones past the render cap.
    if (!q) {
      return options;
    }
    const ranked = fuzzyFilter(
      options.map((o) => o.label),
      q
    );
    const rankByLabel = new Map(ranked.map((label, i) => [label, i] as const));
    return options
      .filter((o) => rankByLabel.has(o.label))
      .sort((a, b) => rankByLabel.get(a.label)! - rankByLabel.get(b.label)!);
  }, [serverMode, options, query, results]);

  // Free-text fallback for option fields with no known values (and never
  // for tag search, which always wants the searchable dropdown).
  if (options.length === 0 && !serverMode) {
    return (
      <Input
        placeholder="Enter value..."
        value={selected[0] ?? ""}
        onChange={(e) => onChange([e.target.value])}
        className="h-8"
        autoFocus
      />
    );
  }

  // Tag search always shows the box; plain option lists only once long.
  const showSearch = serverMode || options.length > 7;

  // Cap how many rows we mount. Already-selected values are always kept
  // mounted so they stay uncheckable even when they fall past the cap.
  const visible = matched.slice(0, OPTION_RENDER_LIMIT);
  let rendered = visible;
  if (matched.length > visible.length) {
    const visibleValues = new Set(visible.map((o) => o.value));
    const selectedValues = new Set(selected);
    const hiddenSelected = matched.filter(
      (o) => selectedValues.has(o.value) && !visibleValues.has(o.value)
    );
    if (hiddenSelected.length > 0) {
      rendered = [...visible, ...hiddenSelected];
    }
  }
  const clientTruncated = matched.length > visible.length;
  const serverTruncated =
    serverMode && query.trim().length > 0 && results.length >= TAG_SEARCH_LIMIT;

  return (
    <Command className="max-h-52" shouldFilter={false}>
      {showSearch && (
        <div className="relative">
          <CommandInput
            placeholder={serverMode ? "Search all tags..." : "Search options..."}
            autoFocus
            value={query}
            onValueChange={setQuery}
            data-testid="filter-option-search"
          />
          {isSearching && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
      )}
      <CommandList>
        <CommandEmpty>
          {isSearching
            ? "Searching…"
            : serverMode && !query.trim()
              ? "Type to search tags."
              : "No matches."}
        </CommandEmpty>
        <CommandGroup>
          {rendered.map((opt) => {
            const isSelected = selected.includes(opt.value);
            return (
              <CommandItem
                key={opt.value}
                value={opt.value}
                onSelect={() => {
                  if (multi) {
                    const next = isSelected
                      ? selected.filter((v) => v !== opt.value)
                      : [...selected, opt.value];
                    onChange(next);
                  } else {
                    onChange([opt.value]);
                  }
                }}
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
                <span>{opt.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
      {(clientTruncated || serverTruncated) && (
        <div className="border-t px-2 py-1.5 text-xs text-muted-foreground">
          max {OPTION_RENDER_LIMIT} — search for more
        </div>
      )}
    </Command>
  );
}
