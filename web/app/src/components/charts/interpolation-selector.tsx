import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { TooltipInterpolation } from "@/lib/math/interpolation";

interface InterpolationSelectorProps {
  value: TooltipInterpolation;
  onChange: (value: TooltipInterpolation) => void;
}

const INTERPOLATION_LABELS: Record<TooltipInterpolation, string> = {
  none: "None",
  linear: "Linear",
  last: "Last Value",
};

export function InterpolationSelector({
  value,
  onChange,
}: InterpolationSelectorProps) {
  return (
    <div className="flex items-center gap-1.5">
      <Label className="whitespace-nowrap text-xs text-muted-foreground">
        Interpolation
      </Label>
      <Select
        value={value}
        onValueChange={(v) => onChange(v as TooltipInterpolation)}
      >
        <SelectTrigger className="h-6 w-auto gap-1 border-none bg-muted/50 px-2 text-xs shadow-none">
          <SelectValue>{INTERPOLATION_LABELS[value]}</SelectValue>
        </SelectTrigger>
        <SelectContent className="min-w-0">
          {(Object.keys(INTERPOLATION_LABELS) as TooltipInterpolation[]).map(
            (key) => (
              <SelectItem key={key} value={key} className="text-xs">
                {INTERPOLATION_LABELS[key]}
              </SelectItem>
            ),
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
