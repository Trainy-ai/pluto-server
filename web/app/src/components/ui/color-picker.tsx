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

export type PaletteType = "categorical" | "vivid";

const PALETTE_STORAGE_KEY = "mlop:palette-type";

// Kelly's Maximum Contrast palette (light mode) — 24 colors for white/light backgrounds
// Medium-dark saturated colors with strong contrast on light surfaces
export const COLORS_KELLY = [
  "#FFB300", // Vivid Yellow
  "#803E75", // Strong Purple
  "#FF6800", // Vivid Orange
  "#00538A", // Strong Blue
  "#C10020", // Vivid Red
  "#007D34", // Vivid Green
  "#53377A", // Strong Violet
  "#FF7A5C", // Strong Yellowish Pink
  "#F4C800", // Vivid Greenish Yellow
  "#B32851", // Strong Purplish Red
  "#93AA00", // Vivid Yellowish Green
  "#F6768E", // Strong Purplish Pink
  "#00827F", // Vivid Bluish Green
  "#FF8E00", // Deep Yellowish Pink / Vivid Orange Yellow
  "#7F180D", // Strong Reddish Brown
  "#A6BDD7", // Very Light Blue
  "#CEA262", // Grayish Yellow
  "#817066", // Medium Gray
  "#0AA3F7", // Brilliant Blue
  "#E83000", // Vivid Red Orange
  "#6DB33F", // Brilliant Green
  "#9B59B6", // Moderate Violet
  "#F39C12", // Deep Yellow
  "#2C4A6E", // Dark Blue
];

// Kelly's Maximum Contrast palette (dark mode) — same hue order, brightened for dark backgrounds
// Colors that were too dark (#803E75, #00538A, #53377A, #7F180D, #817066, #2C4A6E)
// are shifted lighter/more saturated so they pop against #1a1a1a
export const COLORS_KELLY_DARK = [
  "#FFB300", // Vivid Yellow (already bright)
  "#C77DBF", // Strong Purple → brightened
  "#FF6800", // Vivid Orange (already bright)
  "#4DA6FF", // Strong Blue → brightened
  "#FF3347", // Vivid Red → brightened
  "#00C853", // Vivid Green → brightened
  "#9C6FD0", // Strong Violet → brightened
  "#FF7A5C", // Strong Yellowish Pink (already bright)
  "#F4C800", // Vivid Greenish Yellow (already bright)
  "#FF4081", // Strong Purplish Red → brightened
  "#C6FF00", // Vivid Yellowish Green → brightened
  "#F6768E", // Strong Purplish Pink (already bright)
  "#26C6DA", // Vivid Bluish Green → brightened
  "#FF8E00", // Vivid Orange Yellow (already bright)
  "#FF6E40", // Strong Reddish Brown → brightened
  "#A6BDD7", // Very Light Blue (already bright)
  "#CEA262", // Grayish Yellow (already bright)
  "#BCAAA4", // Medium Gray → brightened
  "#0AA3F7", // Brilliant Blue (already bright)
  "#FF5722", // Vivid Red Orange → brightened
  "#8BC34A", // Brilliant Green → brightened
  "#CE93D8", // Moderate Violet → brightened
  "#F39C12", // Deep Yellow (already bright)
  "#64B5F6", // Dark Blue → brightened
];

// Dark mode palette: Bright, saturated colors that pop against dark backgrounds
// Optimized for visibility and accessibility on dark (#1a1a1a) backgrounds
// Each row uses maximally distinct hues to avoid confusion between runs
export const COLORS_DARK = [
  // Row 1 - Primary bright colors
  "#22D3EE", // Cyan
  "#4ADE80", // Green
  "#FB923C", // Orange
  "#F472B6", // Pink
  "#A78BFA", // Purple
  "#60A5FA", // Blue
  "#FBBF24", // Amber
  "#34D399", // Emerald
  // Row 2 - Secondary bright colors
  "#F87171", // Red
  "#38BDF8", // Sky
  "#C084FC", // Violet
  "#2DD4BF", // Teal
  "#FB7185", // Rose
  "#818CF8", // Indigo
  "#A3E635", // Lime
  "#E879F9", // Fuchsia
  // Row 3 - Distinct additional hues (NOT lighter/darker variants of rows 1-2)
  "#FF6B6B", // Coral
  "#FFD93D", // Gold
  "#6BCB77", // Jade
  "#4D96FF", // Cornflower
  "#FF6EC7", // Hot pink
  "#45B7D1", // Steel cyan
  "#B4FF9F", // Chartreuse
  "#D4A5FF", // Lavender
];

