import { CheckIcon, ChevronDownIcon, PlusIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
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
  contextChips,
  runLabel,
  type ContextChip,
  type ContextChipKey,
  type CopilotPageContext,
  type CopilotRunPicker,
  type CopilotRunRef,
} from "@/lib/copilot-page-context";
import { cn } from "@/lib/utils";

interface CopilotContextChipsProps {
  ctx: CopilotPageContext;
  excluded: ReadonlySet<ContextChipKey>;
  onToggleChip: (key: ContextChipKey) => void;
}

/**
 * What the copilot will send along with the next message. Removing a chip
 * leaves it out of the context (it stays visible, struck through, so it can
 * be added back); on a project page the runs chip also opens a picker that
 * changes the actual selection, since the runs table may be hidden.
 */
export function CopilotContextChips({
  ctx,
  excluded,
  onToggleChip,
}: CopilotContextChipsProps) {
  const chips = contextChips(ctx);
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      data-testid="copilot-context-chips"
    >
      <span className="text-[11px] text-muted-foreground">Context</span>
      {chips.map((chip) =>
        chip.key === "runs" && ctx.runPicker && !excluded.has("runs") ? (
          <RunsChip
            key={chip.key}
            chip={chip}
            selected={ctx.runs ?? []}
            picker={ctx.runPicker}
            onRemove={() => onToggleChip(chip.key)}
          />
        ) : (
          <Chip
            key={chip.key}
            chip={chip}
            isExcluded={excluded.has(chip.key)}
            onToggle={() => onToggleChip(chip.key)}
          />
        ),
      )}
    </div>
  );
}

function Chip({
  chip,
  isExcluded,
  onToggle,
}: {
  chip: ContextChip;
  isExcluded: boolean;
  onToggle: () => void;
}) {
  if (isExcluded) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className={chipClass("border-dashed text-muted-foreground line-through")}
        aria-label={`Add ${chip.label} back to context`}
        data-testid={`copilot-chip-${chip.key}`}
        data-excluded="true"
      >
        <PlusIcon className="size-3" />
        {chip.label}
      </button>
    );
  }
  return (
    <span className={chipClass()} data-testid={`copilot-chip-${chip.key}`}>
      <span className="max-w-40 truncate">{chip.label}</span>
      {chip.removable && <RemoveButton label={chip.label} onClick={onToggle} />}
    </span>
  );
}

function RunsChip({
  chip,
  selected,
  picker,
  onRemove,
}: {
  chip: ContextChip;
  selected: CopilotRunRef[];
  picker: CopilotRunPicker;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedIds = useMemo(
    () => new Set(selected.map((run) => run.id)),
    [selected],
  );
  // Selected runs first (they may not be on the loaded table page), then the
  // remaining candidates in table order.
  const options = useMemo(
    () => [
      ...selected,
      ...picker.candidates.filter((run) => !selectedIds.has(run.id)),
    ],
    [selected, picker.candidates, selectedIds],
  );
  const atLimit = selected.length >= picker.limit;

  return (
    <span className={chipClass("pr-1")} data-testid="copilot-chip-runs">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-0.5 hover:underline"
            aria-label="Choose runs"
            data-testid="copilot-run-picker-trigger"
          >
            {chip.label}
            <ChevronDownIcon className="size-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <Command>
            <CommandInput placeholder="Search runs…" />
            <CommandList>
              <CommandEmpty>No runs on this page match.</CommandEmpty>
              <CommandGroup>
                {options.map((run) => {
                  const isSelected = selectedIds.has(run.id);
                  return (
                    <CommandItem
                      key={run.id}
                      value={`${runLabel(run)} ${run.name}`}
                      disabled={!isSelected && atLimit}
                      onSelect={() => picker.onToggle(run.id, !isSelected)}
                      data-testid="copilot-run-option"
                      data-selected={isSelected}
                    >
                      <CheckIcon
                        className={cn(
                          "size-3.5 shrink-0",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      {run.color && (
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: run.color }}
                        />
                      )}
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {runLabel(run)}
                      </span>
                      <span className="truncate">{run.name}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <RemoveButton label={chip.label} onClick={onRemove} />
    </span>
  );
}

function RemoveButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-sm opacity-60 hover:opacity-100"
      aria-label={`Remove ${label} from context`}
    >
      <XIcon className="size-3" />
    </button>
  );
}

function chipClass(extra?: string): string {
  return cn(
    "inline-flex h-6 items-center gap-1 rounded-full border bg-muted/50 px-2 text-[11px]",
    extra,
  );
}
