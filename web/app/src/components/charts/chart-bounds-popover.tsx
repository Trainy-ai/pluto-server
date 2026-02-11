"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface ChartBoundsPopoverProps {
  yMin?: number;
  yMax?: number;
  onBoundsChange: (yMin?: number, yMax?: number) => void;
  children: React.ReactNode;
}

export function ChartBoundsPopover({
  yMin,
  yMax,
  onBoundsChange,
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
    setLocalYMin("");
    setLocalYMax("");
    onBoundsChange(undefined, undefined);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-56" align="end" sideOffset={8}>
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