// Light mode palette: Medium-dark saturated colors that stand out against light backgrounds
// Optimized for visibility and accessibility on light (#ffffff) backgrounds
// Each row uses maximally distinct hues to avoid confusion between runs
export const COLORS_LIGHT = [
  // Row 1 - Primary colors - strong contrast on white
  "#0891B2", // Cyan-600
  "#16A34A", // Green-600
  "#EA580C", // Orange-600
  "#DB2777", // Pink-600
  "#7C3AED", // Violet-600
  "#2563EB", // Blue-600
  "#D97706", // Amber-600
  "#059669", // Emerald-600
  // Row 2 - Secondary colors
  "#DC2626", // Red-600
  "#0284C7", // Sky-600
  "#9333EA", // Purple-600
  "#0D9488", // Teal-600
  "#E11D48", // Rose-600
  "#4F46E5", // Indigo-600
  "#65A30D", // Lime-600
  "#C026D3", // Fuchsia-600
  // Row 3 - Distinct additional hues (NOT lighter/darker variants of rows 1-2)
  "#92400E", // Brown/Sienna
  "#A16207", // Dark gold
  "#166534", // Forest green
  "#1E3A5F", // Navy
  "#9D174D", // Wine/Burgundy
  "#374151", // Slate
  "#4D7C0F", // Olive
  "#6B21A8", // Grape
];

// Default export for backwards compatibility - uses Kelly dark colors
export const COLORS = COLORS_KELLY_DARK;

function getStoredPaletteType(): PaletteType {
  try {
    const stored = localStorage.getItem(PALETTE_STORAGE_KEY);
    if (stored === "categorical" || stored === "vivid") return stored;
  } catch {}
  return "categorical";
}

function setStoredPaletteType(type: PaletteType) {
  try {
    localStorage.setItem(PALETTE_STORAGE_KEY, type);
  } catch {}
}

// Get colors based on resolved theme and palette type
export function getChartColors(
  theme: ResolvedTheme,
  paletteType?: PaletteType,
): string[] {
  const type = paletteType ?? getStoredPaletteType();
  if (type === "categorical") {
    return theme === "dark" ? COLORS_KELLY_DARK : COLORS_KELLY;
  }
  return theme === "dark" ? COLORS_DARK : COLORS_LIGHT;
}

// Hook to get theme-aware colors (respects palette preference)
export function useChartColors(): string[] {
  const { resolvedTheme } = useTheme();
  const [paletteType, setPaletteType] = React.useState<PaletteType>(
    getStoredPaletteType,
  );

  React.useEffect(() => {
    function onPaletteChange() {
      setPaletteType(getStoredPaletteType());
    }
    window.addEventListener("mlop:palette-change", onPaletteChange);
    return () =>
      window.removeEventListener("mlop:palette-change", onPaletteChange);
  }, []);

  return React.useMemo(
    () => getChartColors(resolvedTheme, paletteType),
    [resolvedTheme, paletteType],
  );
}

// Hook for palette type preference
export function usePaletteType(): [
  PaletteType,
  (type: PaletteType) => void,
] {
  const [paletteType, setPaletteType] = React.useState<PaletteType>(
    getStoredPaletteType,
  );

  const setType = React.useCallback((type: PaletteType) => {
    setStoredPaletteType(type);
    setPaletteType(type);
    window.dispatchEvent(new CustomEvent("mlop:palette-change"));
  }, []);

  return [paletteType, setType];
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
