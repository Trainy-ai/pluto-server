import { PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ClearAllPinsButtonProps {
  /** Number of pinned runs — button hides itself when 0. */
  pinnedRunCount: number;
  /** Clear every pin in this widget's section. */
  onClearAllPins: () => void;
}

/**
 * Hover-toolbar button that clears all media pins. Rendered in the
 * `toolbarExtra` slot of video / audio comparison widgets, which (unlike the
 * image widget) have no other settings to tuck it behind. Only shows when
 * there is at least one pin to clear.
 */
export function ClearAllPinsButton({
  pinnedRunCount,
  onClearAllPins,
}: ClearAllPinsButtonProps) {
  if (pinnedRunCount <= 0) return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 bg-background/80 px-2 text-xs backdrop-blur-sm hover:bg-background"
      data-testid="clear-all-pins-btn"
      onClick={onClearAllPins}
    >
      <PinOff className="h-3.5 w-3.5" />
      Clear all pins ({pinnedRunCount})
    </Button>
  );
}
