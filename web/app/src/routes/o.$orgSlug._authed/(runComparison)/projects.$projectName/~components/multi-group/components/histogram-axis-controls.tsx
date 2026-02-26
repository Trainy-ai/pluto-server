import React, { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";

export interface AxisBounds {
  xMin?: number;
  xMax?: number;
  yMax?: number;
}

interface HistogramAxisControlsProps {
  axisBounds: AxisBounds;
  onAxisBoundsChange: (bounds: AxisBounds) => void;
}

function AxisInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  const [localValue, setLocalValue] = useState(
    value !== undefined ? String(value) : "",
  );

  const commit = useCallback(() => {
    const trimmed = localValue.trim();
    if (trimmed === "") {
      onChange(undefined);
    } else {
      const num = Number(trimmed);
      if (!isNaN(num)) {
        onChange(num);
      }
    }
  }, [localValue, onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        commit();
      }
    },
    [commit],
  );

  // Sync local value when parent resets
  React.useEffect(() => {
    setLocalValue(value !== undefined ? String(value) : "");
  }, [value]);

  return (
    <div className="flex items-center gap-1.5">
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {label}:
      </span>
      <Input
        type="number"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        placeholder="Auto"
        className="h-7 w-20 text-xs"
      />
    </div>
  );
}

export function HistogramAxisControls({
  axisBounds,
  onAxisBoundsChange,
}: HistogramAxisControlsProps) {
  const hasOverrides =
    axisBounds.xMin !== undefined ||
    axisBounds.xMax !== undefined ||
    axisBounds.yMax !== undefined;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <AxisInput
        label="X Min"
        value={axisBounds.xMin}
        onChange={(v) => onAxisBoundsChange({ ...axisBounds, xMin: v })}
      />
      <AxisInput
        label="X Max"
        value={axisBounds.xMax}
        onChange={(v) => onAxisBoundsChange({ ...axisBounds, xMax: v })}
      />
      <AxisInput
        label="Y Max"
        value={axisBounds.yMax}
        onChange={(v) => onAxisBoundsChange({ ...axisBounds, yMax: v })}
      />
      {hasOverrides && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => onAxisBoundsChange({})}
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </Button>
      )}
    </div>
  );
}
