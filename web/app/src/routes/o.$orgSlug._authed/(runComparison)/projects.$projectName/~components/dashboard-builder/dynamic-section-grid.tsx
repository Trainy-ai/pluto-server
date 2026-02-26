import { ZapIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { VirtualizedChart } from "@/components/core/virtualized-chart";
import { useDynamicSectionWidgets } from "./use-dynamic-section";
import { WidgetRenderer } from "./widget-renderer";
import { ChartFullscreenDialog } from "@/components/charts/chart-fullscreen-dialog";
import { useState, useEffect } from "react";
import type { Widget, ChartWidgetConfig } from "../../~types/dashboard-types";
import type { GroupedMetrics } from "@/lib/grouping/types";
import type { SelectedRunWithColor } from "../../~hooks/use-selected-runs";

interface DynamicSectionGridProps {
  sectionId: string;
  pattern: string;
  patternMode?: "search" | "regex";
  organizationId: string;
  projectName: string;
  selectedRunIds: string[];
  groupedMetrics: GroupedMetrics;
  selectedRuns: Record<string, SelectedRunWithColor>;
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

  const [fullscreenWidget, setFullscreenWidget] = useState<Widget | null>(null);

  useEffect(() => {
    onWidgetCountChange?.(dynamicWidgets.length);
  }, [dynamicWidgets.length, onWidgetCountChange]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[300px] rounded-lg" />
        ))}
      </div>
    );
  }

  if (dynamicWidgets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
        <p>No metrics or files match the pattern &quot;{pattern}&quot;</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        {dynamicWidgets.map((widget) => (
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
