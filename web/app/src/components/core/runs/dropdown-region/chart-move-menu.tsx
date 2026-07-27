import { useState } from "react";
import { FolderInput, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChartsLayoutEdit } from "@/components/charts/context/charts-layout-edit-context";
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

/**
 * Edit-mode hover control on a chart card: a searchable "Move to section…"
 * picker (wandb-style), the usable path when the target section is a page of
 * scrolling away from a drag. Renders nothing outside layout-edit mode.
 */
export function ChartMoveMenu({
  groupId,
  metricName,
}: {
  groupId: string;
  metricName: string | undefined;
}) {
  const layoutEdit = useChartsLayoutEdit();
  const [open, setOpen] = useState(false);
  if (!layoutEdit || !metricName) {
    return null;
  }
  // Composite value (name::groupId) disambiguates duplicate display names for cmdk keyboard selection
  const targets = layoutEdit
    .listSections()
    .filter((s) => s.groupId !== groupId);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "absolute -left-2 top-5 z-30 h-6 w-6 rounded-full border bg-background p-1 text-muted-foreground shadow transition-opacity hover:text-foreground",
            "opacity-0 group-hover:opacity-100",
            open && "!opacity-100",
          )}
          aria-label="Move chart to section"
          title="Move to section…"
          data-testid="charts-layout-move-menu"
        >
          <FolderInput className="h-full w-full" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Move to section…" />
          <CommandList>
            <CommandEmpty>No sections found.</CommandEmpty>
            <CommandGroup>
              {targets.map((s) => (
                <CommandItem
                  key={s.groupId}
                  value={`${s.name}::${s.groupId}`}
                  onSelect={() => {
                    layoutEdit.moveItemToSection(groupId, metricName, s.groupId);
                    setOpen(false);
                  }}
                >
                  {s.name}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                value="__new-section"
                onSelect={() => {
                  layoutEdit.moveItemToNewSection(groupId, metricName);
                  setOpen(false);
                }}
                data-testid="charts-layout-move-menu-new"
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                New section…
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
