import { useState, memo, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Minus, Plus, Shuffle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { usePaletteType, type PaletteType } from "@/components/ui/color-picker";
import type { Run } from "../../~queries/list-runs";

/** Render "1 run" / "5 runs", "1 leaf group" / "3 leaf groups" etc.
 *  Keeps the count + noun together so all the popover labels stay
 *  consistent on the singular/plural boundary. */
function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

interface VisibilityOptionsProps {
  selectedRunsWithColors: Record<string, { run: Run; color: string }>;
  onSelectFirstN: (n: number) => void;
  onSelectAllOnPage: (pageRunIds: string[]) => void;
  onDeselectAllOnPage: (pageRunIds: string[]) => void;
  onDeselectAll: () => void;
  onShuffleColors: () => void;
  onReassignAllColors: () => void;
  showOnlySelected: boolean;
  onShowOnlySelectedChange: (value: boolean) => void;
  pinSelectedToTop: boolean;
  onPinSelectedToTopChange: (value: boolean) => void;
  pageRunIds: string[];
  deselectablePageRunIds: string[];
  /** Grouped-mode parallel inputs (only used when isGrouped). Count =
   *  number of top-level buckets on the current page. runCount = sum
   *  of leaf runs across those buckets. Click handlers lazy-fetch the
   *  leaf run IDs and call selectAllByIds / deselectByIds. */
  groupedBucketsOnPage: number;
  groupedRunsOnPage: number;
  /** Sum of immediate-next-level distinct-value counts across the
   *  visible page. Only added to the on-page label as "(X leaf
   *  groups)" when groupByLength === 2 (next level = leaf). */
  groupedSubgroupsOnPage: number;
  /** Count of distinct outermost groups with ≥1 selected run. */
  selectedGroupCount: number;
  /** Count of distinct leaf groups with ≥1 selected run. Only
   *  meaningful when groupByLength ≥ 2 — at depth 1 the outermost
   *  IS the leaf so this duplicates selectedGroupCount. */
  selectedLeafGroupCount: number;
  /** Depth of active grouping. Drives which noun is rendered:
   *  depth 1 → just "(N groups)"; depth ≥ 2 → "(N groups) (X leaf
   *  groups)". */
  groupByLength: number;
  onSelectAllGroupsOnPage: () => void;
  onDeselectAllGroupsOnPage: () => void;
  totalRunCount: number;
  hiddenCount: number;
  onShowAllRuns: () => void;
  onHideAllRuns: () => void;
  /** Page has active groupBy. Both DOS and Pin compose with the
   *  bucket tree by filtering/reordering buckets and leaf runs
   *  client-side based on selectedAncestorPaths (see group-by-utils
   *  computeSelectedAncestorPaths). The two toggles stay enabled. */
  isGrouped?: boolean;
}

export const VisibilityOptions = memo(function VisibilityOptions({
  selectedRunsWithColors,
  onSelectFirstN,
  onSelectAllOnPage,
  onDeselectAllOnPage,
  onDeselectAll,
  onShuffleColors,
  onReassignAllColors,
  showOnlySelected,
  onShowOnlySelectedChange,
  pinSelectedToTop,
  onPinSelectedToTopChange,
  pageRunIds,
  deselectablePageRunIds,
  groupedBucketsOnPage,
  groupedRunsOnPage,
  groupedSubgroupsOnPage,
  selectedGroupCount,
  selectedLeafGroupCount,
  groupByLength,
  onSelectAllGroupsOnPage,
  onDeselectAllGroupsOnPage,
  totalRunCount,
  hiddenCount,
  onShowAllRuns,
  onHideAllRuns,
  isGrouped,
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
        <div data-testid="visibility-dropdown" className="absolute right-0 top-full z-50 mt-1 w-72 rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95">
          <div className="p-3 space-y-3">
            {/* Auto-select first N */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                {/* Plain "Auto-select first" — the counter on the right
                    + the "Select first N runs" Apply button below
                    spell out the unit so the user can't mistake it for
                    selecting groups. */}
                <span className="text-sm">Auto-select first</span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-6 w-6"
                    onClick={handleDecrement}
                    data-testid="autoselect-decrement-btn"
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
                    data-testid="autoselect-increment-btn"
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
                Select first {autoSelectCount} {autoSelectCount === 1 ? "run" : "runs"}
              </Button>
            </div>

            <Separator />

            {/* Display only selected — composes with grouping by
                filtering each level's buckets to selected-containing
                only (see GroupedBucketTree). Two-line layout in
                grouped mode keeps the main label readable when both
                the group and run counts are long. */}
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="show-only-selected" className="cursor-pointer flex-1 min-w-0">
                <div className="text-sm">Display only selected{isGrouped ? "" : ` (${selectedCount})`}</div>
                {/* At depth ≥ 2, also surface the leaf-group count
                    (selectedLeafGroupCount comes off
                    selectedAncestorPaths[lastDepth] upstream). At
                    depth 1 the outermost IS the leaf so we'd be
                    repeating selectedGroupCount — skip. */}
                {isGrouped && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    ({plural(selectedGroupCount, "group")})
                    {groupByLength >= 2 && ` (${plural(selectedLeafGroupCount, "leaf group")})`}
                    {" "}({plural(selectedCount, "run")})
                  </div>
                )}
              </Label>
              <Switch
                id="show-only-selected"
                checked={showOnlySelected}
                onCheckedChange={onShowOnlySelectedChange}
              />
            </div>

            {/* Pin selected to top — composes with grouping by
                reordering buckets and leaf runs so selected-containing
                items come first at every level. */}
            <div className="flex items-center justify-between">
              <Label htmlFor="pin-selected-top" className="text-sm cursor-pointer">
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

            {/* Select all on page / Deselect all on page. In flat
                mode they act on the visible page slice (pageRunIds).
                In grouped mode they act on every leaf run inside the
                visible top-level buckets — selectAllInBucket /
                deselectBucket logic, but iterated externally so the
                visibility popover can drive it. */}
            {/* Button heights: h-8 in flat mode (single-line content)
                and h-auto + py-1.5 in grouped mode so the two-line
                "(N groups) (M runs)" sub-text breathes. The sub-text
                is left-aligned under the main label to match the
                Display-only-selected stack above. */}
            <div className="space-y-1">
              {isGrouped ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full h-auto py-1.5 text-xs justify-start flex-col items-start gap-0.5"
                    onClick={onSelectAllGroupsOnPage}
                    disabled={groupedBucketsOnPage === 0}
                  >
                    <span>Select all on page</span>
                    <span className="text-muted-foreground font-normal">
                      ({plural(groupedBucketsOnPage, "group")})
                      {groupByLength === 2 && ` (${plural(groupedSubgroupsOnPage, "leaf group")})`}
                      {" "}({plural(groupedRunsOnPage, "run")})
                    </span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full h-auto py-1.5 text-xs justify-start flex-col items-start gap-0.5"
                    onClick={onDeselectAllGroupsOnPage}
                    disabled={groupedBucketsOnPage === 0}
                  >
                    <span>Deselect all on page</span>
                    <span className="text-muted-foreground font-normal">
                      ({plural(groupedBucketsOnPage, "group")})
                      {groupByLength === 2 && ` (${plural(groupedSubgroupsOnPage, "leaf group")})`}
                      {" "}({plural(groupedRunsOnPage, "run")})
                    </span>
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full h-8 text-xs justify-start"
                    onClick={() => onSelectAllOnPage(pageRunIds)}
                    disabled={pageRunIds.length === 0}
                  >
                    Select all on page ({pageRunIds.length})
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full h-8 text-xs justify-start"
                    onClick={() => onDeselectAllOnPage(deselectablePageRunIds)}
                    disabled={deselectablePageRunIds.length === 0}
                  >
                    Deselect all on page ({deselectablePageRunIds.length})
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-8 text-xs justify-start"
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
