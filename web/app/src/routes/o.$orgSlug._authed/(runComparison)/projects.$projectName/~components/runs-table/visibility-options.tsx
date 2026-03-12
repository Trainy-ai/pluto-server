import { useState, memo, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Minus, Plus, Shuffle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { usePaletteType, type PaletteType } from "@/components/ui/color-picker";
import type { Run } from "../../~queries/list-runs";

interface VisibilityOptionsProps {
  selectedRunsWithColors: Record<string, { run: Run; color: string }>;
  onSelectFirstN: (n: number) => void;
  onSelectAllOnPage: (pageRunIds: string[]) => void;
  onDeselectAll: () => void;
  onShuffleColors: () => void;
  onReassignAllColors: () => void;
  showOnlySelected: boolean;
  onShowOnlySelectedChange: (value: boolean) => void;
  pinSelectedToTop: boolean;
  onPinSelectedToTopChange: (value: boolean) => void;
  pageRunIds: string[];
  totalRunCount: number;
  hiddenCount: number;
  onShowAllRuns: () => void;
  onHideAllRuns: () => void;
}

export const VisibilityOptions = memo(function VisibilityOptions({
  selectedRunsWithColors,
  onSelectFirstN,
  onSelectAllOnPage,
  onDeselectAll,
  onShuffleColors,
  onReassignAllColors,
  showOnlySelected,
  onShowOnlySelectedChange,
  pinSelectedToTop,
  onPinSelectedToTopChange,
  pageRunIds,
  totalRunCount,
  hiddenCount,
  onShowAllRuns,
  onHideAllRuns,
}: VisibilityOptionsProps) {
  const [open, setOpen] = useState(false);
  const [autoSelectCount, setAutoSelectCount] = useState(5);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Close on click outside
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="outline"
        size="icon"
        aria-label="Visibility options"
        className="h-9 w-9"
        onClick={() => setOpen(!open)}
      >
        <Eye className="h-4 w-4" />
      </Button>

      {open && (
        <div data-testid="visibility-dropdown" className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95">
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
              <Label
                htmlFor="show-only-selected"
                className="text-sm cursor-pointer"
              >
                Display only selected ({selectedCount})
              </Label>
              <Switch
                id="show-only-selected"
                checked={showOnlySelected}
                onCheckedChange={onShowOnlySelectedChange}
              />
            </div>

            {/* Pin selected to top toggle */}
            <div className="flex items-center justify-between">
              <Label
                htmlFor="pin-selected-top"
                className="text-sm cursor-pointer"
              >
                Pin selected to top
              </Label>
              <Switch
                id="pin-selected-top"
                checked={pinSelectedToTop}
                onCheckedChange={onPinSelectedToTopChange}
              />
            </div>

            <Separator />

            {/* Chart visibility controls */}
            <div className="space-y-1">
              {hiddenCount > 0 && (
                <div className="flex items-center justify-between text-xs text-muted-foreground px-1 mb-1">
                  <span className="flex items-center gap-1">
                    <EyeOff className="h-3 w-3" />
                    {hiddenCount} hidden from charts
                  </span>
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-7 text-xs justify-start gap-2"
                onClick={onShowAllRuns}
                disabled={hiddenCount === 0}
              >
                <Eye className="h-3 w-3" />
                Show all selected on charts
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-7 text-xs justify-start gap-2"
                onClick={onHideAllRuns}
                disabled={selectedCount === 0 || hiddenCount === selectedCount}
              >
                <EyeOff className="h-3 w-3" />
                Hide all selected from charts
              </Button>
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

            {/* Color palette selector */}
            <PaletteSelector onPaletteChange={onReassignAllColors} />

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
        </div>
      )}
    </div>
  );
});

function PaletteSelector({ onPaletteChange }: { onPaletteChange: () => void }) {
  const [paletteType, setPaletteType] = usePaletteType();

  const handleSwitch = (type: PaletteType) => {
    if (type === paletteType) return;
    setPaletteType(type);
    // Wait a tick for the palette change event to propagate to useChartColors,
    // then reassign all selected runs with the new palette colors.
    requestAnimationFrame(() => onPaletteChange());
  };

  return (
    <div className="space-y-1.5">
      <span className="text-xs text-muted-foreground">Color palette</span>
      <div className="flex gap-1 rounded-md bg-muted p-0.5">
        <button
          className={cn(
            "flex-1 rounded-sm px-2 py-1 text-xs font-medium transition-colors",
            paletteType === "categorical"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => handleSwitch("categorical")}
        >
          Categorical
        </button>
        <button
          className={cn(
            "flex-1 rounded-sm px-2 py-1 text-xs font-medium transition-colors",
            paletteType === "vivid"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => handleSwitch("vivid")}
        >
          Vivid
        </button>
      </div>
    </div>
  );
}
