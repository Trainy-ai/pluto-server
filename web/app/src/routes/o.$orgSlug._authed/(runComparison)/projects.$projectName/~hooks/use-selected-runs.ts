import { useState, useEffect, useCallback, useMemo } from "react";
import { COLORS } from "@/components/ui/color-picker";
import type { Run } from "../~queries/list-runs";
import { LocalCache } from "@/lib/db/local-cache";

// alias types for documentation purposes
type Color = string;
type RunId = string;

// Create a single LocalCache for all run-related data
const runCacheDb = new LocalCache<{
  colors: Record<RunId, Color>;
  selectedRuns: Record<RunId, { run: Run; color: Color }>;
}>(
  "run-selection-db",
  "run-selections",
  10 * 1024 * 1024, // 10MB limit
);

// Unique key for storing in the cache
const STORAGE_KEY = "run-selection-data";

interface UseSelectedRunsReturn {
  /** Map of all run IDs to their assigned colors */
  runColors: Record<RunId, Color>;
  /** Map of selected run IDs to their run data and color */
  selectedRunsWithColors: Record<RunId, { run: Run; color: Color }>;
  /** Handler for selecting/deselecting runs */
  handleRunSelection: (runId: RunId, isSelected: boolean) => void;
  /** Handler for changing a run's color */
  handleColorChange: (runId: RunId, color: Color) => void;
  /** Initial row selection state for the table
   * this is the index of the run in the runs array
   * mapped to a boolean value indicating if the run is selected
   */
  defaultRowSelection: Record<number, boolean>;
}

/**
 * Get a deterministic color based on the run id
 * @param runId - The ID of the run to generate a color for
 * @returns A color from the predefined palette
 */
const getColorForRun = (runId: string): Color => {
  // Simple hash function to convert string to number
  const hash = runId.split("").reduce((acc, char, index) => {
    // Add positional weighting to create more variation
    return char.charCodeAt(0) * (index + 1) + ((acc << 5) - acc);
  }, 0);

  // Use the hash to select a color from the palette
  // The modulo determines which color is selected
  return COLORS[Math.abs(hash) % COLORS.length];
};

/**
 * Custom hook for managing run selection and color assignment
 *
 * Features:
 * - Assigns deterministic colors to runs based on their names
 * - Maintains color consistency across selections
 * - Automatically selects the 5 most recent runs initially
 * - Provides handlers for selection and color changes
 * - Persists selections and colors in local cache
 *
 * @param runs - Array of run objects from the API
 * @returns Object containing state and handlers for run selection and colors
 */
export function useSelectedRuns(
  runs: Run[] | undefined,
): UseSelectedRunsReturn {
  // Store all run colors, whether selected or not
  const [runColors, setRunColors] = useState<Record<RunId, Color>>({});
  const [selectedRunsWithColors, setSelectedRunsWithColors] = useState<
    Record<RunId, { run: Run; color: Color }>
  >({});

  // Load cached data on initial render
  useEffect(() => {
    const loadCachedData = async () => {
      try {
        const cachedData = await runCacheDb.getData(STORAGE_KEY);
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
  }, []);

  // Save to cache whenever state changes
  useEffect(() => {
    const saveToCache = async () => {
      try {
        // Only save if we have meaningful data
        if (
          Object.keys(runColors).length > 0 ||
          Object.keys(selectedRunsWithColors).length > 0
        ) {
          await runCacheDb.setData(STORAGE_KEY, {
            colors: runColors,
            selectedRuns: selectedRunsWithColors,
          });
        }
      } catch (error) {
        console.error("Error saving run selections to cache:", error);
      }
    };

    saveToCache();
  }, [runColors, selectedRunsWithColors]);

  // Initialize or update colors when runs change
  useEffect(() => {
    if (!runs?.length) return;

    // First run initialization - set initial colors and selections
    if (Object.keys(runColors).length === 0) {
      const newColors = runs.reduce<Record<RunId, Color>>((acc, run) => {
        acc[run.id] = getColorForRun(run.id);
        return acc;
      }, {});

      setRunColors(newColors);

      // Initialize selected runs only if none are selected yet
      if (Object.keys(selectedRunsWithColors).length === 0) {
        const latestRuns = runs.slice(0, 5);
        const newSelectedRuns = latestRuns.reduce<
          Record<RunId, { run: Run; color: Color }>
        >((acc, run) => {
          acc[run.id] = {
            run,
            color: newColors[run.id],
          };
          return acc;
        }, {});

        setSelectedRunsWithColors(newSelectedRuns);
      }
    }
    // Handle subsequent runs loaded through pagination
    else {
      // Find runs that don't have colors assigned yet
      const runsWithoutColors = runs.filter((run) => !runColors[run.id]);

      if (runsWithoutColors.length > 0) {
        // Generate colors for new runs
        const newColors = runsWithoutColors.reduce<Record<RunId, Color>>(
          (acc, run) => {
            acc[run.id] = getColorForRun(run.id);
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
  }, [runs, runColors, selectedRunsWithColors]); // Include runColors and selectedRunsWithColors in dependencies

  // Memoize handlers to prevent unnecessary rerenders
  const handleRunSelection = useCallback(
    (runId: RunId, isSelected: boolean) => {
      if (!runs) return;

      // Use functional update to ensure we're working with latest state
      setSelectedRunsWithColors((prev) => {
        // If already in desired state, don't update
        const isCurrentlySelected = !!prev[runId];
        if (isSelected === isCurrentlySelected) {
          return prev;
        }

        if (isSelected) {
          // Find the run from the runs array
          const run = runs.find((r) => r.id === runId);
          if (!run) return prev;

          // Ensure we have a color for this run - always use runId for consistency
          const color = runColors[runId] || getColorForRun(runId);

          // Update runColors if needed
          if (!runColors[runId]) {
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
    [runs, runColors],
  );

  const handleColorChange = useCallback(
    (runId: RunId, color: Color) => {
      // Update both states atomically
      setRunColors((prev) => ({
        ...prev,
        [runId]: color,
      }));

      setSelectedRunsWithColors((prev) => {
        const run = prev[runId]?.run || runs?.find((r) => r.id === runId);
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
    [runs],
  );

  // Generate defaultRowSelection based on current selectedRunsWithColors
  const defaultRowSelection = useMemo(() => {
    if (!runs?.length) return {};

    // If no runs are selected, select the first 5 by default
    if (Object.keys(selectedRunsWithColors).length === 0) {
      return {
        0: true,
        1: true,
        2: true,
        3: true,
        4: true,
      };
    }

    // Otherwise, create selection based on currently selected runs
    const selection: Record<number, boolean> = {};
    runs.forEach((run, index) => {
      selection[index] = !!selectedRunsWithColors[run.id];
    });

    return selection;
  }, [runs, selectedRunsWithColors]);

  return {
    runColors,
    selectedRunsWithColors,
    handleRunSelection,
    handleColorChange,
    defaultRowSelection,
  };
}
