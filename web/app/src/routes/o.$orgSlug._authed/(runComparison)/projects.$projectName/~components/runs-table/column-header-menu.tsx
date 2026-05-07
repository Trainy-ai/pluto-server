import { useState, useRef, useEffect } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  MoreHorizontal,
  Pencil,
  Palette,
  Pin,
  PinOff,
  X,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Subset of COLORS from color-picker for the column background tint
const COLUMN_COLORS = [
  "#FF6B6B", "#FFA94D", "#FFD43B", "#51CF66",
  "#20C997", "#22B8CF", "#339AF0", "#5C7CFA",
  "#7950F2", "#E64980", "#868E96", "#343A40",
];

export interface ColumnHeaderMenuProps {
  label: string;
  columnId: string;
  canRemove: boolean;
  canSort: boolean;
  sortDirection: "asc" | "desc" | false;
  backgroundColor?: string;
  isPinned?: boolean;
  onTogglePin?: () => void;
  onSort: (direction: "asc" | "desc" | false) => void;
  onRename: (newName: string) => void;
  onSetColor: (color: string | undefined) => void;
  onRemove?: () => void;
  /** Whether this is a metric column (shows "Pin images to best step" option) */
  isMetric?: boolean;
  /**
   * Callback to pin images at the argmin/argmax step for this metric.
   * The optional `toleranceOverride` lets the caller short-circuit the
   * stored tolerance for THIS pin only — used when the user has an
   * unsaved tolerance draft in the dropdown and clicks a pin button
   * before pressing Enter, so the click uses the typed value rather
   * than the previously-stored one.
   */
  onPinImagesToBestStep?: (
    mode: "argmin" | "argmax" | "argmin-with-image" | "argmax-with-image",
    toleranceOverride?: number,
  ) => void;
  /**
   * Project-wide tolerance used by the "(with image)" variants. When an
   * image's log cadence doesn't overlap the metric's cadence (common for
   * training loops that log metrics every N steps and images every M steps
   * offset by some delta), the nearest-snap algorithm filters to metric
   * rows within this many steps of any image before picking argmin/argmax.
   */
  bestStepToleranceSteps?: number;
  /**
   * Called when the user commits a new tolerance value from the inline
   * input inside "Find best step". The parent persists it to the project
   * via tRPC and re-renders with the new value.
   */
  onChangeBestStepTolerance?: (next: number) => void;
}

