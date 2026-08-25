// Dashboard "panel" widget — user-authored Python (Streamlit) panel in
// the sandboxed stlite iframe. This component owns everything host-side:
// building the PanelContext from the dashboard's selected runs + route
// org/project + theme + measured size, gating run-selection changes
// behind a "Runs changed — Refresh" pill (unless autoRunOnRunChange),
// and blocking iframe pointer capture while the grid is in edit mode.

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/hooks/use-theme";
import {
  PanelSandbox,
  type PanelSandboxHandle,
} from "@/components/panels/panel-sandbox";
import type { PanelContext } from "@/lib/panels/panel-bridge-protocol";
import type { PanelWidgetConfig } from "../../~types/dashboard-types";
import type { SelectedRunWithColor } from "../../~hooks/use-selected-runs";

/** Debounce for ResizeObserver → context-update (avoid resize-drag spam). */
const RESIZE_DEBOUNCE_MS = 300;

interface PanelWidgetProps {
  config: PanelWidgetConfig;
  selectedRuns: Record<string, SelectedRunWithColor>;
  organizationId: string;
  projectName: string;
  /** True while the dashboard grid is in edit mode — the iframe must not
   *  swallow the drag/resize pointer events. */
  isGridEditing?: boolean;
}

export function PanelWidget({
  config,
  selectedRuns,
  organizationId,
  projectName,
  isGridEditing,
}: PanelWidgetProps) {
  const { orgSlug } = useParams({ strict: false });
  const { resolvedTheme } = useTheme();
  const sandboxRef = useRef<PanelSandboxHandle>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) {
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        setDims({
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(node);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  const liveRuns = useMemo(
    () =>
      Object.entries(selectedRuns).map(([runId, { run, color }]) => ({
        id: runId,
        name: run.name,
        color,
      })),
    [selectedRuns],
  );

  // Run-selection gating. When autoRunOnRunChange is off, the panel
  // keeps rendering against the run set it last ran with (colors/names
  // stay live) and a pill offers the refresh. IDs — not whole objects —
  // are the applied state so color edits don't count as "changed".
  const [appliedRunIds, setAppliedRunIds] = useState<string[]>(() =>
    liveRuns.map((run) => run.id),
  );
  const autoRun = config.autoRunOnRunChange;
  const liveRunIds = useMemo(() => liveRuns.map((run) => run.id), [liveRuns]);

  // Armed by the Refresh pill (and hydration): with autoRunOnRunChange
  // off, a rerun is allowed only when this ref is set — selection drift
  // alone must not execute panel code.
  const manualRefreshPendingRef = useRef(false);

  // Run selection hydrates asynchronously (IndexedDB) and can land after
  // this widget mounts with an empty set. Going empty → non-empty is
  // initial hydration, not a user-visible "runs changed" event — apply
  // it directly (arming a rerun in case the sandbox already booted
  // against zero runs) so the panel doesn't stay pinned to zero runs.
  useEffect(() => {
    if (appliedRunIds.length === 0 && liveRunIds.length > 0) {
      if (!autoRun) {
        manualRefreshPendingRef.current = true;
      }
      setAppliedRunIds(liveRunIds);
    }
  }, [appliedRunIds, liveRunIds, autoRun]);

  const runsChanged =
    !autoRun &&
    appliedRunIds.length > 0 &&
    JSON.stringify(liveRunIds) !== JSON.stringify(appliedRunIds);
  const displayedRuns = useMemo(() => {
    if (autoRun) {
      return liveRuns;
    }
    const applied = new Set(appliedRunIds);
    return liveRuns.filter((run) => applied.has(run.id));
  }, [autoRun, liveRuns, appliedRunIds]);

  // Re-execute the script only when the run state actually changes AND
  // execution is allowed: always in auto mode; with autoRunOnRunChange
  // off only after Refresh/hydration armed manualRefreshPendingRef —
  // selection drift alone just updates the context and shows the pill.
  // PanelSandbox posts the context-update first (child effects run
  // before parent effects), so the rerun sees fresh context. The
  // signature guard absorbs mount and autoRunOnRunChange toggles, and
  // includes appliedRunIds so a Refresh that only removes runs (same
  // intersection, e.g. after a deselect) still reruns.
  const runsSignature = useMemo(
    () =>
      JSON.stringify(displayedRuns.map((run) => run.id)) +
      "|" +
      JSON.stringify(appliedRunIds),
    [displayedRuns, appliedRunIds],
  );
  const lastRerunSignatureRef = useRef(runsSignature);
  useEffect(() => {
    if (autoRun) {
      manualRefreshPendingRef.current = false;
    }
    if (runsSignature === lastRerunSignatureRef.current) {
      return;
    }
    if (!autoRun && !manualRefreshPendingRef.current) {
      return;
    }
    manualRefreshPendingRef.current = false;
    lastRerunSignatureRef.current = runsSignature;
    sandboxRef.current?.rerun();
  }, [runsSignature, autoRun]);

  const context = useMemo<PanelContext>(
    () => ({
      projectName,
      orgSlug: orgSlug ?? "",
      organizationId,
      theme: resolvedTheme,
      runs: displayedRuns,
      panel: dims,
    }),
    [projectName, orgSlug, organizationId, resolvedTheme, displayedRuns, dims],
  );

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <PanelSandbox
        ref={sandboxRef}
        code={config.code}
        requirements={config.requirements}
        context={context}
      />
      {isGridEditing && (
        // Iframes swallow pointer events, breaking react-grid-layout's
        // drag/resize. While editing, an invisible overlay keeps the
        // pointer on the parent document (panel is view-only meanwhile).
        <div
          data-testid="panel-edit-overlay"
          className="absolute inset-0 z-10"
        />
      )}
      {runsChanged && (
        <div className="absolute right-2 top-2 z-20 flex items-center gap-2 rounded-full border bg-card/95 py-1 pl-3 pr-1 text-xs shadow-sm">
          <span className="text-muted-foreground">Runs changed</span>
          <Button
            variant="secondary"
            size="sm"
            className="h-6 rounded-full px-2 text-xs"
            data-testid="panel-refresh-runs"
            onClick={() => {
              manualRefreshPendingRef.current = true;
              setAppliedRunIds(liveRunIds);
            }}
          >
            <RefreshCwIcon className="mr-1 size-3" />
            Refresh
          </Button>
        </div>
      )}
    </div>
  );
}
