/**
 * Apply an alpha value to a CSS color string.
 *
 * Supports hex (#RRGGBB), rgb(), rgba(), hsl(), and hsla() formats.
 * For rgba()/hsla(), replaces the existing alpha.
 * Returns the color unchanged for unrecognized formats.
 */
export function applyAlpha(color: string, alpha: number): string {
  if (color.startsWith("#")) {
    let hex = color.slice(1);
    if (hex.length === 3) {
      hex = hex
        .split("")
        .map((char) => char + char)
        .join("");
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (color.startsWith("rgba(")) {
    // Replace existing alpha: rgba(r, g, b, oldAlpha) -> rgba(r, g, b, newAlpha)
    return color.replace(/,\s*[\d.]+\s*\)$/, `, ${alpha})`);
  }
  if (color.startsWith("rgb(")) {
    return color.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
  }
  if (color.startsWith("hsla(")) {
    return color.replace(/,\s*[\d.]+\s*\)$/, `, ${alpha})`);
  }
  if (color.startsWith("hsl(")) {
    return color.replace("hsl(", "hsla(").replace(")", `, ${alpha})`);
  }
  return color;
}
