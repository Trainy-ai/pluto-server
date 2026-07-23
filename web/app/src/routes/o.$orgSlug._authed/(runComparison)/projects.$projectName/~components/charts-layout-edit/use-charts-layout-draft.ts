import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { moveRelative } from "@/lib/array";
import { type ChartsLayoutConfig } from "../../~lib/charts-layout";

/** One section of the draft, in draft order. */
export interface DraftGroup {
  key: string;
  hidden: boolean;
  /** Metric names in the section's current (overlay-applied) order. */
  metricNames: string[];
  /** Metric names in the default auto-computed order, for minimal persistence. */
  defaultMetricNames: string[];
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Deep-compare two draft arrangements (order, hidden, and chart orders). */
function sameGroups(a: DraftGroup[], b: DraftGroup[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (g, i) =>
        g.key === b[i].key &&
        g.hidden === b[i].hidden &&
        sameOrder(g.metricNames, b[i].metricNames) &&
        sameOrder(g.defaultMetricNames, b[i].defaultMetricNames),
    )
  );
}

/**
 * Draft state for the WYSIWYG Charts-view layout editor.
 *
 * `baseGroups` is the saved-overlay-applied arrangement (what the view shows
 * outside edit mode). Entering edit mode snapshots it as the draft; while
 * editing, incoming group changes (auto-refresh discovering new metrics, the
 * layout query resolving) are reconciled into the draft without discarding
 * in-progress edits — order and hidden toggles are preserved for groups that
 * survive, new groups/metrics are appended, removed ones are dropped.
 */
export function useChartsLayoutDraft(
  baseGroups: DraftGroup[],
  isEditing: boolean,
) {
  const [draft, setDraft] = useState<DraftGroup[]>(baseGroups);
  const wasEditingRef = useRef(false);

  useEffect(() => {
    if (!isEditing) {
      wasEditingRef.current = false;
      return;
    }
    if (!wasEditingRef.current) {
      // Fresh edit session — snapshot the applied arrangement.
      wasEditingRef.current = true;
      setDraft(baseGroups);
      return;
    }
    // Mid-session reconcile against the latest base.
    setDraft((prev) => {
      const incomingByKey = new Map(baseGroups.map((g) => [g.key, g]));
      const kept = prev
        .filter((g) => incomingByKey.has(g.key))
        .map((g) => {
          const incoming = incomingByKey.get(g.key)!;
          const incomingNames = new Set(incoming.metricNames);
          const keptNames = g.metricNames.filter((n) => incomingNames.has(n));
          const seen = new Set(keptNames);
          const added = incoming.metricNames.filter((n) => !seen.has(n));
          return {
            ...incoming,
            hidden: g.hidden,
            metricNames: [...keptNames, ...added],
          };
        });
      const keptKeys = new Set(kept.map((g) => g.key));
      const added = baseGroups.filter((g) => !keptKeys.has(g.key));
      const next = [...kept, ...added];
      return sameGroups(next, prev) ? prev : next;
    });
  }, [baseGroups, isEditing]);

  const toggleHidden = useCallback((key: string) => {
    setDraft((prev) =>
      prev.map((g) => (g.key === key ? { ...g, hidden: !g.hidden } : g)),
    );
  }, []);

  const moveSection = useCallback(
    (fromKey: string, targetKey: string, position: "before" | "after") => {
      setDraft((prev) => {
        const keys = prev.map((g) => g.key);
        const nextKeys = moveRelative(keys, fromKey, targetKey, position);
        if (nextKeys === keys) {
          return prev;
        }
        const byKey = new Map(prev.map((g) => [g.key, g]));
        return nextKeys.map((k) => byKey.get(k)!);
      });
    },
    [],
  );

  const moveMetric = useCallback(
    (
      groupKey: string,
      fromName: string,
      targetName: string,
      position: "before" | "after",
    ) => {
      setDraft((prev) =>
        prev.map((g) => {
          if (g.key !== groupKey) {
            return g;
          }
          const next = moveRelative(g.metricNames, fromName, targetName, position);
          return next === g.metricNames ? g : { ...g, metricNames: next };
        }),
      );
    },
    [],
  );

  // The draft expressed as an overlay config — used both to render the charts
  // WYSIWYG while editing and as the payload on save. Only sections whose
  // chart order differs from the default are persisted, so the overlay stays
  // minimal and sections returned to default order drop their entry.
  const draftConfig = useMemo<ChartsLayoutConfig>(() => {
    const metricOrder: Record<string, string[]> = {};
    draft.forEach((g) => {
      if (!sameOrder(g.metricNames, g.defaultMetricNames)) {
        metricOrder[g.key] = g.metricNames;
      }
    });
    return {
      version: 1,
      order: draft.map((g) => g.key),
      hidden: draft.filter((g) => g.hidden).map((g) => g.key),
      metricOrder,
    };
  }, [draft]);

  const dirty = useMemo(
    () => !sameGroups(draft, baseGroups),
    [draft, baseGroups],
  );

  return { draftConfig, dirty, toggleHidden, moveSection, moveMetric };
}
