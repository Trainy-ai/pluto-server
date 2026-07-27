import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GroupedMetrics } from "@/lib/grouping/types";
import { type ChartsLayoutEditApi } from "@/components/charts/context/charts-layout-edit-context";
import {
  useChartsLayout,
  useUpsertChartsLayout,
} from "../../~queries/charts-layout";
import {
  applyChartsSections,
  orderGroupMetrics,
  EMPTY_CHARTS_LAYOUT,
  type LaidOutSection,
  type SectionSource,
} from "../../~lib/charts-layout";
import {
  useChartsLayoutDraft,
  type DraftGroup,
} from "./use-charts-layout-draft";

type Metric = GroupedMetrics[string]["metrics"][number];

const EMPTY_DRAFT_GROUPS: DraftGroup[] = [];
const NEW_SECTION_DEFAULT_NAME = "New section";

export interface ChartsLayoutBannerProps {
  isSaving: boolean;
  isDirty: boolean;
  onSave: () => void;
  onCancel: () => void;
  onReset: () => void;
  onAddSection: (name: string) => void;
}

interface UseChartsLayoutEditorOptions {
  organizationId: string;
  projectName: string;
  sortedGroups: Array<[string, GroupedMetrics[string]]>;
  /** Per-derived-group metrics surviving the active search. */
  filteredMetricsPerGroup: Map<string, Metric[]>;
  /** Whether a search query is active (empty query shows everything). */
  searchActive: boolean;
  /** Editing resets whenever the selected dashboard view changes. */
  selectedViewId: string | null;
}

/**
 * All state and wiring for the default Charts view's persisted layout overlay
 * and its WYSIWYG editor: saved-overlay application (incl. membership +
 * custom sections), the edit draft, and the ChartsLayoutEditApi context value
 * that DropdownRegion's chrome consumes.
 */
