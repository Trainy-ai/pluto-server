import { useState, useEffect, useCallback, useMemo, useRef, useTransition } from "react";
import { useChartColors } from "@/components/ui/color-picker";
import type { Run } from "../~queries/list-runs";
import { LocalCache } from "@/lib/db/local-cache";
import { useDebouncedCallback } from "@/lib/hooks/use-debounced-callback";

// alias types for documentation purposes
type Color = string;
type RunId = string;

// Exported type for selected runs with colors
export interface SelectedRunWithColor {
  run: Run;
  color: Color;
}

// Create a single LocalCache for all run-related data
const runCacheDb = new LocalCache<{
  colors: Record<RunId, Color>;
  selectedRuns: Record<RunId, { run: Run; color: Color }>;
}>(
  "run-selection-db",
  "run-selections",
  10 * 1024 * 1024, // 10MB limit
);

/**
 * Generate a project-scoped cache key for run selections
 * This ensures each org/project has its own isolated cache
 */
function getStorageKey(organizationId: string, projectName: string): string {
  return `run-selection-data:${organizationId}:${projectName}`;
}

interface UseSelectedRunsOptions {
  /** Run IDs from URL params to pre-select (overrides cache) */
  urlRunIds?: string[];
  /** Callback when selection changes (for URL sync) */
  onSelectionChange?: (selectedRunIds: string[]) => void;
}

interface UseSelectedRunsReturn {
  /** Map of selected run IDs to their assigned colors */
  runColors: Record<RunId, Color>;
  /** Map of selected run IDs to their run data and color */
  selectedRunsWithColors: Record<RunId, { run: Run; color: Color }>;
  /** Handler for selecting/deselecting runs */
  handleRunSelection: (runId: RunId, isSelected: boolean) => void;
  /** Handler for changing a run's color */
  handleColorChange: (runId: RunId, color: Color) => void;
  /** Select the first N runs from the runs array */
  selectFirstN: (n: number) => void;
  /** Select all runs with the given IDs */
  selectAllByIds: (runIds: RunId[]) => void;
  /** Deselect all runs */
  deselectAll: () => void;
  /** Shuffle colors for all selected runs */
  shuffleColors: () => void;
  /** Reassign all selected runs with sequential colors from the current palette */
  reassignAllColors: () => void;
}

/**
 * Get a deterministic color based on the run id (hash-based).
 * Used for single-run views where sequential assignment isn't needed.
 * For multi-run comparison, use sequential palette assignment instead.
 */
export const getColorForRun = (runId: string, colors: string[]): Color => {
  const hash = runId.split("").reduce((acc, char, index) => {
    return char.charCodeAt(0) * (index + 1) + ((acc << 5) - acc);
  }, 0);
  return colors[Math.abs(hash) % colors.length];
};

/**
 * Get the next available color from the palette that isn't already in use.
 * This ensures selected runs always get maximally distinct colors.
 * Falls back to cycling through the palette if all colors are taken.
 */
function getNextAvailableColor(usedColors: Set<string>, palette: string[]): string {
  for (const color of palette) {
    if (!usedColors.has(color)) return color;
  }
  return palette[usedColors.size % palette.length];
}

/**
 * Assign sequential palette colors to a list of runs.
 * Each run gets the next available distinct color from the palette.
 */
function assignSequentialColors(
  runs: { id: string }[],
  palette: string[],
): Record<string, string> {
  const colors: Record<string, string> = {};
  const used = new Set<string>();
  for (const run of runs) {
    const color = getNextAvailableColor(used, palette);
    colors[run.id] = color;
    used.add(color);
  }
  return colors;
}

/**
 * Custom hook for managing run selection and color assignment
 *
 * Features:
 * - Assigns sequential palette colors to selected runs for maximum visual distinction
 * - Colors are only assigned to selected runs (not all runs)
 * - Automatically selects the 5 most recent runs initially (unless URL params provided)
 * - Provides handlers for selection and color changes
 * - Persists selections and colors in local cache (scoped per org/project)
 * - Supports URL params for shareable pre-selected runs
 *
 * @param runs - Array of run objects from the API
 * @param organizationId - The organization ID for cache scoping
 * @param projectName - The project name for cache scoping
 * @param options - Optional configuration including URL run IDs and selection change callback
 * @returns Object containing state and handlers for run selection and colors
 */
