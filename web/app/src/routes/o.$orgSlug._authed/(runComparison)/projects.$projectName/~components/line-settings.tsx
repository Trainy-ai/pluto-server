import { Button } from "@/components/ui/button";
import { SettingsIcon } from "lucide-react";
import React, { useState, useEffect } from "react";

import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  X,
  Check,
  ChevronDown,
  Info,
  ExternalLink,
  RotateCcw,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  useLineSettings,
  DEFAULT_SETTINGS,
} from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/use-line-settings";

interface LineSettingsProps {
  organizationId: string;
  projectName: string;
  logNames: string[];
}

const PREFERNCE_LOGS = ["epoch", "step", "time"];

const getLogNames = (logs: string[]) => {
  let data: string[] = ["Step", "Absolute Time", "Relative Time"];
  let secondaryLogs: string[] = [];
  // TODO allow support in charts
  for (const log of logs) {
    if (log.startsWith("sys/")) {
      continue;
    }

    if (PREFERNCE_LOGS.some((prefLog) => log.includes(prefLog))) {
      data.push(log);
    } else {
      secondaryLogs.push(log);
    }
  }
  return {
    primaryLogs: data,
    secondaryLogs,
  };
};

interface InfoTooltipProps {
  title: string;
  description: React.ReactNode;
  link?: {
    url: string;
    label: string;
  };
}