export function useChartsLayoutEditor({
  organizationId,
  projectName,
  sortedGroups,
  filteredMetricsPerGroup,
  searchActive,
  selectedViewId,
}: UseChartsLayoutEditorOptions) {
  const { data: chartsLayoutData } = useChartsLayout(organizationId, projectName);
  const chartsLayout = chartsLayoutData?.config ?? EMPTY_CHARTS_LAYOUT;
  // Only allow editing once the saved overlay has loaded, so the editor's
  // initial draft reflects the persisted order rather than the default one.
  const isLayoutLoaded = chartsLayoutData !== undefined;
  const upsertChartsLayout = useUpsertChartsLayout(organizationId, projectName);
  const [isEditingLayout, setIsEditingLayout] = useState(false);

  // The layout editor only belongs to the default All Metrics view.
  useEffect(() => {
    setIsEditingLayout(false);
  }, [selectedViewId]);

  const sectionSources = useMemo<Array<SectionSource<Metric>>>(
    () =>
      sortedGroups.map(([key, data]) => ({
        key,
        groupName: data.groupName,
        items: data.metrics,
      })),
    [sortedGroups],
  );

  const derivedHomeByMetric = useMemo(() => {
    const map = new Map<string, string>();
    sortedGroups.forEach(([key, data]) =>
      data.metrics.forEach((m) => map.set(m.name, key)),
    );
    return map;
  }, [sortedGroups]);

  // Saved-overlay-applied arrangement. While editing, empty sections stay
  // materialized so they can serve as drop targets.
  const savedSections = useMemo(
    () =>
      applyChartsSections(sectionSources, (m) => m.name, chartsLayout, {
        keepEmpty: isEditingLayout,
      }),
    [sectionSources, chartsLayout, isEditingLayout],
  );

  // Draft base — only computed while the editor is open.
  const baseGroups = useMemo<DraftGroup[]>(() => {
    if (!isEditingLayout) {
      return EMPTY_DRAFT_GROUPS;
    }
    return savedSections.map((s) => ({
      key: s.key,
      name: s.groupName,
      isCustom: s.isCustom,
      hidden: s.hidden,
      metricNames: orderGroupMetrics(
        s.items,
        chartsLayout.metricOrder?.[s.key],
      ).map((m) => m.name),
      defaultMetricNames: s.items.map((m) => m.name),
    }));
  }, [isEditingLayout, savedSections, chartsLayout]);

  const {
    draftConfig,
    dirty,
    toggleHidden,
    moveSection,
    moveMetric,
    moveMetricToSection,
    addSection,
    renameSection,
    removeSection,
  } = useChartsLayoutDraft(baseGroups, derivedHomeByMetric, isEditingLayout);

  // WYSIWYG: while editing, the draft overlay drives the actual charts view.
  const effectiveLayout = isEditingLayout ? draftConfig : chartsLayout;

  const laidOutGroups = useMemo<Array<LaidOutSection<Metric>>>(
    () =>
      isEditingLayout
        ? applyChartsSections(sectionSources, (m) => m.name, draftConfig, {
            keepEmpty: true,
          })
        : savedSections,
    [isEditingLayout, sectionSources, draftConfig, savedSections],
  );

  // Names surviving the active search, across all derived groups. Applied
  // per-metric (not per-section) so moved charts and custom sections filter
  // correctly.
  const visibleMetricNames = useMemo(() => {
    if (!searchActive) {
      return null;
    }
    const set = new Set<string>();
    filteredMetricsPerGroup.forEach((metrics) =>
      metrics.forEach((m) => set.add(m.name)),
    );
    return set;
  }, [searchActive, filteredMetricsPerGroup]);

  const orderedMetricsPerGroup = useMemo(() => {
    const map = new Map<string, Metric[]>();
    laidOutGroups.forEach(({ key, items }) => {
      const searched = visibleMetricNames
        ? items.filter((m) => visibleMetricNames.has(m.name))
        : items;
      map.set(key, orderGroupMetrics(searched, effectiveLayout.metricOrder?.[key]));
    });
    return map;
  }, [laidOutGroups, visibleMetricNames, effectiveLayout]);

  // Sections to render: hidden ones stay visible while editing (dimmed) so
  // they can be re-shown; empty ones stay visible while editing as drop
  // targets; the search filter is layered on top.
  const visibleSections = useMemo(
    () =>
      laidOutGroups.filter((g) => {
        if (!isEditingLayout && g.hidden) {
          return false;
        }
        if (isEditingLayout) {
          return true;
        }
        return (orderedMetricsPerGroup.get(g.key) ?? []).length > 0;
      }),
    [laidOutGroups, isEditingLayout, orderedMetricsPerGroup],
  );

  // DropdownRegion sections are addressed by `${projectName}-${key}`.
  const groupIdToKey = useMemo(() => {
    const map = new Map<string, string>();
    laidOutGroups.forEach(({ key }) => map.set(`${projectName}-${key}`, key));
    return map;
  }, [laidOutGroups, projectName]);

  const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null);
  const [draggedItem, setDraggedItem] = useState<{
    groupId: string;
    name: string;
  } | null>(null);

  // After a chart moves to another section, bring the moved card into view so
  // its body actually renders. Chart cards are viewport-virtualized
  // (VirtualizedChart mounts only when near the viewport), and a freshly-added
  // custom section sorts to the bottom of a long page — so without this the
  // target section's count updates but the off-screen card stays a skeleton,
  // never "landing visibly in its new section". Runs in a rAF after the draft
  // re-render so the card exists; scrolling it near the viewport lets the
  // virtualization observer mount it. Edit-mode only (this hook drives the
  // editor); non-edit rendering and virtualization are untouched.
  const revealTargetRef = useRef<{ key: string; name: string } | null>(null);
  const [revealTick, setRevealTick] = useState(0);
  const requestReveal = useCallback((key: string, name: string) => {
    revealTargetRef.current = { key, name };
    setRevealTick((t) => t + 1);
  }, []);
  useEffect(() => {
    const target = revealTargetRef.current;
    if (!target) {
      return;
    }
    const raf = requestAnimationFrame(() => {
      const card = document.querySelector(
        `[data-testid="charts-layout-section"][data-group-key="${CSS.escape(
          target.key,
        )}"] [data-metric-name="${CSS.escape(target.name)}"]`,
      );
      card?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(raf);
  }, [revealTick]);

  const layoutEditApi = useMemo<ChartsLayoutEditApi | null>(() => {
    if (!isEditingLayout) {
      return null;
    }
    const hiddenSet = new Set(draftConfig.hidden);
    const customKeys = new Set(
      laidOutGroups.filter((g) => g.isCustom).map((g) => g.key),
    );
    const itemName = (groupId: string, index: number) => {
      const key = groupIdToKey.get(groupId);
      return key ? orderedMetricsPerGroup.get(key)?.[index]?.name : undefined;
    };
    const moveByName = (
      fromGroupId: string,
      metricName: string,
      targetGroupId: string,
    ) => {
      const fromKey = groupIdToKey.get(fromGroupId);
      const toKey = groupIdToKey.get(targetGroupId);
      if (fromKey && toKey) {
        moveMetricToSection(metricName, fromKey, toKey);
        requestReveal(toKey, metricName);
      }
    };
    return {
      getSectionKey: (groupId) => groupIdToKey.get(groupId),
      isSectionHidden: (groupId) => {
        const key = groupIdToKey.get(groupId);
        return key ? hiddenSet.has(key) : false;
      },
      toggleSectionHidden: (groupId) => {
        const key = groupIdToKey.get(groupId);
        if (key) {
          toggleHidden(key);
        }
      },
      isSectionCustom: (groupId) => {
        const key = groupIdToKey.get(groupId);
        return key ? customKeys.has(key) : false;
      },
      renameSection: (groupId, name) => {
        const key = groupIdToKey.get(groupId);
        if (key) {
          renameSection(key, name);
        }
      },
      removeSection: (groupId) => {
        const key = groupIdToKey.get(groupId);
        if (key) {
          removeSection(key);
        }
      },
      listSections: () =>
        laidOutGroups.map((g) => ({
          groupId: `${projectName}-${g.key}`,
          name: g.groupName,
        })),
      moveItemToSection: moveByName,
      moveItemToNewSection: (fromGroupId, metricName) => {
        const fromKey = groupIdToKey.get(fromGroupId);
        if (!fromKey) {
          return;
        }
        const toKey = addSection(NEW_SECTION_DEFAULT_NAME);
        moveMetricToSection(metricName, fromKey, toKey);
        requestReveal(toKey, metricName);
      },
      draggedSectionId,
      startSectionDrag: setDraggedSectionId,
      endSectionDrag: () => setDraggedSectionId(null),
      moveSectionOver: (targetGroupId, position) => {
        const fromKey = draggedSectionId
          ? groupIdToKey.get(draggedSectionId)
          : undefined;
        const targetKey = groupIdToKey.get(targetGroupId);
        if (fromKey && targetKey) {
          moveSection(fromKey, targetKey, position);
        }
      },
      getItemName: itemName,
      draggedItem,
      startItemDrag: (groupId, index) => {
        const name = itemName(groupId, index);
        if (name) {
          setDraggedItem({ groupId, name });
        }
      },
      endItemDrag: () => setDraggedItem(null),
      // Cross-section drags never reach here: `getChartDropProps` in
      // layout-edit-chrome.tsx returns early on `onDragOver` for
      // cross-section hovers (only its `onDrop` re-homes the chart via
      // `moveItemToSection`), so `groupId` always matches `draggedItem.groupId`.
      moveItemOver: (groupId, targetIndex, position) => {
        const key = groupIdToKey.get(groupId);
        const targetName = itemName(groupId, targetIndex);
        if (!key || !targetName || !draggedItem) {
          return;
        }
        moveMetric(key, draggedItem.name, targetName, position);
      },
    };
  }, [
    isEditingLayout,
    draftConfig.hidden,
    laidOutGroups,
    groupIdToKey,
    orderedMetricsPerGroup,
    projectName,
    toggleHidden,
    renameSection,
    removeSection,
    addSection,
    moveMetricToSection,
    draggedSectionId,
    moveSection,
    draggedItem,
    moveMetric,
    requestReveal,
  ]);

  const handleCancelEditing = useCallback(() => setIsEditingLayout(false), []);

  const handleSaveLayout = useCallback(() => {
    upsertChartsLayout.mutate(
      { organizationId, projectName, config: draftConfig },
      { onSuccess: () => setIsEditingLayout(false) },
    );
  }, [upsertChartsLayout, organizationId, projectName, draftConfig]);

  const handleResetLayout = useCallback(() => {
    upsertChartsLayout.mutate(
      { organizationId, projectName, config: EMPTY_CHARTS_LAYOUT },
      { onSuccess: () => setIsEditingLayout(false) },
    );
  }, [upsertChartsLayout, organizationId, projectName]);

  const bannerProps: ChartsLayoutBannerProps | null = isEditingLayout
    ? {
        isSaving: upsertChartsLayout.isPending,
        isDirty: dirty,
        onSave: handleSaveLayout,
        onCancel: handleCancelEditing,
        onReset: handleResetLayout,
        onAddSection: addSection,
      }
    : null;

  return {
    isEditingLayout,
    startEditing: () => setIsEditingLayout(true),
    isLayoutLoaded,
    // Any section exists at all (including hidden ones) — gates the Edit
    // button so it stays reachable even when the user has hidden every
    // section, unlike `visibleSections` which drops hidden sections.
    hasSections: laidOutGroups.length > 0,
    visibleSections,
    orderedMetricsPerGroup,
    layoutEditApi,
    bannerProps,
  };
}