export function useSelectedRuns(
  runs: Run[] | undefined,
  organizationId: string,
  projectName: string,
  options?: UseSelectedRunsOptions,
): UseSelectedRunsReturn {
  const { urlRunIds, onSelectionChange } = options ?? {};

  // Get theme-aware color palette
  const chartColors = useChartColors();

  // Store colors for selected runs only (sequential palette assignment)
  const [runColors, setRunColors] = useState<Record<RunId, Color>>({});
  const [selectedRunsWithColors, setSelectedRunsWithColors] = useState<
    Record<RunId, { run: Run; color: Color }>
  >({});

  // Use transition for selection updates to keep UI responsive
  // This allows React to interrupt expensive downstream renders
  const [, startTransition] = useTransition();

  // Ref for stable access to colors in callbacks
  const chartColorsRef = useRef(chartColors);
  // Track whether the palette has been set at least once (to skip initial render)
  const paletteInitializedRef = useRef(false);
  useEffect(() => {
    const changed = chartColorsRef.current !== chartColors;
    chartColorsRef.current = chartColors;
    // When palette changes (theme or palette type switch), reassign all selected runs
    if (changed && paletteInitializedRef.current) {
      setSelectedRunsWithColors((current) => {
        const ids = Object.keys(current);
        if (ids.length === 0) return current;
        const colorMap = assignSequentialColors(
          ids.map((id) => ({ id })),
          chartColors,
        );
        const updated: Record<RunId, { run: Run; color: Color }> = {};
        for (const id of ids) {
          updated[id] = { ...current[id], color: colorMap[id] };
        }
        setRunColors(colorMap);
        return updated;
      });
    }
    paletteInitializedRef.current = true;
  }, [chartColors]);

  // Track whether initial URL params have been applied
  const urlParamsAppliedRef = useRef(false);
  // Track whether the initial selection has been set (prevents re-init on effect re-runs)
  const initializedRef = useRef(false);
  // Track the previous URL run IDs to detect changes
  const prevUrlRunIdsRef = useRef<string[] | undefined>(undefined);
  // Track whether a URL change was triggered by our own selection update
  // (to avoid round-trip overwriting the selection with a filtered subset)
  const isLocalSelectionUpdateRef = useRef(false);

  // Ref for stable callback access to runs without dependency
  const runsRef = useRef(runs);
  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);

  // Ref for stable callback access to runColors without dependency
  const runColorsRef = useRef(runColors);
  useEffect(() => {
    runColorsRef.current = runColors;
  }, [runColors]);

  // Ref for stable access to selectedRunsWithColors in effects
  const selectedRunsRef = useRef(selectedRunsWithColors);
  useEffect(() => {
    selectedRunsRef.current = selectedRunsWithColors;
  }, [selectedRunsWithColors]);

  // Generate the storage key for this org/project combination
  const storageKey = useMemo(
    () => getStorageKey(organizationId, projectName),
    [organizationId, projectName],
  );

  // Load cached data on initial render or when org/project changes
  useEffect(() => {
    // Reset state and refs to clear stale data from previous project
    setRunColors({});
    setSelectedRunsWithColors({});
    urlParamsAppliedRef.current = false;
    initializedRef.current = false;
    prevUrlRunIdsRef.current = undefined;

    const loadCachedData = async () => {
      try {
        const cachedData = await runCacheDb.getData(storageKey);
        if (cachedData?.data) {
          // Only set state if there's meaningful data to restore
          if (Object.keys(cachedData.data.colors).length > 0) {
            setRunColors(cachedData.data.colors);
          }
          if (Object.keys(cachedData.data.selectedRuns).length > 0) {
            setSelectedRunsWithColors(cachedData.data.selectedRuns);
          }
        }
      } catch (error) {
        console.error("Error loading run selections from cache:", error);
      }
    };

    loadCachedData();
  }, [storageKey]);

  // Debounced save to cache - prevents main thread blocking on rapid changes
  const debouncedSaveToCache = useDebouncedCallback(
    async (colors: Record<RunId, Color>, selected: Record<RunId, { run: Run; color: Color }>, key: string) => {
      try {
        await runCacheDb.setData(key, {
          colors,
          selectedRuns: selected,
        });
      } catch (error) {
        console.error("Error saving run selections to cache:", error);
      }
    },
    500, // 500ms debounce
  );

  // Save to cache whenever state changes (debounced).
  // Must also save empty state to clear stale entries from IndexedDB —
  // otherwise deselecting all runs leaves phantom IDs in the cache that
  // cause prefetchSelectedRuns to inject ghost rows on subsequent loads.
  // Guard on initializedRef to avoid overwriting the cache before it's restored.
  useEffect(() => {
    if (!initializedRef.current) return;
    debouncedSaveToCache(runColors, selectedRunsWithColors, storageKey);
  }, [runColors, selectedRunsWithColors, debouncedSaveToCache, storageKey]);

  // Build a selection map from URL run IDs, matching against available runs.
  // Returns null if urlRunIds is empty or no matching runs are found.
  // Colors are assigned sequentially from the palette for maximum visual distinction.
  const buildSelectionFromUrlParams = useCallback(
    (availableRuns: Run[]): Record<RunId, { run: Run; color: Color }> | null => {
      if (!urlRunIds?.length) return null;

      const runsById = new Map(availableRuns.map((r) => [r.id, r]));
      const matchedRuns = urlRunIds
        .map((id) => runsById.get(id))
        .filter((r): r is Run => r != null);

      if (matchedRuns.length === 0) return null;

      const colorAssignment = assignSequentialColors(matchedRuns, chartColorsRef.current);
      const selected: Record<RunId, { run: Run; color: Color }> = {};
      for (const run of matchedRuns) {
        selected[run.id] = { run, color: colorAssignment[run.id] };
      }
      return selected;
    },
    [urlRunIds],
  );

  // Handle URL param changes (when navigating with different ?runs= param)
  useEffect(() => {
    // Check if URL params actually changed
    const prevIds = prevUrlRunIdsRef.current;
    const prevIdsStr = prevIds?.join(",") ?? "";
    const newIdsStr = urlRunIds?.join(",") ?? "";

    if (prevIdsStr === newIdsStr) {
      return; // No change
    }

    // Don't mark URL params as "seen" until runs are loaded so we can actually
    // apply them. Otherwise the first render (before data arrives) consumes
    // the change and when runs finally load, the effect sees no diff.
    if (!runs?.length) {
      return;
    }

    // Update ref to track current value — only after we know runs are loaded
    prevUrlRunIdsRef.current = urlRunIds;

    // Skip if this URL change was triggered by our own selection update.
    // The round-trip (selection → URL → back here) would overwrite the full
    // selection with only the runs present in the current filtered `runs`
    // array, losing selections for runs filtered out by view presets.
    if (isLocalSelectionUpdateRef.current) {
      isLocalSelectionUpdateRef.current = false;
      return;
    }

    // If we have runs loaded and URL params changed, apply the new selection
    const newSelection = buildSelectionFromUrlParams(runs);
    if (newSelection) {
      const newColors: Record<RunId, Color> = {};
      for (const [id, entry] of Object.entries(newSelection)) {
        newColors[id] = entry.color;
      }
      setRunColors(newColors);
      setSelectedRunsWithColors(newSelection);
      urlParamsAppliedRef.current = true;
    }
  }, [urlRunIds, runs, buildSelectionFromUrlParams]);

  // Initialize or update selections when runs change.
  // Colors are only assigned to SELECTED runs (sequential from palette)
  // so that a small selection always gets maximally distinct colors.
  // Uses refs for runColors/selectedRunsWithColors to avoid circular re-runs.
  useEffect(() => {
    if (!runs?.length) return;

    const currentSelectedRuns = selectedRunsRef.current;

    // Helper to select first N runs with sequential palette colors
    const selectDefaultRuns = (n: number) => {
      const runsToSelect = runs.slice(0, n);
      const colorMap = assignSequentialColors(runsToSelect, chartColorsRef.current);
      const selected: Record<RunId, { run: Run; color: Color }> = {};
      for (const run of runsToSelect) {
        selected[run.id] = { run, color: colorMap[run.id] };
      }
      return { selected, colors: colorMap };
    };

    // Initialize selected runs only if not already initialized and no cache restored.
    // Use a dedicated ref flag (not selectedRunsRef) since the ref lags behind state.
    if (!initializedRef.current && Object.keys(currentSelectedRuns).length === 0) {
      initializedRef.current = true;
      if (urlRunIds && urlRunIds.length > 0 && !urlParamsAppliedRef.current) {
        urlParamsAppliedRef.current = true;
        const newSelection = buildSelectionFromUrlParams(runs);
        if (newSelection) {
          const newColors: Record<RunId, Color> = {};
          for (const [id, entry] of Object.entries(newSelection)) {
            newColors[id] = entry.color;
          }
          setRunColors(newColors);
          setSelectedRunsWithColors(newSelection);
        } else {
          const { selected, colors } = selectDefaultRuns(5);
          setRunColors(colors);
          setSelectedRunsWithColors(selected);
        }
      } else if (!urlParamsAppliedRef.current || !urlRunIds?.length) {
        const { selected, colors } = selectDefaultRuns(5);
        setRunColors(colors);
        setSelectedRunsWithColors(selected);
      }
    } else {
      initializedRef.current = true;
      // Cache was restored before runs arrived — check for URL override
      if (urlRunIds && urlRunIds.length > 0 && !urlParamsAppliedRef.current) {
        urlParamsAppliedRef.current = true;
        const newSelection = buildSelectionFromUrlParams(runs);
        if (newSelection) {
          const newColors: Record<RunId, Color> = {};
          for (const [id, entry] of Object.entries(newSelection)) {
            newColors[id] = entry.color;
          }
          setRunColors(newColors);
          setSelectedRunsWithColors(newSelection);
        }
      }
      // No need to assign colors to unselected runs — colors are only for selected runs
    }
  }, [runs, urlRunIds, buildSelectionFromUrlParams]);

  // Keep stored run objects in sync when the upstream `runs` array is enriched
  // (e.g., when fieldValuesData loads and merges _flatConfig/_flatSystemMetadata).
  // Without this, selectedRunsWithColors holds stale run objects that lack these fields.
  // Uses functional update to read the latest state (not the stale ref), which avoids
  // overriding URL-param-driven selection that was set in the same render cycle.
  useEffect(() => {
    if (!runs?.length) return;

    const runsById = new Map(runs.map((r) => [r.id, r]));

    setSelectedRunsWithColors((currentSelected) => {
      if (Object.keys(currentSelected).length === 0) return currentSelected;

      let updated: Record<RunId, { run: Run; color: Color }> | null = null;

      for (const [id, entry] of Object.entries(currentSelected)) {
        const freshRun = runsById.get(id);
        if (freshRun && freshRun !== entry.run) {
          if (!updated) {
            updated = { ...currentSelected };
          }
          updated[id] = { ...entry, run: freshRun };
        }
      }

      return updated ?? currentSelected;
    });
  }, [runs]);

  // Notify parent when selection changes (for URL sync)
  useEffect(() => {
    if (onSelectionChange) {
      // Don't sync selection to URL if we have URL params that haven't been
      // applied yet. This prevents the IndexedDB cache (which loads before API
      // data) from overwriting the URL with stale cached selections.
      if (urlRunIds && urlRunIds.length > 0 && !urlParamsAppliedRef.current) {
        return;
      }
      // Mark that the upcoming URL change was triggered locally so the URL
      // effect doesn't round-trip and overwrite the selection.
      isLocalSelectionUpdateRef.current = true;
      const selectedIds = Object.keys(selectedRunsWithColors);
      onSelectionChange(selectedIds);
    }
  }, [selectedRunsWithColors, onSelectionChange]);

  // Memoize handlers to prevent unnecessary rerenders
  // Uses refs to avoid dependency on runs/runColors which change frequently
  const handleRunSelection = useCallback(
    (runId: RunId, isSelected: boolean) => {
      const currentRuns = runsRef.current;
      if (!currentRuns) return;

      // Use functional update to ensure we're working with latest state
      // Note: State updates are synchronous to keep checkbox feedback instant
      // Downstream metrics computation is deferred via useDeferredValue in parent
      setSelectedRunsWithColors((prev) => {
        // If already in desired state, don't update
        const isCurrentlySelected = !!prev[runId];
        if (isSelected === isCurrentlySelected) {
          return prev;
        }

        if (isSelected) {
          // Find the run from the runs array
          const run = currentRuns.find((r) => r.id === runId);
          if (!run) return prev;

          // Assign the next available palette color (not used by other selected runs)
          const usedColors = new Set(Object.values(prev).map((e) => e.color));
          const color = getNextAvailableColor(usedColors, chartColorsRef.current);

          setRunColors((prevColors) => ({
            ...prevColors,
            [runId]: color,
          }));

          return {
            ...prev,
            [runId]: { run, color },
          };
        }

        // Deselection - remove from selected runs and runColors
        const { [runId]: _, ...rest } = prev;
        setRunColors((prevColors) => {
          const { [runId]: _, ...restColors } = prevColors;
          return restColors;
        });
        return rest;
      });
    },
    [], // Stable - uses refs instead of direct dependencies
  );

  const handleColorChange = useCallback(
    (runId: RunId, color: Color) => {
      const currentRuns = runsRef.current;

      // Update both states atomically
      setRunColors((prev) => ({
        ...prev,
        [runId]: color,
      }));

      setSelectedRunsWithColors((prev) => {
        const run = prev[runId]?.run || currentRuns?.find((r) => r.id === runId);
        if (!run) return prev;

        return {
          ...prev,
          [runId]: {
            run,
            color,
          },
        };
      });
    },
    [], // Stable - uses refs instead of direct dependencies
  );

  // Select the first N runs with sequential palette colors
  const selectFirstN = useCallback(
    (n: number) => {
      if (!runs?.length) return;

      const firstNRuns = runs.slice(0, n);
      const colorMap = assignSequentialColors(firstNRuns, chartColorsRef.current);
      const newSelectedRuns: Record<RunId, { run: Run; color: Color }> = {};

      firstNRuns.forEach((run) => {
        newSelectedRuns[run.id] = { run, color: colorMap[run.id] };
      });

      setRunColors(colorMap);
      setSelectedRunsWithColors(newSelectedRuns);
    },
    [runs],
  );

  // Select all runs with given IDs, assigning next available palette colors
  const selectAllByIds = useCallback(
    (runIds: RunId[]) => {
      if (!runs?.length) return;

      const runsById = new Map(runs.map((r) => [r.id, r]));
      const currentSelected = selectedRunsRef.current;
      const usedColors = new Set(Object.values(currentSelected).map((e) => e.color));

      const newEntries: Record<RunId, { run: Run; color: Color }> = {};
      const newColors: Record<RunId, Color> = {};

      runIds.forEach((runId) => {
        if (!currentSelected[runId]) {
          const run = runsById.get(runId);
          if (run) {
            const color = getNextAvailableColor(usedColors, chartColorsRef.current);
            newEntries[runId] = { run, color };
            newColors[runId] = color;
            usedColors.add(color);
          }
        }
      });

      if (Object.keys(newEntries).length > 0) {
        setSelectedRunsWithColors((prev) => ({ ...prev, ...newEntries }));
        setRunColors((prev) => ({ ...prev, ...newColors }));
      }
    },
    [runs],
  );

  // Deselect all runs and clear their color assignments
  const deselectAll = useCallback(() => {
    setSelectedRunsWithColors({});
    setRunColors({});
  }, []);

  // Shuffle colors for all selected runs
  const shuffleColors = useCallback(() => {
    const selectedIds = Object.keys(selectedRunsWithColors);
    if (selectedIds.length === 0) return;

    // Get current colors and shuffle them
    const currentColors = selectedIds.map(
      (id) => selectedRunsWithColors[id].color,
    );

    // Fisher-Yates shuffle
    const shuffledColors = [...currentColors];
    for (let i = shuffledColors.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledColors[i], shuffledColors[j]] = [
        shuffledColors[j],
        shuffledColors[i],
      ];
    }

    // Apply shuffled colors — runColors mirrors selectedRunsWithColors
    const newRunColors: Record<RunId, Color> = {};
    const newSelectedRuns = { ...selectedRunsWithColors };

    selectedIds.forEach((id, index) => {
      newRunColors[id] = shuffledColors[index];
      newSelectedRuns[id] = {
        ...newSelectedRuns[id],
        color: shuffledColors[index],
      };
    });

    setRunColors(newRunColors);
    setSelectedRunsWithColors(newSelectedRuns);
  }, [selectedRunsWithColors]);

  // Reassign sequential palette colors to all selected runs from the current palette.
  // Called when the user switches palette type so all curves update at once.
  const reassignAllColors = useCallback(() => {
    const selectedIds = Object.keys(selectedRunsWithColors);
    if (selectedIds.length === 0) return;

    const palette = chartColorsRef.current;
    const colorMap = assignSequentialColors(
      selectedIds.map((id) => ({ id })),
      palette,
    );

    const newSelectedRuns = { ...selectedRunsWithColors };
    for (const id of selectedIds) {
      newSelectedRuns[id] = { ...newSelectedRuns[id], color: colorMap[id] };
    }

    setRunColors(colorMap);
    setSelectedRunsWithColors(newSelectedRuns);
  }, [selectedRunsWithColors]);

  return {
    runColors,
    selectedRunsWithColors,
    handleRunSelection,
    handleColorChange,
    selectFirstN,
    selectAllByIds,
    deselectAll,
    shuffleColors,
    reassignAllColors,
  };
}
