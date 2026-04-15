import { useEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SlidersHorizontalIcon, PinOff } from "lucide-react";

interface ImageSettingsPopoverProps {
  syncZoom: boolean;
  onSyncZoomChange: (value: boolean) => void;
  pinnedRunCount?: number;
  onClearAllPins?: () => void;
}

export function ImageSettingsPopover({
  syncZoom,
  onSyncZoomChange,
  pinnedRunCount = 0,
  onClearAllPins,
}: ImageSettingsPopoverProps) {
  const [open, setOpen] = useState(false);

  // Close the popover on any scroll so it doesn't drift away from its anchor.
  // Ignore scrolls that fire during the first 250ms after opening: Radix's
  // FocusScope moves focus into the popover on mount, which triggers a
  // browser scrollIntoView if the focused element isn't already in the
  // viewport. On tighter layouts (individual-run dashboards especially)
  // that focus scroll would immediately close the popover and show up in
  // tests as a "flicker open/close". The 250ms grace window gives Radix
  // time to finish its focus handling before we start listening.
  useEffect(() => {
    if (!open) return;
    const openedAt = Date.now();
    const handler = () => {
      if (Date.now() - openedAt < 250) return;
      setOpen(false);
    };
    // Listen in capture phase so we catch scrolls on nested scroll containers
    window.addEventListener("scroll", handler, true);
    return () => window.removeEventListener("scroll", handler, true);
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 bg-background/80 backdrop-blur-sm hover:bg-background"
          data-testid="image-settings-btn"
        >
          <SlidersHorizontalIcon className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56" sideOffset={8}>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label
              htmlFor="sync-zoom"
              className="text-sm font-medium cursor-pointer"
            >
              Sync Zoom
            </Label>
            <Switch
              id="sync-zoom"
              checked={syncZoom}
              onCheckedChange={onSyncZoomChange}
              className="scale-90"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Zoom level persists across image fullscreen views within this group.
          </p>
          {pinnedRunCount > 0 && onClearAllPins && (
            <>
              <div className="border-t pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 text-xs"
                  onClick={onClearAllPins}
                >
                  <PinOff className="h-3.5 w-3.5" />
                  Clear all pins ({pinnedRunCount})
                </Button>
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
