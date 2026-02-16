import { Input } from "@/components/ui/input";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ColumnDataType } from "@/lib/filters";

interface FilterValueInputProps {
  dataType: ColumnDataType;
  operator: string;
  values: unknown[];
  onChange: (values: unknown[]) => void;
  options?: { label: string; value: string }[];
  showValidation?: boolean;
}

export function FilterValueInput({
  dataType,
  operator,
  values,
  onChange,
  options,
  showValidation,
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
        />
      );

    case "multiOption":
      return (
        <OptionSelect
          options={options ?? []}
          selected={Array.isArray(values[0]) ? (values[0] as string[]) : (values as string[])}
          onChange={(selected) => onChange([selected])}
          multi
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
}: {
  options: { label: string; value: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
  multi: boolean;
}) {
  if (options.length === 0) {
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

  return (
    <Command className="max-h-40">
      <CommandList>
        <CommandGroup>
          {options.map((opt) => {
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
    </Command>
  );
}
