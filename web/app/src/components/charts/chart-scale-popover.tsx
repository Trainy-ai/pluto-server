"use client";

import { useEffect, useRef, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

/** Default + bounds for the "Max groups" cap. Mirrors wandb (default
 *  10, hard ceiling 100) so users see a familiar number when they
 *  open the popover for the first time on a grouped chart. */
export const DEFAULT_MAX_GROUPS = 10;
const MAX_GROUPS_CEILING = 100;

interface ChartScalePopoverProps {
  /** Current effective log X-axis state (per-chart override ?? global) */
  logXAxis?: boolean;
  /** Current effective log Y-axis state (per-chart override ?? global) */
  logYAxis?: boolean;
  /** Callback when log scale toggles change. Applied immediately. */
  onLogScaleChange?: (axis: "x" | "y", value: boolean) => void;
  /** True when the page has active grouping — controls visibility of
   *  the per-chart override toggle below. */
  workspaceGroupingActive?: boolean;
  /** Per-chart override: `true` = OVERRIDE workspace grouping (force
   *  per-run for this chart); `false` / undefined = follow workspace
   *  (the default). */
  groupingOverridden?: boolean;
  /** Fires when the user flips the per-chart override toggle. */
  onGroupingOverrideChange?: (overridden: boolean) => void;
  /** Current max-groups cap — clamps the number of distinct leaf
   *  groups the grouped chart query will aggregate. Only shown when
   *  workspace grouping is active AND this chart isn't overriding. */
  maxGroups?: number;
  /** Fires when the user changes the max-groups cap. */
  onMaxGroupsChange?: (value: number) => void;
  children: React.ReactNode;
}

export function ChartScalePopover({
  logXAxis,
  logYAxis,
  onLogScaleChange,
  workspaceGroupingActive,
  groupingOverridden,
  onGroupingOverrideChange,
  maxGroups,
  onMaxGroupsChange,
  children,
}: ChartScalePopoverProps) {
  const effectiveMaxGroups = maxGroups ?? DEFAULT_MAX_GROUPS;
  // Local draft for the Max Groups input so:
  //   1) keystrokes don't fire the (expensive) chart refetch — only blur /
  //      Enter commits the new value;
  //   2) the user can backspace past "1" to clear the field and retype.
  //      A controlled value bound directly to `effectiveMaxGroups` snaps
  //      empty back to "1" on each keystroke, so "5" after backspacing
  //      "10" used to come out as "15".
  // Re-syncs whenever the persisted value changes from outside (e.g. a
  // dashboard view loads with a different cap).
  const [draft, setDraft] = useState<string>(String(effectiveMaxGroups));
  // `onKeyDown` handlers for Enter/Escape call `.blur()`, which fires
  // `onBlur → commitMaxGroups` SYNCHRONOUSLY — before React has
  // applied the `setDraft` from those same handlers. Without a
  // signal, Escape ends up committing the modified value (the closure
  // still sees the stale draft) and Enter double-commits. The ref
  // lets the key handler tell onBlur "I already handled this, skip
  // the commit." Mirrors the cancelBlurRef pattern in
  // components/table-pagination.tsx.
  const cancelBlurRef = useRef(false);
  useEffect(() => {
    setDraft(String(effectiveMaxGroups));
  }, [effectiveMaxGroups]);

  const commitMaxGroups = () => {
    const parsed = parseInt(draft, 10);
    if (Number.isFinite(parsed)) {
      const clamped = Math.max(1, Math.min(MAX_GROUPS_CEILING, parsed));
      if (clamped !== effectiveMaxGroups) onMaxGroupsChange?.(clamped);
      setDraft(String(clamped));
    } else {
      // Invalid / empty input → revert to the last committed value.
      setDraft(String(effectiveMaxGroups));
    }
  };

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
          {workspaceGroupingActive && (
            <div className="space-y-2 border-t pt-3">
              <p className="text-sm font-medium">Grouping</p>
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="per-chart-grouping-override"
                  className="text-xs text-muted-foreground cursor-pointer"
                >
                  Override Grouping
                </Label>
                <Switch
                  id="per-chart-grouping-override"
                  // ON = override = force per-run for this chart only;
                  // OFF (default) = follow the workspace groupBy.
                  checked={groupingOverridden ?? false}
                  onCheckedChange={(checked) =>
                    onGroupingOverrideChange?.(checked)
                  }
                  data-testid="chart-grouping-override-switch"
                  className="scale-90"
                />
              </div>
              {/* Max-groups cap is only meaningful when grouping IS
                  in effect (no override). Hidden when overridden so
                  the popover doesn't show a setting that has zero
                  effect on what's rendered. */}
              {!groupingOverridden && (
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="per-chart-max-groups"
                    className="text-xs text-muted-foreground cursor-pointer"
                  >
                    Max Groups
                  </Label>
                  <Input
                    id="per-chart-max-groups"
                    type="number"
                    min={1}
                    max={MAX_GROUPS_CEILING}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => {
                      if (cancelBlurRef.current) {
                        cancelBlurRef.current = false;
                        return;
                      }
                      commitMaxGroups();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        cancelBlurRef.current = true;
                        commitMaxGroups();
                        (e.currentTarget as HTMLInputElement).blur();
                      } else if (e.key === "Escape") {
                        cancelBlurRef.current = true;
                        setDraft(String(effectiveMaxGroups));
                        (e.currentTarget as HTMLInputElement).blur();
                      }
                    }}
                    className="h-7 w-16 text-xs"
                    data-testid="chart-max-groups-input"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
