"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface ChartBoundsPopoverProps {
  yMin?: number;
  yMax?: number;
  onBoundsChange: (yMin?: number, yMax?: number) => void;
  /** Current effective log X-axis state (per-chart override ?? global) */
  logXAxis?: boolean;
  /** Current effective log Y-axis state (per-chart override ?? global) */
  logYAxis?: boolean;
  /** Callback when log scale toggles change. Applied immediately. */
  onLogScaleChange?: (axis: "x" | "y", value: boolean) => void;
  /** Called when Reset is clicked. If provided, replaces default reset behavior. */
  onResetAll?: () => void;
  children: React.ReactNode;
}

export function ChartBoundsPopover({
  yMin,
  yMax,
  onBoundsChange,
  logXAxis,
  logYAxis,
  onLogScaleChange,
  onResetAll,
  children,
}: ChartBoundsPopoverProps) {
  const [localYMin, setLocalYMin] = useState(yMin != null ? String(yMin) : "");
  const [localYMax, setLocalYMax] = useState(yMax != null ? String(yMax) : "");

  useEffect(() => {
    setLocalYMin(yMin != null ? String(yMin) : "");
    setLocalYMax(yMax != null ? String(yMax) : "");
  }, [yMin, yMax]);

  const { validationError, parsedMin, parsedMax } = useMemo(() => {
    const pMin = localYMin !== "" ? Number(localYMin) : undefined;
    const pMax = localYMax !== "" ? Number(localYMax) : undefined;
    let error: string | null = null;
    if (localYMin !== "" && isNaN(pMin!)) {
      error = "Y Min is not a valid number";
    } else if (localYMax !== "" && isNaN(pMax!)) {
      error = "Y Max is not a valid number";
    } else if (pMin != null && pMax != null && pMin >= pMax) {
      error = "Y Min must be less than Y Max";
    }
    return { validationError: error, parsedMin: pMin, parsedMax: pMax };
  }, [localYMin, localYMax]);

  function applyBounds() {
    if (validationError) return;
    onBoundsChange(parsedMin, parsedMax);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      applyBounds();
    }
  }

  function handleReset() {
    if (onResetAll) {
      onResetAll();
      return;
    }
    setLocalYMin("");
    setLocalYMax("");
    onBoundsChange(undefined, undefined);
  }

  const showLogScale = !!onLogScaleChange;

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
          <p className="text-sm font-medium">Y-Axis Bounds</p>
          <div className="space-y-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Y Min</label>
              <Input
                type="number"
                placeholder="Auto"
                value={localYMin}
                onChange={(e) => setLocalYMin(e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Y Max</label>
              <Input
                type="number"
                placeholder="Auto"
                value={localYMax}
                onChange={(e) => setLocalYMax(e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-8 text-sm"
              />
            </div>
          </div>
          {validationError && (
            <p className="text-xs text-destructive">{validationError}</p>
          )}

          {showLogScale && (
            <>
              <div className="border-t pt-3">
                <p className="text-sm font-medium mb-2">Log Scale</p>
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
                        onLogScaleChange("x", checked)
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
                        onLogScaleChange("y", checked)
                      }
                      data-testid="log-y-axis-switch"
                      className="scale-90"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs"
              onClick={applyBounds}
              disabled={!!validationError}
            >
              Apply
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-xs"
              onClick={handleReset}
            >
              Reset
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
