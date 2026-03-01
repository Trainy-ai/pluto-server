import { ZapIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { VirtualizedChart } from "@/components/core/virtualized-chart";
import { useDynamicSectionWidgets } from "./use-dynamic-section";
import { WidgetRenderer } from "./widget-renderer";
import { ChartFullscreenDialog } from "@/components/charts/chart-fullscreen-dialog";
import { useState, useEffect, useMemo } from "react";
import type { Widget, ChartWidgetConfig } from "../../~types/dashboard-types";
import type { GroupedMetrics } from "@/lib/grouping/types";
import type { SelectedRunWithColor } from "../../~hooks/use-selected-runs";
import { searchUtils, type SearchState } from "../../~lib/search-utils";

interface DynamicSectionGridProps {
  sectionId: string;
  pattern: string;
  patternMode?: "search" | "regex";
  organizationId: string;
  projectName: string;
  selectedRunIds: string[];
  groupedMetrics: GroupedMetrics;
  selectedRuns: Record<string, SelectedRunWithColor>;
  searchState?: SearchState;
  onWidgetCountChange?: (count: number) => void;
}

export function DynamicSectionGrid({
  sectionId,
  pattern,
  patternMode,
  organizationId,
  projectName,
  selectedRunIds,
  groupedMetrics,
  selectedRuns,
  searchState,
  onWidgetCountChange,
}: DynamicSectionGridProps) {
  const { dynamicWidgets, isLoading } = useDynamicSectionWidgets(
    sectionId,
    pattern,
    patternMode ?? "search",
    organizationId,
    projectName,
    selectedRunIds,
  );

  const filteredWidgets = useMemo(() => {
    if (!searchState || !searchState.query.trim()) {
      return dynamicWidgets;
    }
    return dynamicWidgets.filter((widget) =>
      searchUtils.doesWidgetMatchSearch(widget, searchState)
    );
  }, [dynamicWidgets, searchState]);

  const [fullscreenWidget, setFullscreenWidget] = useState<Widget | null>(null);

  useEffect(() => {
    onWidgetCountChange?.(filteredWidgets.length);
  }, [filteredWidgets.length, onWidgetCountChange]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[300px] rounded-lg" />
        ))}
      </div>
    );
  }

  if (filteredWidgets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
        <p>
          {searchState?.query.trim()
            ? "No widgets match your search."
            : `No metrics or files match the pattern "${pattern}"`}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        {filteredWidgets.map((widget) => (
          <div
            key={widget.id}
            className="relative min-h-[300px] rounded-lg border bg-card p-2 cursor-pointer"
            onDoubleClick={() => setFullscreenWidget(widget)}
          >
            <div className="absolute top-1.5 left-1.5 z-10">
              <ZapIcon className="size-3 text-muted-foreground/50" />
            </div>
            <VirtualizedChart minHeight="100%" loadMargin="400px" unloadMargin="1200px">
              <WidgetRenderer
                widget={widget}
                groupedMetrics={groupedMetrics}
                selectedRuns={selectedRuns}
                organizationId={organizationId}
                projectName={projectName}
              />
            </VirtualizedChart>
          </div>
        ))}
      </div>

      {fullscreenWidget && (
        <ChartFullscreenDialog
          open={!!fullscreenWidget}
          onOpenChange={(open) => {
            if (!open) setFullscreenWidget(null);
          }}
          title={
            fullscreenWidget.config.title ||
            (fullscreenWidget.type === "chart"
              ? (fullscreenWidget.config as ChartWidgetConfig).metrics[0] || "Chart"
              : fullscreenWidget.type === "file-group"
                ? `${(fullscreenWidget.config as { files?: string[] }).files?.length ?? 0} files`
                : "Widget")
          }
        >
          <WidgetRenderer
            widget={fullscreenWidget}
            groupedMetrics={groupedMetrics}
            selectedRuns={selectedRuns}
            organizationId={organizationId}
            projectName={projectName}
          />
        </ChartFullscreenDialog>
      )}
    </>
  );
}
