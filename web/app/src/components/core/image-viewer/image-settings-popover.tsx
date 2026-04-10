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
  return (
    <Popover>
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
