import { cn } from "@/lib/utils";

interface RunningIndicatorProps {
  className?: string;
}

/**
 * A single pulsing "live" indicator shown only for actively-running runs.
 *
 * This intentionally replaces the previous per-row colored status dots
 * (green/red/blue "rainbow") in run lists: a wall of colored dots is cognitive
 * overload, and final-state info (Completed / Failed / Terminated / Cancelled)
 * is already conveyed by the text status badge. The only thing worth a per-row
 * glyph is "this run is alive right now", so that is all this renders.
 */
export function RunningIndicator({ className }: RunningIndicatorProps) {
  return (
    <span
      className={cn("relative inline-flex size-2 shrink-0", className)}
      data-testid="running-indicator"
      aria-label="Running"
      role="img"
    >
      {/* Solid dot */}
      <span className="absolute inset-0 z-10 rounded-full bg-blue-500" />
      {/* Pulsing halo */}
      <span className="absolute inset-0 animate-[ping_1s_cubic-bezier(0,0,0.2,1)_infinite] rounded-full bg-blue-500/50" />
    </span>
  );
}
