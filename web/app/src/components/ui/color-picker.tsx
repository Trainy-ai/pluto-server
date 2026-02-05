import * as React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Button } from "./button";
import { cn } from "@/lib/utils";
import { useTheme, type ResolvedTheme } from "@/lib/hooks/use-theme";

interface ColorPickerProps {
  color?: string;
  defaultColor?: string;
  onChange: (color: string) => void;
  className?: string;
}

// Dark mode palette: Bright, saturated colors that pop against dark backgrounds
// Optimized for visibility and accessibility on dark (#1a1a1a) backgrounds
export const COLORS_DARK = [
  // Primary bright colors - high visibility
  "#22D3EE", // Cyan
  "#4ADE80", // Green
  "#FB923C", // Orange
  "#F472B6", // Pink
  "#A78BFA", // Purple
  "#60A5FA", // Blue
  "#FBBF24", // Amber
  "#34D399", // Emerald
  // Secondary bright colors
  "#F87171", // Red
  "#38BDF8", // Sky
  "#C084FC", // Violet
  "#2DD4BF", // Teal
  "#FB7185", // Rose
  "#818CF8", // Indigo
  "#A3E635", // Lime
  "#E879F9", // Fuchsia
  // Tertiary colors - slightly muted but still visible
  "#67E8F9", // Lighter cyan
  "#86EFAC", // Lighter green
  "#FDBA74", // Lighter orange
  "#F9A8D4", // Lighter pink
  "#C4B5FD", // Lighter purple
  "#93C5FD", // Lighter blue
  "#FCD34D", // Lighter amber
  "#6EE7B7", // Lighter emerald
];

// Light mode palette: Medium-dark saturated colors that stand out against light backgrounds
// Optimized for visibility and accessibility on light (#ffffff) backgrounds
export const COLORS_LIGHT = [
  // Primary colors - strong contrast on white
  "#0891B2", // Cyan-600
  "#16A34A", // Green-600
  "#EA580C", // Orange-600
  "#DB2777", // Pink-600
  "#7C3AED", // Violet-600
  "#2563EB", // Blue-600
  "#D97706", // Amber-600
  "#059669", // Emerald-600
  // Secondary colors
  "#DC2626", // Red-600
  "#0284C7", // Sky-600
  "#9333EA", // Purple-600
  "#0D9488", // Teal-600
  "#E11D48", // Rose-600
  "#4F46E5", // Indigo-600
  "#65A30D", // Lime-600
  "#C026D3", // Fuchsia-600
  // Tertiary colors - slightly lighter but still high contrast
  "#0E7490", // Cyan-700
  "#15803D", // Green-700
  "#C2410C", // Orange-700
  "#BE185D", // Pink-700
  "#6D28D9", // Violet-700
  "#1D4ED8", // Blue-700
  "#B45309", // Amber-700
  "#047857", // Emerald-700
];

// Default export for backwards compatibility - uses dark mode colors
export const COLORS = COLORS_DARK;

// Get colors based on resolved theme
export function getChartColors(theme: ResolvedTheme): string[] {
  return theme === "dark" ? COLORS_DARK : COLORS_LIGHT;
}

// Hook to get theme-aware colors
export function useChartColors(): string[] {
  const { resolvedTheme } = useTheme();
  return React.useMemo(() => getChartColors(resolvedTheme), [resolvedTheme]);
}

export function ColorPicker({
  color,
  defaultColor,
  onChange,
  className,
}: ColorPickerProps) {
  const colors = useChartColors();
  const currentColor = color ?? defaultColor ?? colors[0];
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
        <div className="grid grid-cols-6 gap-1">
          {colors.map((colorValue) => (
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
