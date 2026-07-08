import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipTrigger,
  UnstyledTooltipContent,
  DocsTooltip,
} from "@/components/ui/tooltip";
import { InfoIcon } from "lucide-react";

export type ListMode = "experiments" | "runs";

interface ExperimentRunsToggleProps {
  mode: ListMode;
  onChange: (mode: ListMode) => void;
}

export function ExperimentRunsToggle({
  mode,
  onChange,
}: ExperimentRunsToggleProps) {
  return (
    <Tabs
      value={mode}
      onValueChange={(v) => onChange(v as ListMode)}
    >
      <TabsList className="h-8">
        <TabsTrigger value="experiments" className="px-2.5 text-xs">
          {/* The tooltip lives INSIDE the trigger: `TooltipTrigger asChild`
              overrides its child's data-state, so wrapping the TabsTrigger
              directly clobbered `data-[state=active]` and the tab never showed
              as selected when clicked. Wrapping the inner span keeps the tab's
              own active state intact while still surfacing the tooltip. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1.5">
                Experiments
                <Badge
                  variant="outline"
                  className="text-[10px] px-1 py-0 h-4 font-normal text-muted-foreground border-muted-foreground/30"
                >
                  Preview
                </Badge>
              </span>
            </TooltipTrigger>
            <UnstyledTooltipContent
              sideOffset={8}
              side="bottom"
              align="center"
              showArrow={false}
            >
              <DocsTooltip
                title="Experiments"
                iconComponent={<InfoIcon className="size-4" />}
                description="Group related runs into experiments to track forked and resumed runs as a single lineage. Hover a row to highlight its runs across charts."
                link="https://docs.trainy.ai/pluto/forking"
              />
            </UnstyledTooltipContent>
          </Tooltip>
        </TabsTrigger>
        <TabsTrigger value="runs" className="px-2.5 text-xs">
          Runs
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
