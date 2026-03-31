"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface ChartScalePopoverProps {
  /** Current effective log X-axis state (per-chart override ?? global) */
  logXAxis?: boolean;
  /** Current effective log Y-axis state (per-chart override ?? global) */
  logYAxis?: boolean;
  /** Callback when log scale toggles change. Applied immediately. */
  onLogScaleChange?: (axis: "x" | "y", value: boolean) => void;
  children: React.ReactNode;
}

export function ChartScalePopover({
  logXAxis,
  logYAxis,
  onLogScaleChange,
  children,
}: ChartScalePopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-56"
        align="end"
        sideOffset={8}
        data-testid="chart-settings-popover"
      >
        <div className="space-y-3">
          <p className="text-sm font-medium">Log Scale</p>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="per-chart-log-x"
                className="text-xs text-muted-foreground cursor-pointer"
              >
                X Axis
              </Label>
              <Switch
                id="per-chart-log-x"
                checked={logXAxis ?? false}
                onCheckedChange={(checked) =>
                  onLogScaleChange?.("x", checked)
                }
                data-testid="log-x-axis-switch"
                className="scale-90"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label
                htmlFor="per-chart-log-y"
                className="text-xs text-muted-foreground cursor-pointer"
              >
                Y Axis
              </Label>
              <Switch
                id="per-chart-log-y"
                checked={logYAxis ?? false}
                onCheckedChange={(checked) =>
                  onLogScaleChange?.("y", checked)
                }
                data-testid="log-y-axis-switch"
                className="scale-90"
              />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
