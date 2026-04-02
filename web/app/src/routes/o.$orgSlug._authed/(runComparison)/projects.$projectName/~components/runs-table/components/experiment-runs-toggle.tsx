import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

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
        <TabsTrigger value="experiments" className="px-2.5 text-xs gap-1.5">
          Experiments
          <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 font-normal text-muted-foreground border-muted-foreground/30">
            Preview
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="runs" className="px-2.5 text-xs">
          Runs
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
