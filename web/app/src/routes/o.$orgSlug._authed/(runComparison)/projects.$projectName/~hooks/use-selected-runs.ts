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
  /** Map of all run IDs to their assigned colors */
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
}

/**
 * Get a deterministic color based on the run id
 * @param runId - The ID of the run to generate a color for
 * @param colors - The color palette to use (theme-aware)
 * @returns A color from the predefined palette
 */
export const getColorForRun = (runId: string, colors: string[]): Color => {
  // Simple hash function to convert string to number
  const hash = runId.split("").reduce((acc, char, index) => {
    // Add positional weighting to create more variation
    return char.charCodeAt(0) * (index + 1) + ((acc << 5) - acc);
  }, 0);

  // Use the hash to select a color from the palette
  // The modulo determines which color is selected
  return colors[Math.abs(hash) % colors.length];
};

/**
 * Custom hook for managing run selection and color assignment
 *
 * Features:
 * - Assigns deterministic colors to runs based on their names
 * - Maintains color consistency across selections
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

  // Store all run colors, whether selected or not
  const [runColors, setRunColors] = useState<Record<RunId, Color>>({});
  const [selectedRunsWithColors, setSelectedRunsWithColors] = useState<
    Record<RunId, { run: Run; color: Color }>
  >({});

  // Use transition for selection updates to keep UI responsive
  // This allows React to interrupt expensive downstream renders
  const [, startTransition] = useTransition();

  // Ref for stable access to colors in callbacks
  const chartColorsRef = useRef(chartColors);
  useEffect(() => {
    chartColorsRef.current = chartColors;
  }, [chartColors]);

  // Track whether initial URL params have been applied
  const urlParamsAppliedRef = useRef(false);
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
    // Reset state first to clear any stale data from previous project
    setRunColors({});
    setSelectedRunsWithColors({});

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

  // Save to cache whenever state changes (debounced)
  useEffect(() => {
    if (
      Object.keys(runColors).length > 0 ||
      Object.keys(selectedRunsWithColors).length > 0
    ) {
      debouncedSaveToCache(runColors, selectedRunsWithColors, storageKey);
    }
  }, [runColors, selectedRunsWithColors, debouncedSaveToCache, storageKey]);

  // Handle URL param changes (when navigating with different ?runs= param)
  useEffect(() => {
    // Check if URL params actually changed
    const prevIds = prevUrlRunIdsRef.current;
    const prevIdsStr = prevIds?.join(",") ?? "";
    const newIdsStr = urlRunIds?.join(",") ?? "";

    if (prevIdsStr === newIdsStr) {
      return; // No change
    }

    // Update ref to track current value
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
    if (runs?.length && urlRunIds && urlRunIds.length > 0) {
      const runsById = new Map(runs.map((r) => [r.id, r]));
      const newSelectedRuns: Record<RunId, { run: Run; color: Color }> = {};

      urlRunIds.forEach((runId) => {
        const run = runsById.get(runId);
        if (run) {
          const color = runColors[runId] || getColorForRun(runId, chartColorsRef.current);
          newSelectedRuns[runId] = { run, color };
        }
      });

      // Apply the selection from URL params (replaces existing selection)
      if (Object.keys(newSelectedRuns).length > 0) {
        setSelectedRunsWithColors(newSelectedRuns);
        urlParamsAppliedRef.current = true;
      }
    }
  }, [urlRunIds, runs, runColors]);

  // Initialize or update colors when runs change.
  // Uses refs for runColors/selectedRunsWithColors to avoid circular re-runs
  // (this effect sets both of those values).
  useEffect(() => {
    if (!runs?.length) return;

    const currentRunColors = runColorsRef.current;
    const currentSelectedRuns = selectedRunsRef.current;

    // First run initialization - set initial colors and selections
    if (Object.keys(currentRunColors).length === 0) {
      const newColors = runs.reduce<Record<RunId, Color>>((acc, run) => {
        acc[run.id] = getColorForRun(run.id, chartColorsRef.current);
        return acc;
      }, {});

      setRunColors(newColors);

      // Helper to select first 5 runs as default
      const selectDefaultRuns = () => {
        const latestRuns = runs.slice(0, 5);
        return latestRuns.reduce<Record<RunId, { run: Run; color: Color }>>(
          (acc, run) => {
            acc[run.id] = { run, color: newColors[run.id] };
            return acc;
          },
          {},
        );
      };

      // Initialize selected runs only if none are selected yet
      if (Object.keys(currentSelectedRuns).length === 0) {
        // If URL params provided, use those for initial selection
        if (urlRunIds && urlRunIds.length > 0 && !urlParamsAppliedRef.current) {
          urlParamsAppliedRef.current = true;
          const runsById = new Map(runs.map((r) => [r.id, r]));
          const newSelectedRuns: Record<RunId, { run: Run; color: Color }> = {};

          urlRunIds.forEach((runId) => {
            const run = runsById.get(runId);
            if (run) {
              newSelectedRuns[runId] = {
                run,
                color: newColors[runId] || getColorForRun(runId, chartColorsRef.current),
              };
            }
          });

          // Only set if we found at least one valid run
          if (Object.keys(newSelectedRuns).length > 0) {
            setSelectedRunsWithColors(newSelectedRuns);
          } else {
            // Fall back to default: select first 5 runs
            setSelectedRunsWithColors(selectDefaultRuns());
          }
        } else if (!urlParamsAppliedRef.current || !urlRunIds?.length) {
          // No URL params or already applied - use default selection (first 5 runs)
          setSelectedRunsWithColors(selectDefaultRuns());
        }
      }
    }
    // Handle subsequent runs loaded through pagination
    else {
      // Find runs that don't have colors assigned yet
      const runsWithoutColors = runs.filter((run) => !currentRunColors[run.id]);

      if (runsWithoutColors.length > 0) {
        // Generate colors for new runs
        const newColors = runsWithoutColors.reduce<Record<RunId, Color>>(
          (acc, run) => {
            acc[run.id] = getColorForRun(run.id, chartColorsRef.current);
            return acc;
          },
          {},
        );

        // Update the colors state with the new colors
        setRunColors((prevColors) => ({
          ...prevColors,
          ...newColors,
        }));
      }
    }
  }, [runs, urlRunIds]);

  // Notify parent when selection changes (for URL sync)
  useEffect(() => {
    if (onSelectionChange) {
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

          // Ensure we have a color for this run - always use runId for consistency
          const currentRunColors = runColorsRef.current;
          const color = currentRunColors[runId] || getColorForRun(runId, chartColorsRef.current);

          // Update runColors if needed
          if (!currentRunColors[runId]) {
            setRunColors((prevColors) => ({
              ...prevColors,
              [runId]: color,
            }));
          }

          // Add the run to selected runs
          return {
            ...prev,
            [runId]: {
              run,
              color,
            },
          };
        }

        // Fast path for deselection - completely remove the run from the selected state
        const { [runId]: _, ...rest } = prev;
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

  // Select the first N runs
  const selectFirstN = useCallback(
    (n: number) => {
      if (!runs?.length) return;

      const firstNRuns = runs.slice(0, n);
      const newSelectedRuns: Record<RunId, { run: Run; color: Color }> = {};

      firstNRuns.forEach((run) => {
        const color = runColors[run.id] || getColorForRun(run.id, chartColorsRef.current);
        newSelectedRuns[run.id] = { run, color };
      });

      setSelectedRunsWithColors(newSelectedRuns);
    },
    [runs, runColors],
  );

  // Select all runs with given IDs
  // Uses Map for O(N+M) instead of O(N*M) complexity
  const selectAllByIds = useCallback(
    (runIds: RunId[]) => {
      if (!runs?.length) return;

      // Pre-compute runs by ID for O(1) lookup instead of O(N) find() calls
      const runsById = new Map(runs.map((r) => [r.id, r]));

      setSelectedRunsWithColors((prev) => {
        const newSelectedRuns = { ...prev };

        runIds.forEach((runId) => {
          if (!newSelectedRuns[runId]) {
            const run = runsById.get(runId);
            if (run) {
              const color = runColors[runId] || getColorForRun(runId, chartColorsRef.current);
              newSelectedRuns[runId] = { run, color };
            }
          }
        });

        return newSelectedRuns;
      });
    },
    [runs, runColors],
  );

  // Deselect all runs
  const deselectAll = useCallback(() => {
    setSelectedRunsWithColors({});
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

    // Apply shuffled colors
    const newRunColors = { ...runColors };
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
  }, [selectedRunsWithColors, runColors]);

  return {
    runColors,
    selectedRunsWithColors,
    handleRunSelection,
    handleColorChange,
    selectFirstN,
    selectAllByIds,
    deselectAll,
    shuffleColors,
  };
}
