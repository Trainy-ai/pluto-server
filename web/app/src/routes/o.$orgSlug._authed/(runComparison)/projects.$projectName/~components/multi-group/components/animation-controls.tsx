import React from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Settings,
  Camera,
  Film,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface AnimationControlsProps {
  currentStep: number;
  maxStep: number;
  isPlaying: boolean;
  animationSpeed: number;
  onPlayPause: () => void;
  onStepChange: (step: number) => void;
  onSpeedChange: (speed: number) => void;
  onExport: (type: "snapshot" | "gif") => void;
  isExporting: boolean;
}

export const AnimationControls: React.FC<AnimationControlsProps> = ({
  currentStep,
  maxStep,
  isPlaying,
  animationSpeed,
  onPlayPause,
  onStepChange,
  onSpeedChange,
  onExport,
  isExporting,
}) => {
  return (
    <div className="flex items-center gap-2">
      {/* Playback controls */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onStepChange(Math.max(0, currentStep - 1))}
          disabled={currentStep === 0}
        >
          <SkipBack className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onPlayPause}>
          {isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onStepChange(Math.min(maxStep, currentStep + 1))}
          disabled={currentStep === maxStep}
        >
          <SkipForward className="h-4 w-4" />
        </Button>
      </div>

      {/* Slider for step control */}
      <Slider
        className="w-32 flex-1"
        value={[currentStep]}
        min={0}
        max={maxStep}
        step={1}
        onValueChange={(value) => onStepChange(value[0])}
      />

      {/* Settings and export controls */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon">
            <Settings className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <div className="p-2">
            <div className="mb-2 text-sm font-medium">Animation Speed</div>
            <Slider
              className="my-4"
              value={[
                // Reverse the speed for UI control if necessary;
                // Adjust the calculation depending on your speed range logic.
                1000 - animationSpeed + 1,
              ]}
              min={1}
              max={1000}
              step={10}
              onValueChange={(value) => onSpeedChange(1000 - value[0] + 1)}
            />
          </div>
          <DropdownMenuItem onClick={() => onExport("snapshot")}>
            <Camera className="mr-2 h-4 w-4" />
            Export Snapshot
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onExport("gif")}>
            <Film className="mr-2 h-4 w-4" />
            Export Animation
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
