import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient } from "@/utils/trpc";
import { findContinuedSelectedRunIds } from "@/lib/experiment-data-utils";
import type { Run } from "../~queries/list-runs";

interface UseExperimentSelectionParams {
  /** Experiments mode (`?listMode=experiments`). Off → the hook is inert. */
  enabled: boolean;
  organizationId: string;
  projectName: string;
  selectedRunsWithColors: Record<string, { run: Run; color: string }>;
  selectAllByIds: (runIds: string[], runFallbacks?: Run[]) => void;
  deselectByIds: (runIds: string[]) => void;
  handleColorChange: (runId: string, color: string) => void;
}

/**
 * Keeps an Experiments-mode selection to one lineage tip per experiment.
 * The tip's charts and media stitch its ancestors in, so a selected ancestor
 * either duplicates its experiment (tip also selected: an extra series in a
 * second colour, and one experiment counted as several) or stands in for it
 * (tip not selected: a truncated curve, and a row the tips-only table never
 * lists). Selections reach this state from "Select first N", a pasted ?runs=
 * link, or a selection carried over from Runs mode.
 */
export function useExperimentSelection({
  enabled,
  organizationId,
  projectName,
  selectedRunsWithColors,
  selectAllByIds,
  deselectByIds,
  handleColorChange,
}: UseExperimentSelectionParams) {
  // Tip also selected → drop the ancestor.
  useEffect(() => {
    if (!enabled) return;
    const continued = findContinuedSelectedRunIds(selectedRunsWithColors);
    if (continued.length > 0) deselectByIds(continued);
  }, [enabled, selectedRunsWithColors, deselectByIds]);

  // Tip not selected → swap the ancestor for its tip, keeping its colour.
  // The server resolves tips (descendants needn't be loaded) and skips
  // branching lineages, where there is no single tip to pick.
  const selectedIds = useMemo(
    () => Object.keys(selectedRunsWithColors).sort(),
    [selectedRunsWithColors],
  );
  const { data: lineageTips } = useQuery(
    trpc.runs.lineageTips.queryOptions(
      { organizationId, projectName, runIds: selectedIds },
      { enabled: enabled && selectedIds.length > 0, staleTime: 30_000 },
    ),
  );
  const isSwappingRef = useRef(false);
  useEffect(() => {
    if (!enabled || !lineageTips || isSwappingRef.current) return;
    const swaps = Object.entries(lineageTips.tipIdByRunId).filter(
      ([runId, tipId]) => selectedRunsWithColors[runId] && !selectedRunsWithColors[tipId],
    );
    if (swaps.length === 0) return;

    isSwappingRef.current = true;
    // Cancelled when the selection, mode or project changes (or on unmount)
    // before the fetch lands, so a stale result can't select a tip or drop
    // a run the user has since changed.
    let isCancelled = false;
    const tipIds = [...new Set(swaps.map(([, tipId]) => tipId))];
    trpcClient.runs.getByIds
      .query({ organizationId, projectName, runIds: tipIds })
      .then(({ runs }) => {
        if (isCancelled) return;
        const fetched = new Set(runs.map((run) => run.id));
        const resolved = swaps.filter(([, tipId]) => fetched.has(tipId));
        if (resolved.length === 0) return;
        selectAllByIds(
          [...new Set(resolved.map(([, tipId]) => tipId))],
          runs as unknown as Run[],
        );
        for (const [runId, tipId] of resolved) {
          handleColorChange(tipId, selectedRunsWithColors[runId].color);
        }
        deselectByIds(resolved.map(([runId]) => runId));
      })
      .catch((error) => {
        if (!isCancelled) {
          console.error("Failed to resolve experiment tips for selection:", error);
        }
      })
      .finally(() => {
        if (!isCancelled) isSwappingRef.current = false;
      });
    return () => {
      isCancelled = true;
      isSwappingRef.current = false;
    };
  }, [
    enabled,
    lineageTips,
    selectedRunsWithColors,
    organizationId,
    projectName,
    selectAllByIds,
    deselectByIds,
    handleColorChange,
  ]);
}
