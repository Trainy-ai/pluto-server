import { useCallback, useEffect, useState } from "react";
import { useImageStepSyncContext } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~context/image-step-sync-context";
import { resolveSampleIndex, selectChosenIndex } from "./sample-index";

/**
 * How the per-sample < N/M > stepper syncs in comparison media widgets:
 *   - "off"     — each run steps independently.
 *   - "runs"    — keep every run in THIS widget on the same sample index.
 *   - "widgets" — keep every run on EVERY media widget (image/video/audio) on
 *                 the same sample index, via the shared sync context.
 * The three modes are mutually exclusive (surfaced as a dropdown).
 */
export type SampleIndexSyncMode = "off" | "runs" | "widgets";

/**
 * Shared state + logic for the per-sample stepper. The index is sticky across
 * step changes in every mode. Each mode has its OWN index:
 *   - "widgets" reads/writes the shared tandem index (ImageStepSyncContext).
 *   - "runs"    reads/writes a widget-local index.
 *   - "off"     reads/writes a per-run index.
 * Leaving "widgets" → "runs" keeps the sample you're viewing (decouple, no
 * jump) via the mirror below; REJOINING "widgets" re-adopts the tandem's index
 * (the runs detour is discarded), so a widget that wandered in runs snaps back
 * to whatever the synced group is showing.
 */
export function useSampleIndexSync() {
  const syncContext = useImageStepSyncContext();
  const [mode, setMode] = useState<SampleIndexSyncMode>("widgets");
  const [localSampleIndex, setLocalSampleIndex] = useState<number | null>(null);
  const [indexByRun, setIndexByRun] = useState<Map<string, number>>(new Map());

  const syncRuns = mode !== "off";
  const acrossWidgets = mode === "widgets";

  // Across widgets (and a provider exists) → context is the shared source;
  // otherwise the widget keeps its own shared-across-runs index.
  const fromContext = acrossWidgets && !!syncContext;
  const sharedIndex =
    acrossWidgets && syncContext ? syncContext.sampleIndex : localSampleIndex;
  const setSharedIndex =
    acrossWidgets && syncContext ? syncContext.setSampleIndex : setLocalSampleIndex;

  // Mirror the tandem (context) value into local state while in "widgets", so
  // switching to "runs" keeps the current sample instead of jumping. Depend on
  // the sampleIndex itself (not the whole context object) so this doesn't
  // re-run on every step scrub.
  const contextSampleIndex = syncContext?.sampleIndex;
  useEffect(() => {
    if (fromContext && contextSampleIndex != null) {
      setLocalSampleIndex(contextSampleIndex);
    }
  }, [fromContext, contextSampleIndex]);

  const handleIndexChange = useCallback(
    (runId: string, next: number) => {
      if (syncRuns) {
        setSharedIndex(next);
      } else {
        setIndexByRun((prev) => new Map(prev).set(runId, next));
      }
    },
    [syncRuns, setSharedIndex],
  );

  // Resolve the clamped sample index a given run's cell should display.
  const resolveIndex = useCallback(
    (runId: string, pinnedIndex: number | null, sampleCount: number) => {
      const chosen = selectChosenIndex(
        syncRuns,
        sharedIndex,
        indexByRun.get(runId) ?? null,
      );
      return resolveSampleIndex(chosen, pinnedIndex, sampleCount);
    },
    [syncRuns, sharedIndex, indexByRun],
  );

  return { mode, setMode, handleIndexChange, resolveIndex };
}
