import { Link, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Slim, inline step/run sliders pinned to the bottom of histogram
// widgets (categorical {bars} + numeric distributions). Optional
// sync-lock props on EACH slider surface a cross-widget link icon
// (Radix tooltip) — independent toggles for step vs run, so a user
// can sync just the step axis without forcing run sync too.
//
// Fixed widths on the leading labels keep the slider track at a
// constant length as the step number / run name grow — otherwise
// the thumb visually jumps left or right when scrubbing.

export interface RunSliderRunRef {
  runName: string;
  color: string;
}

export interface HistogramFooterSlidersProps {
  showStepSlider: boolean;
  showRunSlider: boolean;
  stepIdx: number;
  runIdx: number;
  steps: number[];
  runs: RunSliderRunRef[];
  onStepIdxChange: (idx: number) => void;
  onRunIdxChange: (idx: number) => void;
  // Step-sync lock: link icon appears at the right of the step slider
  // row when showStepLock is true. Visually identical to the legacy
  // StepNavigator lock so it reads as the same affordance.
  showStepLock?: boolean;
  isStepLocked?: boolean;
  onStepLockChange?: (locked: boolean) => void;
  // Run-sync lock: same affordance for the run slider row. Parallel
  // to the step lock — independent toggle.
  showRunLock?: boolean;
  isRunLocked?: boolean;
  onRunLockChange?: (locked: boolean) => void;
}

export function HistogramFooterSliders(props: HistogramFooterSlidersProps) {
  return (
    <div className="flex flex-col gap-1">
      {props.showStepSlider && (
        <StepSliderRow
          stepIdx={props.stepIdx}
          steps={props.steps}
          onChange={props.onStepIdxChange}
          showLock={props.showStepLock}
          isLocked={props.isStepLocked}
          onLockChange={props.onStepLockChange}
        />
      )}
      {props.showRunSlider && (
        <RunSliderRow
          runIdx={props.runIdx}
          runs={props.runs}
          onChange={props.onRunIdxChange}
          showLock={props.showRunLock}
          isLocked={props.isRunLocked}
          onLockChange={props.onRunLockChange}
        />
      )}
    </div>
  );
}

// Fixed-width step / run labels keep the slider track from shifting
// when the leading content grows. Reserves 6ch for the step number
// (covers 999,999 — past that, ellipsis + tooltip) and 12ch for the
// run name. The trailing "/ N" and "N/M" suffixes were dropped; the
// slider thumb's position already visualizes progress, and the
// current-step tooltip surfaces the max on hover.
const STEP_NUMBER_MAX_DIGITS = 6;
const RUN_NAME_MAX_CHARS = 12;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

function LockIcon({
  isLocked,
  onLockChange,
  syncedTooltip,
  unsyncedTooltip,
}: {
  isLocked: boolean;
  onLockChange: (locked: boolean) => void;
  syncedTooltip: string;
  unsyncedTooltip: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onLockChange(!isLocked)}
          className="h-6 w-6 shrink-0"
        >
          {isLocked ? (
            <Link className="h-3 w-3 text-muted-foreground" />
          ) : (
            <Unlink className="h-3 w-3 text-muted-foreground" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {isLocked ? syncedTooltip : unsyncedTooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function StepSliderRow({
  stepIdx,
  steps,
  onChange,
  showLock,
  isLocked,
  onLockChange,
}: {
  stepIdx: number;
  steps: number[];
  onChange: (idx: number) => void;
  showLock?: boolean;
  isLocked?: boolean;
  onLockChange?: (locked: boolean) => void;
}) {
  const current = steps[stepIdx] ?? 0;
  const last = steps[steps.length - 1] ?? 0;
  const maxIdx = Math.max(0, steps.length - 1);
  return (
    <div
      data-testid="step-navigator"
      className="flex items-center gap-3"
    >
      <span className="shrink-0 text-[11px] font-medium text-muted-foreground tabular-nums">
        step{" "}
        <Tooltip delayDuration={120}>
          <TooltipTrigger asChild>
            <span
              className="inline-block text-right text-foreground"
              style={{ width: `${STEP_NUMBER_MAX_DIGITS}ch` }}
            >
              {truncate(String(current), STEP_NUMBER_MAX_DIGITS)}
            </span>
          </TooltipTrigger>
          <TooltipContent>{`${current} / ${last}`}</TooltipContent>
        </Tooltip>
      </span>
      <input
        type="range"
        role="slider"
        min={0}
        max={maxIdx}
        value={Math.min(stepIdx, maxIdx)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 min-w-[40px] flex-1 cursor-pointer accent-primary focus:outline-none focus-visible:outline-none focus-visible:ring-0"
        aria-label="step"
        aria-valuemin={0}
        aria-valuemax={maxIdx}
        aria-valuenow={Math.min(stepIdx, maxIdx)}
      />
      {showLock && onLockChange ? (
        <LockIcon
          isLocked={!!isLocked}
          onLockChange={onLockChange}
          syncedTooltip="Steps synced with other panels. Click to unlink."
          unsyncedTooltip="Steps independent. Click to sync with other panels."
        />
      ) : null}
    </div>
  );
}

function RunSliderRow({
  runIdx,
  runs,
  onChange,
  showLock,
  isLocked,
  onLockChange,
}: {
  runIdx: number;
  runs: RunSliderRunRef[];
  onChange: (idx: number) => void;
  showLock?: boolean;
  isLocked?: boolean;
  onLockChange?: (locked: boolean) => void;
}) {
  const current = runs[Math.min(runIdx, runs.length - 1)];
  const maxIdx = Math.max(0, runs.length - 1);
  if (!current) return null;
  return (
    <div className="flex items-center gap-3">
      <Tooltip delayDuration={120}>
        <TooltipTrigger asChild>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-foreground">
            <span
              className="inline-block size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: current.color }}
              aria-hidden
            />
            <span
              className="inline-block truncate"
              style={{ width: `${RUN_NAME_MAX_CHARS}ch` }}
            >
              {truncate(current.runName, RUN_NAME_MAX_CHARS)}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{current.runName}</TooltipContent>
      </Tooltip>
      <input
        type="range"
        role="slider"
        min={0}
        max={maxIdx}
        value={Math.min(runIdx, maxIdx)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 min-w-[40px] flex-1 cursor-pointer accent-primary focus:outline-none focus-visible:outline-none focus-visible:ring-0"
        aria-label="run"
        aria-valuemin={0}
        aria-valuemax={maxIdx}
        aria-valuenow={Math.min(runIdx, maxIdx)}
      />
      {showLock && onLockChange ? (
        <LockIcon
          isLocked={!!isLocked}
          onLockChange={onLockChange}
          syncedTooltip="Runs synced with other panels. Click to unlink."
          unsyncedTooltip="Runs independent. Click to sync with other panels."
        />
      ) : null}
    </div>
  );
}
