import * as React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Button } from "./button";
import { cn } from "@/lib/utils";

interface ColorPickerProps {
  color?: string;
  defaultColor?: string;
  onChange: (color: string) => void;
  className?: string;
}

export const COLORS = [
  // Reds
  "#FF6B6B",
  "#FF8787",
  "#FFA8A8",
  "#FFB8B8",
  "#FF4D4D",
  "#FF3333",
  "#FF1A1A",
  "#FF0000",
  // Oranges
  "#FFA94D",
  "#FFC078",
  "#FFD8A8",
  "#FFE3BF",
  "#FF922B",
  "#FF7600",
  "#FF5E00",
  "#FF4500",
  // Yellows
  "#FFD43B",
  "#FFE066",
  "#FFEC99",
  "#FFF3BF",
  "#FCC419",
  "#FAB005",
  "#F59F00",
  "#F08C00",
  // Greens
  "#51CF66",
  "#69DB7C",
  "#8CE99A",
  "#B2F2BB",
  "#40C057",
  "#37B24D",
  "#2F9E44",
  "#2B8A3E",
  // Teals
  "#20C997",
  "#38D9A9",
  "#63E6BE",
  "#96F2D7",
  "#12B886",
  "#0CA678",
  "#099268",
  "#087F5B",
  // Cyans
  "#22B8CF",
  "#3BC9DB",
  "#66D9E8",
  "#99E9F2",
  "#15AABF",
  "#1098AD",
  "#0C8599",
  "#0B7285",
  // Blues
  "#339AF0",
  "#4DABF7",
  "#74C0FC",
  "#A5D8FF",
  "#228BE6",
  "#1C7ED6",
  "#1971C2",
  "#1864AB",
  // Indigos
  "#5C7CFA",
  "#748FFC",
  "#91A7FF",
  "#BAC8FF",
  "#4C6EF5",
  "#4263EB",
  "#3B5BDB",
  "#364FC7",
  // Violets
  "#7950F2",
  "#845EF7",
  "#9775FA",
  "#B197FC",
  "#6741D9",
  "#5F3DC4",
  "#5235AB",
  "#482595",
  // Magentas
  "#E64980",
  "#F783AC",
  "#FDA7C6",
  "#FCC2D7",
  "#D6336C",
  "#C2255C",
  "#A61E4D",
  "#9C1A45",
  // Grays
  "#868E96",
  "#ADB5BD",
  "#CED4DA",
  "#DEE2E6",
  "#495057",
  "#343A40",
  "#212529",
  "#1A1C1E",
];

export function ColorPicker({
  color,
  defaultColor = COLORS[0],
  onChange,
  className,
}: ColorPickerProps) {
  const currentColor = color ?? defaultColor;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-8 w-8 p-0 transition-colors hover:bg-accent/50",
            className,
          )}
        >
          <div
            className="h-5 w-5 rounded-full shadow-sm ring-1 ring-border transition-all duration-200 hover:ring-[1.5px] hover:ring-primary/60"
            style={{ backgroundColor: currentColor }}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-3" sideOffset={4}>
        <div className="grid grid-cols-8 gap-1">
          {COLORS.map((colorValue) => (
            <button
              key={colorValue}
              className={cn(
                "h-8 w-8 rounded-md transition-all hover:scale-110 hover:shadow-md",
                currentColor === colorValue &&
                  "scale-110 shadow-md ring-2 ring-ring",
              )}
              style={{ backgroundColor: colorValue }}
              onClick={() => onChange(colorValue)}
              aria-label={`Color: ${colorValue}`}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