export function ColumnHeaderMenu({
  label,
  canRemove,
  canSort,
  sortDirection,
  backgroundColor,
  isPinned,
  onTogglePin,
  onSort,
  onRename,
  onSetColor,
  onRemove,
  isMetric,
  onPinImagesToBestStep,
  bestStepToleranceSteps,
  onChangeBestStepTolerance,
}: ColumnHeaderMenuProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);

  // Local draft value for the tolerance input — we don't fire the update on
  // every keystroke, only when the user presses Enter or moves focus away.
  // Sync from the prop when it changes (e.g. another tab/user edited it).
  const [toleranceDraft, setToleranceDraft] = useState<string>(
    bestStepToleranceSteps != null ? String(bestStepToleranceSteps) : "20",
  );
  useEffect(() => {
    if (bestStepToleranceSteps != null) {
      setToleranceDraft(String(bestStepToleranceSteps));
    }
  }, [bestStepToleranceSteps]);

  // Parse the current draft into a usable number, or null if invalid.
  // Used both by the explicit Enter commit and by the pin-button click
  // wrapper that needs to read the freshest typed value.
  const parsedDraft = (() => {
    const n = parseInt(toleranceDraft, 10);
    return Number.isNaN(n) || n < 0 ? null : n;
  })();

  const commitToleranceDraft = () => {
    if (!onChangeBestStepTolerance) return;
    if (parsedDraft === null) {
      // Reject invalid → revert to current.
      setToleranceDraft(
        bestStepToleranceSteps != null ? String(bestStepToleranceSteps) : "20",
      );
      return;
    }
    if (parsedDraft !== bestStepToleranceSteps) {
      onChangeBestStepTolerance(parsedDraft);
    }
  };

  // Smart blur handler. Radix focuses the next menu item on hover, which
  // fires `blur` on this input. Without this guard the input would commit
  // on every hover — closing the menu mid-interaction. We only commit
  // when focus is leaving the dropdown content entirely (e.g. user
  // clicked outside, hit Escape, or tabbed past the menu).
  const handleToleranceBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const next = e.relatedTarget as Node | null;
    const menuRoot = e.currentTarget.closest('[role="menu"]');
    if (next && menuRoot && menuRoot.contains(next)) {
      // Focus is moving to another element inside the same submenu —
      // user is just navigating, not done editing.
      return;
    }
    commitToleranceDraft();
  };

  // Wrapper for pin-button clicks. Persists any unsaved tolerance draft
  // (so the value sticks for next time) AND passes it as a one-shot
  // override on this specific pin call, so the current click uses the
  // typed value even if the user never pressed Enter.
  const handlePinClick = (
    mode: "argmin" | "argmax" | "argmin-with-image" | "argmax-with-image",
  ) => {
    if (!onPinImagesToBestStep) return;
    const isWithImage = mode === "argmin-with-image" || mode === "argmax-with-image";
    const draftDiffers =
      parsedDraft !== null && parsedDraft !== bestStepToleranceSteps;
    if (isWithImage && draftDiffers && onChangeBestStepTolerance) {
      onChangeBestStepTolerance(parsedDraft);
    }
    const override = isWithImage && parsedDraft !== null ? parsedDraft : undefined;
    onPinImagesToBestStep(mode, override);
  };

  // Sync rename value when label changes
  useEffect(() => {
    setRenameValue(label);
  }, [label]);

  // Focus input when dialog opens
  useEffect(() => {
    if (renameOpen) {
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [renameOpen]);

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== label) {
      onRename(trimmed);
    }
    setRenameOpen(false);
  };

  return (
    <>
      <div className="flex w-full items-center gap-1 pr-5">
        <span className="truncate text-xs font-medium">{label}</span>
        {sortDirection && (
          <span className="flex-shrink-0">
            {sortDirection === "asc" ? (
              <ArrowUp className="h-3 w-3 text-primary" />
            ) : (
              <ArrowDown className="h-3 w-3 text-primary" />
            )}
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="absolute right-2.5 top-1/2 -translate-y-1/2 flex-shrink-0 rounded p-px opacity-0 transition-opacity group-hover:opacity-100 group-hover:bg-zinc-300 hover:bg-zinc-400 dark:group-hover:bg-zinc-600 dark:hover:bg-zinc-500 z-10"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {onTogglePin && (
              <>
                <DropdownMenuItem onClick={onTogglePin}>
                  {isPinned ? (
                    <PinOff className="mr-2 h-4 w-4" />
                  ) : (
                    <Pin className="mr-2 h-4 w-4" />
                  )}
                  {isPinned ? "Unpin column" : "Pin column"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {canSort && (
              <>
                <DropdownMenuItem
                  onClick={() => onSort(sortDirection === "asc" ? false : "asc")}
                >
                  <ArrowUp className="mr-2 h-4 w-4" />
                  Sort ascending
                  {sortDirection === "asc" && (
                    <span className="ml-auto text-xs text-primary">Active</span>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onSort(sortDirection === "desc" ? false : "desc")}
                >
                  <ArrowDown className="mr-2 h-4 w-4" />
                  Sort descending
                  {sortDirection === "desc" && (
                    <span className="ml-auto text-xs text-primary">Active</span>
                  )}
                </DropdownMenuItem>
                {sortDirection && (
                  <DropdownMenuItem onClick={() => onSort(false)}>
                    <ArrowUpDown className="mr-2 h-4 w-4" />
                    Clear sort
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
              </>
            )}
            {isMetric && onPinImagesToBestStep && (
              <>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Target className="mr-2 h-4 w-4" />
                    Find best step
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-72 max-w-[18rem]">
                    <DropdownMenuItem onClick={() => handlePinClick("argmin")}>
                      <span className="mr-2 w-4 text-center">★</span>
                      Pin steppers at min value
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handlePinClick("argmax")}>
                      <span className="mr-2 w-4 text-center">★</span>
                      Pin steppers at max value
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {/* Visually group the (with image) actions + their
                        tolerance input under a labeled section so it's
                        unambiguous that tolerance only governs the
                        image-coupled variants. */}
                    <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Pin to nearest image step
                    </DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => handlePinClick("argmin-with-image")}>
                      <span className="mr-2 w-4 text-center">★</span>
                      Pin steppers at min (with image)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handlePinClick("argmax-with-image")}>
                      <span className="mr-2 w-4 text-center">★</span>
                      Pin steppers at max (with image)
                    </DropdownMenuItem>
                    {onChangeBestStepTolerance && (
                      <div
                        className="w-full px-2 pb-2 pt-1"
                        // Block the dropdown from closing / stealing
                        // keyboard events while the user types in the
                        // inline tolerance input.
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <label className="flex items-center gap-2 text-xs font-medium">
                          <span className="whitespace-nowrap">Tolerance (steps):</span>
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            value={toleranceDraft}
                            onChange={(e) => setToleranceDraft(e.target.value)}
                            onBlur={handleToleranceBlur}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitToleranceDraft();
                              }
                            }}
                            className="h-6 w-16 px-2 py-0 text-xs"
                          />
                        </label>
                        <p className="mt-1.5 whitespace-normal break-words text-[11px] leading-snug text-muted-foreground">
                          Max gap between a metric step and the nearest
                          image. Increase if pins come up empty.
                        </p>
                      </div>
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={() => setRenameOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              Rename column
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Palette className="mr-2 h-4 w-4" />
                Background color
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="p-2">
                <div className="grid grid-cols-4 gap-1">
                  {COLUMN_COLORS.map((color) => (
                    <button
                      key={color}
                      className={cn(
                        "h-6 w-6 rounded transition-all hover:scale-110 hover:shadow-md",
                        backgroundColor === color && "ring-2 ring-ring scale-110",
                      )}
                      style={{ backgroundColor: color }}
                      onClick={() => onSetColor(color)}
                    />
                  ))}
                </div>
                {backgroundColor && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 h-7 w-full text-xs"
                    onClick={() => onSetColor(undefined)}
                  >
                    Clear color
                  </Button>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {canRemove && onRemove && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onRemove}
                  className="text-destructive focus:text-destructive"
                >
                  <X className="mr-2 h-4 w-4" />
                  Remove column
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Rename dialog — rendered outside dropdown to avoid portal issues */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename column</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleRenameSubmit();
            }}
          >
            <Input
              ref={inputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="Column name"
              className="mb-4"
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRenameOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
