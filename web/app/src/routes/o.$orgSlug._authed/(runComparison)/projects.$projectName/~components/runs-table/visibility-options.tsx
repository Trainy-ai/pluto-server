import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Eye, Minus, Plus, Shuffle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { Run } from "../../~queries/list-runs";

interface VisibilityOptionsProps {
  runs: Run[];
  selectedRunsWithColors: Record<string, { run: Run; color: string }>;
  onSelectFirstN: (n: number) => void;
  onSelectAllOnPage: (pageRunIds: string[]) => void;
  onDeselectAll: () => void;
  onShuffleColors: () => void;
  showOnlySelected: boolean;
  onShowOnlySelectedChange: (value: boolean) => void;
  pageRunIds: string[];
  totalRunCount: number;
}

export function VisibilityOptions({
  runs,
  selectedRunsWithColors,
  onSelectFirstN,
  onSelectAllOnPage,
  onDeselectAll,
  onShuffleColors,
  showOnlySelected,
  onShowOnlySelectedChange,
  pageRunIds,
  totalRunCount,
}: VisibilityOptionsProps) {
  const [open, setOpen] = useState(false);
  const [autoSelectCount, setAutoSelectCount] = useState(5);

  const selectedCount = Object.keys(selectedRunsWithColors).length;

  const handleDecrement = () => {
    setAutoSelectCount((prev) => Math.max(1, prev - 1));
  };

  const handleIncrement = () => {
    setAutoSelectCount((prev) => Math.min(100, prev + 1));
  };

  const handleAutoSelect = () => {
    onSelectFirstN(autoSelectCount);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label="Visibility options"
          className="p-1 hover:bg-accent rounded-sm transition-colors"
        >
          <Eye className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start" side="bottom">
        <div className="p-3 space-y-3">
          {/* Auto-select first N */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm">Auto-select first</span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-6 w-6"
                  onClick={handleDecrement}
                >
                  <Minus className="h-3 w-3" />
                </Button>
                <span className="w-8 text-center text-sm font-medium">
                  {autoSelectCount}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-6 w-6"
                  onClick={handleIncrement}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="w-full h-7 text-xs"
              onClick={handleAutoSelect}
            >
              Apply
            </Button>
          </div>

          <Separator />

          {/* Display only selected toggle */}
          <div className="flex items-center justify-between">
            <Label htmlFor="show-only-selected" className="text-sm cursor-pointer">
              Display only selected ({selectedCount})
            </Label>
            <Switch
              id="show-only-selected"
              checked={showOnlySelected}
              onCheckedChange={onShowOnlySelectedChange}
            />
          </div>

          <Separator />

          {/* Select all on page / Deselect all */}
          <div className="space-y-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full h-7 text-xs justify-start"
              onClick={() => onSelectAllOnPage(pageRunIds)}
            >
              Select all on page ({pageRunIds.length})
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full h-7 text-xs justify-start"
              onClick={onDeselectAll}
            >
              Deselect all
            </Button>
          </div>

          <Separator />

          {/* Shuffle colors */}
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-7 text-xs justify-start gap-2"
            onClick={onShuffleColors}
          >
            <Shuffle className="h-3 w-3" />
            Shuffle colors
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
