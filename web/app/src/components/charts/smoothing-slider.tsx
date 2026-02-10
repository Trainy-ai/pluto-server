import { useState, useEffect } from "react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UseLineSettingsResult } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/use-line-settings";

interface SmoothingSliderProps {
  settings: UseLineSettingsResult["settings"];
  updateSmoothingSettings: UseLineSettingsResult["updateSmoothingSettings"];
  updateSettings: UseLineSettingsResult["updateSettings"];
  getSmoothingConfig: UseLineSettingsResult["getSmoothingConfig"];
}

const ALGORITHM_LABELS: Record<string, string> = {
  ema: "EMA",
  twema: "TWEMA",
  gaussian: "Gaussian",
  running: "Running Avg",
};

export function SmoothingSlider({
  settings,
  updateSmoothingSettings,
  updateSettings,
  getSmoothingConfig,
}: SmoothingSliderProps) {
  const [sliderValue, setSliderValue] = useState(settings.smoothing.parameter);
  const config = getSmoothingConfig();

  useEffect(() => {
    setSliderValue(settings.smoothing.parameter);
  }, [settings.smoothing.parameter]);

  const ALGORITHM_DEFAULTS: Record<string, number> = {
    ema: 0.6,
    twema: 0.6,
    gaussian: 2.0,
    running: 10,
  };

  const handleAlgorithmChange = (algorithm: string) => {
    const defaultValue = ALGORITHM_DEFAULTS[algorithm] ?? 0.6;

    setSliderValue(defaultValue);
    updateSettings("smoothing", {
      ...settings.smoothing,
      algorithm: algorithm as "ema" | "twema" | "gaussian" | "running",
      parameter: defaultValue,
    });
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5">
        <Switch
          id="toolbar-smoothing"
          checked={settings.smoothing.enabled}
          onCheckedChange={(checked) =>
            updateSmoothingSettings("enabled", checked)
          }
          className="h-4 w-7 data-[state=checked]:bg-primary [&_span]:h-3 [&_span]:w-3"
        />
        <Label
          htmlFor="toolbar-smoothing"
          className="cursor-pointer whitespace-nowrap text-xs text-muted-foreground"
        >
          Smoothing
        </Label>
      </div>
      <div className={`flex items-center gap-2 transition-opacity duration-200 ${settings.smoothing.enabled ? "opacity-100" : "pointer-events-none opacity-40"}`}>
        <Select
          value={settings.smoothing.algorithm}
          onValueChange={handleAlgorithmChange}
          disabled={!settings.smoothing.enabled}
        >
          <SelectTrigger className="h-6 w-auto gap-1 border-none bg-muted/50 px-2 text-xs shadow-none">
            <SelectValue>
              {ALGORITHM_LABELS[settings.smoothing.algorithm]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="min-w-0">
            <SelectItem value="ema" className="text-xs">
              EMA
            </SelectItem>
            <SelectItem value="twema" className="text-xs">
              TWEMA
            </SelectItem>
            <SelectItem value="gaussian" className="text-xs">
              Gaussian
            </SelectItem>
            <SelectItem value="running" className="text-xs">
              Running Avg
            </SelectItem>
          </SelectContent>
        </Select>
        <Slider
          min={config.min}
          max={config.max}
          step={config.step}
          value={[sliderValue]}
          onValueChange={(values) => setSliderValue(values[0])}
          onValueCommit={(values) =>
            updateSmoothingSettings("parameter", values[0])
          }
          disabled={!settings.smoothing.enabled}
          className="w-24"
        />
        <span className="min-w-[2.5rem] text-right font-mono text-xs text-muted-foreground">
          {sliderValue}
        </span>
      </div>
    </div>
  );
}
