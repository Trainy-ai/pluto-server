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
  hiddenRunIds?: RunId[];
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
  /** Hidden run IDs from URL params */
  urlHiddenIds?: string[];
  /** Callback when selection changes (for URL sync) */
  onSelectionChange?: (selectedRunIds: string[]) => void;
  /** Callback when hidden runs change (for URL sync) */
  onHiddenChange?: (hiddenRunIds: string[]) => void;
}

interface UseSelectedRunsReturn {
  /** Map of selected run IDs to their assigned colors */
  runColors: Record<RunId, Color>;
  /** Map of selected run IDs to their run data and color */
  selectedRunsWithColors: Record<RunId, { run: Run; color: Color }>;
  /** Map of visible (selected and not hidden) run IDs to their run data and color */
  visibleRunsWithColors: Record<RunId, { run: Run; color: Color }>;
  /** Set of run IDs that are selected but hidden from charts */
  hiddenRunIds: Set<RunId>;
  /** Handler for selecting/deselecting runs */
  handleRunSelection: (runId: RunId, isSelected: boolean) => void;
  /** Handler for changing a run's color */
  handleColorChange: (runId: RunId, color: Color) => void;
  /** Toggle a run's chart visibility (hidden/shown) */
  toggleRunVisibility: (runId: RunId) => void;
  /** Show all hidden runs on charts */
  showAllRuns: () => void;
  /** Hide all selected runs from charts */
  hideAllRuns: () => void;
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
 * Generate a visually distinct color using the golden angle for hue spacing.
 * This produces colors that are maximally separated in hue space.
 */
function generateGoldenAngleColor(index: number): string {
  const goldenAngle = 137.508;
  const hue = (index * goldenAngle) % 360;
  return `hsl(${hue.toFixed(1)}, 70%, 55%)`;
}

/**
 * Get the next available color from the palette that isn't already in use.
 * This ensures selected runs always get maximally distinct colors.
 * When the palette is exhausted, generates new colors using the golden angle
 * for infinite visually distinct colors.
 */
function getNextAvailableColor(usedColors: Set<string>, palette: string[]): string {
  for (const color of palette) {
    if (!usedColors.has(color)) return color;
  }
  // Palette exhausted — generate a unique color beyond the palette
  const overflowIndex = usedColors.size - palette.length;
  return generateGoldenAngleColor(overflowIndex);
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

// ---------------------------------------------------------------------------
// Selection initialization state machine
//
// Three competing sources resolve at different times:
//   1. URL params  (?runs=id1,id2)  — highest priority, shareable links
//   2. IndexedDB cache              — persists selection across reloads
//   3. Default (first 5 runs)       — fallback when nothing else applies
//
// Previous bugs arose because ad-hoc ref flags couldn't track ordering
// reliably. This explicit state machine makes the priority deterministic:
//
//   uninit ─┬─ url params present? ──► url-pending ──► url-applied
//           │                                  (runs arrive with matching IDs)
//           └─ no url params ──► cache-pending ──► cache-applied
//                                       │
//                                       └─ cache empty ──► default
//
// Once in "url-applied", "cache-applied", or "default", initialization is
// complete and further changes are user-driven (clicks, select-all, etc.).
// ---------------------------------------------------------------------------
type InitPhase =
  | "uninit"        // Nothing decided yet
  | "url-pending"   // URL params exist but target runs haven't loaded yet
  | "url-applied"   // URL params successfully resolved and applied
  | "cache-pending" // No URL params; waiting for IndexedDB cache
  | "cache-applied" // Cache restored successfully
  | "default"       // Fell back to selecting first N runs
  | "ready";        // Initialization complete (any source)

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
  const { urlRunIds, urlHiddenIds, onSelectionChange, onHiddenChange } = options ?? {};

  // Get theme-aware color palette
  const chartColors = useChartColors();

  // Store colors for selected runs only (sequential palette assignment)
  const [runColors, setRunColors] = useState<Record<RunId, Color>>({});
  const [selectedRunsWithColors, setSelectedRunsWithColors] = useState<
    Record<RunId, { run: Run; color: Color }>
  >({});

  // Hidden runs: selected but not shown on charts
  const [hiddenRunIds, setHiddenRunIds] = useState<Set<RunId>>(new Set());
  const hiddenRunIdsRef = useRef(hiddenRunIds);
  useEffect(() => {
    hiddenRunIdsRef.current = hiddenRunIds;
  }, [hiddenRunIds]);

  // Derive visible runs (selected minus hidden)
  const visibleRunsWithColors = useMemo(() => {
    if (hiddenRunIds.size === 0) return selectedRunsWithColors;
    const visible: Record<RunId, { run: Run; color: Color }> = {};
    for (const [id, entry] of Object.entries(selectedRunsWithColors)) {
      if (!hiddenRunIds.has(id)) {
        visible[id] = entry;
      }
    }
    return visible;
  }, [selectedRunsWithColors, hiddenRunIds]);

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

  // --- State machine for initialization ---
  const initPhaseRef = useRef<InitPhase>("uninit");
  // Track the previous URL run IDs to detect navigation changes
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

  // --- Helpers ---

  /** Build a selection from URL run IDs, matching against available runs. */
  const buildSelectionFromUrl = useCallback(
    (availableRuns: Run[]): Record<RunId, { run: Run; color: Color }> | null => {
      if (!urlRunIds?.length) return null;

      const runsById = new Map(availableRuns.map((r) => [r.id, r]));
      const matchedRuns = urlRunIds
        .map((id) => runsById.get(id))
        .filter((r): r is Run => r != null);

      // Wait until ALL URL runs are found in availableRuns before applying.
      // A partial match means some runs haven't loaded yet (e.g., getByIds
      // prefetch still in flight). Returning null keeps us in url-pending.
      // Invalid/deleted IDs won't cause a hang because urlRunIds (a dep of
      // this effect) updates once the prefetch resolves, dropping invalid IDs.
      if (matchedRuns.length < urlRunIds.length) return null;

      const colorAssignment = assignSequentialColors(matchedRuns, chartColorsRef.current);
      const selected: Record<RunId, { run: Run; color: Color }> = {};
      for (const run of matchedRuns) {
        selected[run.id] = { run, color: colorAssignment[run.id] };
      }
      return selected;
    },
    [urlRunIds],
  );

  /** Select first N runs with sequential palette colors. */
  const buildDefaultSelection = useCallback(
    (availableRuns: Run[], n: number) => {
      const runsToSelect = availableRuns.slice(0, n);
      const colorMap = assignSequentialColors(runsToSelect, chartColorsRef.current);
      const selected: Record<RunId, { run: Run; color: Color }> = {};
      for (const run of runsToSelect) {
        selected[run.id] = { run, color: colorMap[run.id] };
      }
      return { selected, colors: colorMap };
    },
    [],
  );

  /** Apply a selection map to state (colors + selected runs + hidden). */
  const applySelection = useCallback(
    (
      selection: Record<RunId, { run: Run; color: Color }>,
      hidden?: string[],
    ) => {
      const newColors: Record<RunId, Color> = {};
      for (const [id, entry] of Object.entries(selection)) {
        newColors[id] = entry.color;
      }
      setRunColors(newColors);
      setSelectedRunsWithColors(selection);
      if (hidden?.length) {
        const selectedSet = new Set(Object.keys(selection));
        setHiddenRunIds(new Set(hidden.filter((id) => selectedSet.has(id))));
      } else {
        setHiddenRunIds(new Set());
      }
    },
    [],
  );

  // --- Initialization: reset on org/project change ---
  useEffect(() => {
    setRunColors({});
    setSelectedRunsWithColors({});
    setHiddenRunIds(new Set());
    prevUrlRunIdsRef.current = undefined;

    if (urlRunIds?.length) {
      // URL params present — skip cache, wait for runs to resolve
      initPhaseRef.current = "url-pending";
    } else {
      // No URL params — try loading from cache
      initPhaseRef.current = "cache-pending";

      let cancelled = false;
      const loadCache = async () => {
        try {
          const cachedData = await runCacheDb.getData(storageKey);
          if (cancelled) return;
          // If URL params arrived while cache was loading, abort
          if (initPhaseRef.current !== "cache-pending") return;

          if (cachedData?.data) {
            const hasColors = Object.keys(cachedData.data.colors).length > 0;
            const hasSelection = Object.keys(cachedData.data.selectedRuns).length > 0;
            if (hasColors || hasSelection) {
              if (hasColors) setRunColors(cachedData.data.colors);
              if (hasSelection) setSelectedRunsWithColors(cachedData.data.selectedRuns);
              if (cachedData.data.hiddenRunIds?.length) {
                setHiddenRunIds(new Set(cachedData.data.hiddenRunIds));
              }
              initPhaseRef.current = "cache-applied";
              return;
            }
          }
          // Cache empty or missing — will fall through to default when runs arrive
          initPhaseRef.current = "uninit";
        } catch {
          if (!cancelled) {
            initPhaseRef.current = "uninit";
          }
        }
      };

      loadCache();
      return () => { cancelled = true; };
    }
    // urlRunIds intentionally read from closure but omitted from deps — we only
    // check it on mount / project-change to decide the init path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // --- Main initialization effect: runs arrive or update ---
  useEffect(() => {
    if (!runs?.length) return;

    const phase = initPhaseRef.current;

    // Already fully initialized — nothing to do
    if (phase === "ready") return;

    if (phase === "url-pending") {
      // Try to resolve URL params against the current runs
      const selection = buildSelectionFromUrl(runs);
      if (selection) {
        applySelection(selection, urlHiddenIds);
        initPhaseRef.current = "ready";
        prevUrlRunIdsRef.current = urlRunIds;
      }
      // If selection is null, the target runs haven't loaded yet (e.g.,
      // getByIds prefetch is still in flight). Stay in url-pending — this
      // effect will re-run when `runs` updates with the prefetched data.
      return;
    }

    if (phase === "cache-applied") {
      // Cache was restored — we're done initializing
      initPhaseRef.current = "ready";
      return;
    }

    if (phase === "cache-pending") {
      // Cache is still loading — don't race it with defaults.
      // The cache effect will transition to cache-applied or uninit.
      return;
    }

    // phase === "uninit" or "default" — no URL, no cache (or cache was empty)
    const { selected, colors } = buildDefaultSelection(runs, 5);
    setRunColors(colors);
    setSelectedRunsWithColors(selected);
    initPhaseRef.current = "ready";
  }, [runs, urlRunIds, urlHiddenIds, buildSelectionFromUrl, buildDefaultSelection, applySelection]);

  // --- Handle URL param changes AFTER initialization (navigation) ---
  useEffect(() => {
    // Only handle post-init URL changes
    if (initPhaseRef.current !== "ready") return;

    const prevIdsStr = prevUrlRunIdsRef.current?.join(",") ?? "";
    const newIdsStr = urlRunIds?.join(",") ?? "";
    if (prevIdsStr === newIdsStr) return;

    // Don't update ref until runs are loaded so we can actually apply
    if (!runs?.length) return;

    prevUrlRunIdsRef.current = urlRunIds;

    // Skip if this URL change was triggered by our own selection update
    if (isLocalSelectionUpdateRef.current) {
      isLocalSelectionUpdateRef.current = false;
      return;
    }

    // Apply new URL selection
    if (urlRunIds?.length) {
      const selection = buildSelectionFromUrl(runs);
      if (selection) {
        applySelection(selection, urlHiddenIds);
      }
    }
  }, [urlRunIds, urlHiddenIds, runs, buildSelectionFromUrl, applySelection]);

  // --- Debounced save to cache ---
  const debouncedSaveToCache = useDebouncedCallback(
    async (colors: Record<RunId, Color>, selected: Record<RunId, { run: Run; color: Color }>, hidden: Set<RunId>, key: string) => {
      try {
        await runCacheDb.setData(key, {
          colors,
          selectedRuns: selected,
          hiddenRunIds: Array.from(hidden),
        });
      } catch (error) {
        console.error("Error saving run selections to cache:", error);
      }
    },
    500,
  );

  // Save to cache whenever state changes (debounced).
  // Guard on ready phase to avoid overwriting cache before it's restored.
  useEffect(() => {
    if (initPhaseRef.current !== "ready") return;
    debouncedSaveToCache(runColors, selectedRunsWithColors, hiddenRunIds, storageKey);
  }, [runColors, selectedRunsWithColors, hiddenRunIds, debouncedSaveToCache, storageKey]);

  // --- Keep stored run objects fresh when upstream `runs` is enriched ---
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

  // --- Notify parent when selection changes (for URL sync) ---
  useEffect(() => {
    if (onSelectionChange) {
      // Don't sync to URL before initialization is complete
      if (initPhaseRef.current !== "ready") return;
      // Mark that the upcoming URL change was triggered locally
      isLocalSelectionUpdateRef.current = true;
      const selectedIds = Object.keys(selectedRunsWithColors);
      onSelectionChange(selectedIds);
    }
  }, [selectedRunsWithColors, onSelectionChange]);

  // --- User action handlers ---

  const handleRunSelection = useCallback(
    (runId: RunId, isSelected: boolean) => {
      const currentRuns = runsRef.current;
      if (!currentRuns) return;

      setSelectedRunsWithColors((prev) => {
        const isCurrentlySelected = !!prev[runId];
        if (isSelected === isCurrentlySelected) return prev;

        if (isSelected) {
          const run = currentRuns.find((r) => r.id === runId);
          if (!run) return prev;

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

        // Deselection
        const { [runId]: _, ...rest } = prev;
        setRunColors((prevColors) => {
          const { [runId]: _, ...restColors } = prevColors;
          return restColors;
        });
        setHiddenRunIds((prevHidden) => {
          if (!prevHidden.has(runId)) return prevHidden;
          const next = new Set(prevHidden);
          next.delete(runId);
          return next;
        });
        return rest;
      });
    },
    [],
  );

  const handleColorChange = useCallback(
    (runId: RunId, color: Color) => {
      const currentRuns = runsRef.current;

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
    [],
  );

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
      setHiddenRunIds(new Set());
    },
    [runs],
  );

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

  const deselectAll = useCallback(() => {
    setSelectedRunsWithColors({});
    setRunColors({});
    setHiddenRunIds(new Set());
  }, []);

  const shuffleColors = useCallback(() => {
    const selectedIds = Object.keys(selectedRunsWithColors);
    if (selectedIds.length === 0) return;

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

  const toggleRunVisibility = useCallback((runId: RunId) => {
    setHiddenRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  }, []);

  const showAllRuns = useCallback(() => {
    setHiddenRunIds(new Set());
  }, []);

  const hideAllRuns = useCallback(() => {
    setHiddenRunIds(new Set(Object.keys(selectedRunsWithColors)));
  }, [selectedRunsWithColors]);

  // Notify parent when hidden runs change (for URL sync)
  useEffect(() => {
    if (onHiddenChange) {
      if (initPhaseRef.current !== "ready") return;
      isLocalSelectionUpdateRef.current = true;
      onHiddenChange(Array.from(hiddenRunIds));
    }
  }, [hiddenRunIds, onHiddenChange]);

  return {
    runColors,
    selectedRunsWithColors,
    visibleRunsWithColors,
    hiddenRunIds,
    handleRunSelection,
    handleColorChange,
    toggleRunVisibility,
    showAllRuns,
    hideAllRuns,
    selectFirstN,
    selectAllByIds,
    deselectAll,
    shuffleColors,
    reassignAllColors,
  };
}
