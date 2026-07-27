import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { moveRelative } from "@/lib/array";
import { generateUuid } from "@/lib/uuid";
import {
  CUSTOM_SECTION_KEY_PREFIX,
  type ChartsLayoutConfig,
} from "../../~lib/charts-layout";

/** One section of the draft, in draft order. */
export interface DraftGroup {
  key: string;
  /** Display name — the derived group name, or the user-set custom section name. */
  name: string;
  isCustom: boolean;
  hidden: boolean;
  /** Metric names in the section's current (overlay-applied) order. */
  metricNames: string[];
  /** Membership-applied order before `metricOrder` — the "no explicit order" baseline. */
  defaultMetricNames: string[];
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Deep-compare two draft arrangements. */
function sameGroups(a: DraftGroup[], b: DraftGroup[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (g, i) =>
        g.key === b[i].key &&
        g.name === b[i].name &&
        g.isCustom === b[i].isCustom &&
        g.hidden === b[i].hidden &&
        sameOrder(g.metricNames, b[i].metricNames) &&
        sameOrder(g.defaultMetricNames, b[i].defaultMetricNames),
    )
  );
}

/**
 * Merge a refreshed base arrangement into an in-progress draft. Draft
 * placement wins for metrics that still exist anywhere (so unsaved
 * cross-section moves survive an auto-refresh tick); genuinely new metrics
 * join the section the incoming arrangement places them in; vanished metrics
 * and derived groups are dropped; unsaved custom sections are kept.
 */
export function reconcileDraftGroups(
  prev: DraftGroup[],
  incoming: DraftGroup[],
): DraftGroup[] {
  const incomingByKey = new Map(incoming.map((g) => [g.key, g]));
  const liveNames = new Set(incoming.flatMap((g) => g.metricNames));
  const namesInDraft = new Set(prev.flatMap((g) => g.metricNames));

  const kept = prev
    .filter((g) => incomingByKey.has(g.key) || g.isCustom)
    .map((g) => {
      const incomingGroup = incomingByKey.get(g.key);
      const keptNames = g.metricNames.filter((n) => liveNames.has(n));
      const added = (incomingGroup?.metricNames ?? []).filter(
        (n) => !namesInDraft.has(n),
      );
      return {
        key: g.key,
        name: g.name,
        isCustom: g.isCustom,
        hidden: g.hidden,
        metricNames: [...keptNames, ...added],
        defaultMetricNames: incomingGroup?.defaultMetricNames ?? [],
      };
    });
  const keptKeys = new Set(kept.map((g) => g.key));
  // New incoming groups may re-list metrics the draft already retains
  // elsewhere (draft placement wins) — dedupe so no metric appears twice.
  const namesKept = new Set(kept.flatMap((g) => g.metricNames));
  const added = incoming
    .filter((g) => !keptKeys.has(g.key))
    .map((g) => {
      const dedupedNames = g.metricNames.filter((n) => !namesKept.has(n));
      return dedupedNames.length === g.metricNames.length
        ? g
        : { ...g, metricNames: dedupedNames };
    });
  return [...kept, ...added];
}

/**
 * Express the draft as an overlay config. `membership` is recomputed from the
 * current arrangement vs. derived homes, so stale entries prune themselves on
 * save; `metricOrder` is persisted only where the order differs from the
 * membership-applied baseline.
 */
export function buildDraftConfig(
  draft: DraftGroup[],
  derivedHomeByMetric: Map<string, string>,
): ChartsLayoutConfig {
  const metricOrder: Record<string, string[]> = {};
  const membership: Record<string, string> = {};
  draft.forEach((g) => {
    if (!sameOrder(g.metricNames, g.defaultMetricNames)) {
      metricOrder[g.key] = g.metricNames;
    }
    g.metricNames.forEach((n) => {
      const home = derivedHomeByMetric.get(n);
      if (home !== undefined && home !== g.key) {
        membership[n] = g.key;
      }
    });
  });
  return {
    version: 2,
    order: draft.map((g) => g.key),
    hidden: draft.filter((g) => g.hidden).map((g) => g.key),
    metricOrder,
    customSections: draft
      .filter((g) => g.isCustom)
      .map((g) => ({ key: g.key, name: g.name })),
    membership,
  };
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
  derivedHomeByMetric: Map<string, string>,
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
      const next = reconcileDraftGroups(prev, baseGroups);
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

  const moveMetricToSection = useCallback(
    (name: string, fromKey: string, toKey: string) => {
      setDraft((prev) => {
        if (fromKey === toKey) {
          return prev;
        }
        const from = prev.find((g) => g.key === fromKey);
        if (!from || !from.metricNames.includes(name)) {
          return prev;
        }
        if (!prev.some((g) => g.key === toKey)) {
          return prev;
        }
        return prev.map((g) => {
          if (g.key === fromKey) {
            return { ...g, metricNames: g.metricNames.filter((n) => n !== name) };
          }
          if (g.key === toKey) {
            return { ...g, metricNames: [...g.metricNames, name] };
          }
          return g;
        });
      });
    },
    [],
  );

  const addSection = useCallback((name: string): string => {
    const key = `${CUSTOM_SECTION_KEY_PREFIX}${generateUuid().slice(0, 8)}`;
    setDraft((prev) => [
      ...prev,
      {
        key,
        name,
        isCustom: true,
        hidden: false,
        metricNames: [],
        defaultMetricNames: [],
      },
    ]);
    return key;
  }, []);

  const renameSection = useCallback((key: string, name: string) => {
    setDraft((prev) =>
      prev.map((g) => (g.key === key && g.isCustom ? { ...g, name } : g)),
    );
  }, []);

  const removeSection = useCallback(
    (key: string) => {
      setDraft((prev) => {
        const removed = prev.find((g) => g.key === key && g.isCustom);
        if (!removed) {
          return prev;
        }
        const rest = prev.filter((g) => g.key !== key);
        // Orphaned charts return to their derived home section when it is
        // present in the draft; otherwise they reappear on the next reconcile.
        return rest.map((g) => {
          const returning = removed.metricNames.filter(
            (n) => derivedHomeByMetric.get(n) === g.key,
          );
          return returning.length
            ? { ...g, metricNames: [...g.metricNames, ...returning] }
            : g;
        });
      });
    },
    [derivedHomeByMetric],
  );

  // The draft expressed as an overlay config — used both to render the charts
  // WYSIWYG while editing and as the payload on save.
  const draftConfig = useMemo(
    () => buildDraftConfig(draft, derivedHomeByMetric),
    [draft, derivedHomeByMetric],
  );

  const dirty = useMemo(
    () => !sameGroups(draft, baseGroups),
    [draft, baseGroups],
  );

  return {
    draftConfig,
    dirty,
    toggleHidden,
    moveSection,
    moveMetric,
    moveMetricToSection,
    addSection,
    renameSection,
    removeSection,
  };
}
