import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SlidersHorizontalIcon } from "lucide-react";

interface ImageSettingsPopoverProps {
  syncZoom: boolean;
  onSyncZoomChange: (value: boolean) => void;
}

export function ImageSettingsPopover({
  syncZoom,
  onSyncZoomChange,
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
        </div>
      </PopoverContent>
    </Popover>
  );
}
