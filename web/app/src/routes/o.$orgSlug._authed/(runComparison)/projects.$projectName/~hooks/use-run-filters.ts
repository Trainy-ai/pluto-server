import { useState, useEffect, useMemo, useCallback } from "react";
import {
  type RunFilter,
  type ServerFilters,
  extractServerFilters,
  serializeFilters,
  deserializeFilters,
} from "@/lib/run-filters";

export function useRunFilters(orgSlug: string, projectName: string) {
  const [filters, setFilters] = useState<RunFilter[]>(() =>
    deserializeFilters(orgSlug, projectName)
  );

  // Persist to localStorage on change
  useEffect(() => {
    serializeFilters(orgSlug, projectName, filters);
  }, [orgSlug, projectName, filters]);

  const addFilter = useCallback((filter: RunFilter) => {
    setFilters((prev) => [...prev, filter]);
  }, []);

  const removeFilter = useCallback((filterId: string) => {
    setFilters((prev) => prev.filter((f) => f.id !== filterId));
  }, []);

  const updateFilter = useCallback(
    (filterId: string, updates: Partial<RunFilter>) => {
      setFilters((prev) =>
        prev.map((f) => (f.id === filterId ? { ...f, ...updates } : f))
      );
    },
    []
  );

  const clearAll = useCallback(() => {
    setFilters([]);
  }, []);

  const setAll = useCallback((newFilters: RunFilter[]) => {
    setFilters(newFilters);
  }, []);

  const serverFilters: ServerFilters = useMemo(
    () => extractServerFilters(filters),
    [filters]
  );

  return {
    filters,
    addFilter,
    removeFilter,
    updateFilter,
    clearAll,
    setAll,
    serverFilters,
  };
}