const InfoTooltip = ({ title, description, link }: InfoTooltipProps) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 rounded-full transition-colors hover:bg-muted/60"
      >
        <Info className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="sr-only">Info</span>
      </Button>
    </TooltipTrigger>
    <TooltipContent className="w-80 rounded-lg border-muted p-4 text-sm shadow-lg">
      <div className="flex flex-col space-y-2">
        <h4 className="font-semibold text-primary">{title}</h4>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
        {link && (
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 flex items-center gap-1 text-xs text-blue-500 transition-colors hover:text-blue-700 hover:underline"
          >
            {link.label}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </TooltipContent>
  </Tooltip>
);

const SettingsSection = ({
  title,
  children,
  description,
}: {
  title: string;
  children: React.ReactNode;
  description?: React.ReactNode;
}) => (
  <div className="space-y-4 rounded-lg bg-background transition-all">
    <div className="flex items-center gap-2">
      <h3 className="text-sm font-medium text-primary">{title}</h3>
    </div>
    {description && (
      <p className="-mt-2 text-xs text-muted-foreground">{description}</p>
    )}
    <div className="space-y-4 pl-1">{children}</div>
  </div>
);

const LineSettings = ({
  organizationId,
  projectName,
  logNames,
}: LineSettingsProps) => {
  //   const { data: runData, isLoading } = useGetRun(
  //     organizationId,
  //     projectName,
  //     runId,
  //   );

  const runData = {
    logs: [],
  };
  const isLoading = false;

  const {
    settings,
    updateSettings,
    updateSmoothingSettings,
    getSmoothingConfig,
    getSmoothingInfo,
    resetSettings,
  } = useLineSettings(organizationId, projectName, "full");

  const [open, setOpen] = useState(false);
  const [sliderValue, setSliderValue] = useState<number>(
    settings.smoothing.parameter,
  );
  const [currentAlgorithm, setCurrentAlgorithm] = useState<string>(
    settings.smoothing.algorithm,
  );

  // Keep sliderValue in sync with settings
  useEffect(() => {
    setSliderValue(settings.smoothing.parameter);
    setCurrentAlgorithm(settings.smoothing.algorithm);
  }, [settings.smoothing.parameter, settings.smoothing.algorithm]);

  // Handle local reset to update UI state
  const handleReset = () => {
    resetSettings();
    setSliderValue(DEFAULT_SETTINGS.smoothing.parameter);
    setCurrentAlgorithm(DEFAULT_SETTINGS.smoothing.algorithm);
  };

  // Handle algorithm change separately from settings
  const handleAlgorithmChange = (algorithm: string) => {
    console.log(
      `ALGORITHM CHANGE REQUEST: ${settings.smoothing.algorithm} -> ${algorithm}`,
    );

    // First update local state for immediate UI feedback
    setCurrentAlgorithm(algorithm);

    // Get default value for new algorithm
    let defaultValue = 0.6;
    if (algorithm === "gaussian") defaultValue = 2.0;
    else if (algorithm === "running") defaultValue = 10;
    else if (algorithm === "ema") defaultValue = 0.1;

    // Update local UI state immediately
    setSliderValue(defaultValue);

    // Update settings in a single batch to reduce race conditions
    // First update the full settings object directly
    updateSettings("smoothing", {
      ...settings.smoothing,
      algorithm: algorithm as any,
      parameter: defaultValue,
    });

    // For tracking/debugging
    console.log(
      `Updated algorithm to ${algorithm} with parameter ${defaultValue}`,
    );
  };

  if (isLoading) {
    return <Skeleton className="h-4 w-4" />;
  }

  const { primaryLogs, secondaryLogs } = getLogNames(logNames);

  const allLogs = [...primaryLogs, ...secondaryLogs];
  const config = getSmoothingConfig();
  const smoothingInfo = getSmoothingInfo();

  return (
    <div className="flex items-center gap-2">
      <Drawer
        direction="right"
        onDrag={(e) => e.preventDefault()}
        modal={false}
      >
        <DrawerTrigger asChild>
          <Button
            variant="outline"
            className="transition-all duration-200 hover:bg-muted/80"
          >
            <SettingsIcon className="h-4 w-4" />
          </Button>
        </DrawerTrigger>
        <DrawerContent className="h-full" data-vaul-no-drag>
          <DrawerHeader className="border-b pb-4">
            <div className="flex items-center justify-between">
              <DrawerTitle className="text-lg font-semibold">
                Line Chart Settings
              </DrawerTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  className="flex items-center gap-1 rounded-md text-xs"
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset
                </Button>
                <DrawerClose asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full transition-all duration-200 hover:bg-muted/80"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </DrawerClose>
              </div>
            </div>
          </DrawerHeader>
          <div className="space-y-8 overflow-y-auto p-6">
            <SettingsSection
              title="X Axis"
              description="Select the metric to display on the horizontal axis"
            >
              <div className="space-y-5">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label
                      htmlFor="x-axis-metric"
                      className="flex items-center gap-1.5 text-sm font-medium"
                    >
                      Metric
                      <InfoTooltip
                        title="X Axis Metric"
                        description="Select the metric to display on the X axis of the chart."
                      />
                    </Label>
                  </div>

                  <DropdownMenu open={open} onOpenChange={setOpen}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        id="x-axis-metric"
                        variant="outline"
                        className="h-9 w-full justify-between rounded-md border border-input text-sm font-normal transition-colors hover:bg-muted/50"
                      >
                        {settings.selectedLog}
                        <ChevronDown className="h-4 w-4 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      className="w-full min-w-[240px] overflow-hidden rounded-md border border-muted bg-popover p-0 text-popover-foreground shadow-lg data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
                      align="start"
                    >
                      <div className="max-h-[300px] overflow-auto py-1">
                        {primaryLogs.length > 0 && (
                          <DropdownMenuGroup>
                            <DropdownMenuLabel className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                              Recommended
                            </DropdownMenuLabel>
                            {primaryLogs.map((logName, index) => (
                              <DropdownMenuItem
                                key={index}
                                onClick={() =>
                                  updateSettings("selectedLog", logName)
                                }
                                className={cn(
                                  "cursor-pointer rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-muted focus:bg-muted",
                                  settings.selectedLog === logName &&
                                    "bg-muted font-medium text-primary",
                                )}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4 text-primary",
                                    settings.selectedLog === logName
                                      ? "opacity-100"
                                      : "opacity-0",
                                  )}
                                />
                                {logName}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuGroup>
                        )}

                        {secondaryLogs.length > 0 && (
                          <>
                            {primaryLogs.length > 0 && (
                              <DropdownMenuSeparator className="my-1 h-px bg-muted" />
                            )}
                            <DropdownMenuGroup>
                              <DropdownMenuLabel className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                                Other
                              </DropdownMenuLabel>
                              {secondaryLogs.map((logName, index) => (
                                <DropdownMenuItem
                                  key={index}
                                  onClick={() =>
                                    updateSettings("selectedLog", logName)
                                  }
                                  className={cn(
                                    "cursor-pointer rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-muted focus:bg-muted",
                                    settings.selectedLog === logName &&
                                      "bg-muted font-medium text-primary",
                                  )}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4 text-primary",
                                      settings.selectedLog === logName
                                        ? "opacity-100"
                                        : "opacity-0",
                                    )}
                                  />
                                  {logName}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuGroup>
                          </>
                        )}

                        {primaryLogs.length === 0 &&
                          secondaryLogs.length === 0 && (
                            <div className="px-3 py-2.5 text-center text-sm text-muted-foreground">
                              No logs available
                            </div>
                          )}
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Label
                      htmlFor="x-axis-log-scale"
                      className="flex cursor-pointer items-center gap-1.5 text-sm"
                    >
                      Logarithmic scale
                      <InfoTooltip
                        title="Logarithmic Scale"
                        description="Use logarithmic scaling on the X axis. This is useful when visualizing data that spans multiple orders of magnitude."
                        link={{
                          url: "https://en.wikipedia.org/wiki/Logarithmic_scale",
                          label: "Learn more about logarithmic scales",
                        }}
                      />
                    </Label>
                  </div>
                  <Switch
                    id="x-axis-log-scale"
                    checked={settings.xAxisLogScale}
                    onCheckedChange={(checked) =>
                      updateSettings("xAxisLogScale", checked)
                    }
                    className="transition-colors data-[state=checked]:bg-primary"
                  />
                </div>
              </div>
            </SettingsSection>

            <SettingsSection title="Y Axis">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Label
                    htmlFor="y-axis-log-scale"
                    className="flex cursor-pointer items-center gap-1.5 text-sm"
                  >
                    Logarithmic scale
                    <InfoTooltip
                      title="Logarithmic Scale"
                      description="Use logarithmic scaling on the Y axis. This is useful when visualizing data that spans multiple orders of magnitude."
                      link={{
                        url: "https://en.wikipedia.org/wiki/Logarithmic_scale",
                        label: "Learn more about logarithmic scales",
                      }}
                    />
                  </Label>
                </div>
                <Switch
                  id="y-axis-log-scale"
                  checked={settings.yAxisLogScale}
                  onCheckedChange={(checked) =>
                    updateSettings("yAxisLogScale", checked)
                  }
                  className="transition-colors data-[state=checked]:bg-primary"
                />
              </div>
            </SettingsSection>

            <Card
              className={cn(
                "rounded-lg border p-4 transition-all duration-200",
                settings.smoothing.enabled
                  ? "border-primary/20 bg-muted/5"
                  : "border-muted bg-background",
              )}
            >
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-primary">
                      Line Smoothing
                    </h3>
                    <InfoTooltip
                      title="Line Smoothing"
                      description="Apply smoothing algorithms to see trends in noisy data. Smoothing helps visualize the underlying pattern by reducing noise and fluctuations."
                    />
                    {settings.smoothing.enabled && (
                      <Badge
                        variant="secondary"
                        className="ml-2 text-xs font-normal"
                      >
                        {settings.smoothing.algorithm === "twema"
                          ? "TWEMA"
                          : settings.smoothing.algorithm === "gaussian"
                            ? "Gaussian"
                            : settings.smoothing.algorithm === "running"
                              ? "Running Avg"
                              : "EMA"}
                      </Badge>
                    )}
                  </div>
                  <Switch
                    id="enable-smoothing"
                    checked={settings.smoothing.enabled}
                    onCheckedChange={(checked) =>
                      updateSmoothingSettings("enabled", checked)
                    }
                    className="transition-colors data-[state=checked]:bg-primary"
                  />
                </div>

                {settings.smoothing.enabled && (
                  <div className="space-y-5 pl-1 duration-200 animate-in fade-in-50">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label
                          htmlFor="smoothing-algorithm"
                          className="flex items-center gap-1.5 text-sm"
                        >
                          Algorithm
                          <InfoTooltip
                            title={smoothingInfo.title}
                            description={smoothingInfo.description}
                            link={smoothingInfo.link}
                          />
                        </Label>
                      </div>
                      <Select
                        value={currentAlgorithm}
                        onValueChange={handleAlgorithmChange}
                      >
                        <SelectTrigger
                          id="smoothing-algorithm"
                          className="h-9 rounded-md border border-input text-sm"
                        >
                          <SelectValue placeholder="Select algorithm">
                            {currentAlgorithm === "twema"
                              ? "Time Weighted EMA "
                              : currentAlgorithm === "gaussian"
                                ? "Gaussian"
                                : currentAlgorithm === "running"
                                  ? "Running Average"
                                  : "Exponential Moving Average"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="rounded-md border border-input">
                          <SelectItem value="twema" className="text-sm">
                            Time Weighted EMA
                          </SelectItem>
                          <SelectItem value="gaussian" className="text-sm">
                            Gaussian
                          </SelectItem>
                          <SelectItem value="running" className="text-sm">
                            Running Average
                          </SelectItem>
                          <SelectItem value="ema" className="text-sm">
                            Exponential Moving Average
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Label
                            htmlFor="smoothing-parameter"
                            className="flex items-center gap-1.5 text-sm"
                          >
                            {settings.smoothing.algorithm === "running"
                              ? "Window Size"
                              : settings.smoothing.algorithm === "gaussian"
                                ? "Standard Deviation"
                                : "Weight"}
                            <InfoTooltip
                              title={smoothingInfo.paramTitle}
                              description={smoothingInfo.paramDescription}
                            />
                          </Label>
                        </div>
                        <span className="rounded bg-muted px-2 py-0.5 text-sm font-medium">
                          {sliderValue}
                        </span>
                      </div>
                      <div className="px-1">
                        <Slider
                          id="smoothing-parameter"
                          min={config.min}
                          max={config.max}
                          step={config.step}
                          value={[sliderValue]}
                          onValueChange={(values) => setSliderValue(values[0])}
                          onValueCommit={(values) =>
                            updateSmoothingSettings("parameter", values[0])
                          }
                          className="py-2"
                        />
                        <div className="mt-1 flex justify-between px-1 text-xs text-muted-foreground">
                          <span>{config.min}</span>
                          <span>{config.max}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-2">
                        <Label
                          htmlFor="show-original"
                          className="flex cursor-pointer items-center gap-1.5 text-sm"
                        >
                          Show original data
                          <InfoTooltip
                            title="Show Original Data"
                            description="Display the original unsmoothed data as a faint line in the background, allowing you to see both the raw data and the smoothed trend simultaneously."
                          />
                        </Label>
                      </div>
                      <Switch
                        id="show-original"
                        checked={settings.smoothing.showOriginalData}
                        onCheckedChange={(checked) =>
                          updateSmoothingSettings("showOriginalData", checked)
                        }
                        className="transition-colors data-[state=checked]:bg-primary"
                      />
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
};

export default LineSettings;
