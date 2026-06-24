import React, { useCallback, useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";

import type { AxisBounds } from "./histogram-axis-controls";

// Compact top-right styled axis controls for the numeric histogram
// widget. Matches BinRangeControl's visual language (small label +
// fixed-width number input, no big white form fields) so the
// numeric and categorical {bars} widgets read identically.

function InlineNumberInput({
  label,
  value,
  onChange,
  ariaLabel,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(value !== undefined ? String(value) : "");
  useEffect(() => {
    setDraft(value !== undefined ? String(value) : "");
  }, [value]);
  const commit = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      onChange(undefined);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      setDraft(value !== undefined ? String(value) : "");
      return;
    }
    onChange(n);
  }, [draft, onChange, value]);
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <span className="font-medium">{label}</span>
      <input
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder="Auto"
        className="h-7 w-14 rounded border border-border bg-background px-1.5 text-center tabular-nums text-foreground"
        aria-label={ariaLabel}
      />
    </span>
  );
}

export function HistogramAxisControlsInline({
  axisBounds,
  onAxisBoundsChange,
  // Y max only makes sense in Step mode (Y is the freq scale).
  // Ridgeline/Heatmap put step rows on Y, so Y-max would be
  // meaningless — caller hides it via showYMax=false.
  showYMax = true,
  ignoreOutliers,
  onIgnoreOutliersChange,
  // "Steps on X" transpose. Only valid for Ridgeline + Heatmap modes
  // where Y is normally the step axis; callers pass `stepsOnXDisabled`
  // to gray out the checkbox in Step mode (no Y=step to swap) or
  // when depthAxis=run (the Y axis is runs, not steps). When the
  // callback is omitted entirely the control is hidden.
  stepsOnX,
  onStepsOnXChange,
  stepsOnXDisabled = false,
}: {
  axisBounds: AxisBounds;
  onAxisBoundsChange: (bounds: AxisBounds) => void;
  showYMax?: boolean;
  /**
   * W&B-style outlier-fence toggle. When set, the checkbox shows up
   * alongside the X/Y inputs. Omitted from callers that don't have
   * a persistence path yet (the toggle's value would be ignored).
   */
  ignoreOutliers?: boolean;
  onIgnoreOutliersChange?: (next: boolean) => void;
  stepsOnX?: boolean;
  onStepsOnXChange?: (next: boolean) => void;
  stepsOnXDisabled?: boolean;
}) {
  const hasOverrides =
    axisBounds.xMin !== undefined ||
    axisBounds.xMax !== undefined ||
    (showYMax && axisBounds.yMax !== undefined);
  return (
    <div
      className="flex items-center gap-2"
      data-testid="histogram-axis-controls-inline"
    >
      <InlineNumberInput
        label="X min:"
        value={axisBounds.xMin}
        onChange={(v) => onAxisBoundsChange({ ...axisBounds, xMin: v })}
        ariaLabel="X axis min"
      />
      <InlineNumberInput
        label="X max:"
        value={axisBounds.xMax}
        onChange={(v) => onAxisBoundsChange({ ...axisBounds, xMax: v })}
        ariaLabel="X axis max"
      />
      {showYMax && (
        <InlineNumberInput
          label="Y max:"
          value={axisBounds.yMax}
          onChange={(v) => onAxisBoundsChange({ ...axisBounds, yMax: v })}
          ariaLabel="Y axis max"
        />
      )}
      {onIgnoreOutliersChange !== undefined && (
        <label
          className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground"
          title="Clamp X axis + freq scale to 5th/95th percentile fences so a single outlier step doesn't squish the rest."
        >
          <input
            type="checkbox"
            checked={ignoreOutliers ?? true}
            onChange={(e) => onIgnoreOutliersChange(e.target.checked)}
            className="h-3.5 w-3.5"
            aria-label="Ignore outliers"
            data-testid="histogram-ignore-outliers"
          />
          <span className="font-medium">Ignore outliers</span>
        </label>
      )}
      {onStepsOnXChange !== undefined && (
        <label
          className={
            stepsOnXDisabled
              ? "inline-flex cursor-not-allowed items-center gap-1 text-[11px] text-muted-foreground/50"
              : "inline-flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground"
          }
          title={
            stepsOnXDisabled
              ? "Available only on Ridgeline/Heatmap when Y axis is step."
              : "Transpose the chart so steps run along the X axis and bins stack vertically — useful when stacking multiple histograms so their step axes align."
          }
        >
          <input
            type="checkbox"
            checked={!stepsOnXDisabled && (stepsOnX ?? false)}
            disabled={stepsOnXDisabled}
            onChange={(e) => onStepsOnXChange(e.target.checked)}
            className="h-3.5 w-3.5"
            aria-label="Steps on X"
            data-testid="histogram-steps-on-x"
          />
          <span className="font-medium">Steps on X</span>
        </label>
      )}
      {hasOverrides && (
        <button
          type="button"
          onClick={() =>
            onAxisBoundsChange(
              showYMax ? {} : { yMax: axisBounds.yMax },
            )
          }
          className="inline-flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Reset axis bounds"
          aria-label="Reset axis bounds"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
