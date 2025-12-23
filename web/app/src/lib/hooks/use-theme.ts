import { useTheme as useThemeContext } from "@/components/theme-provider";
import { useEffect, useState } from "react";

export type Theme = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

export interface UseThemeReturn {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

export function useTheme(): UseThemeReturn {
  const context = useThemeContext();
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(
    context.theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : (context.theme as ResolvedTheme),
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const updateResolvedTheme = () => {
      if (context.theme === "system") {
        setResolvedTheme(mediaQuery.matches ? "dark" : "light");
      } else {
        setResolvedTheme(context.theme as ResolvedTheme);
      }
    };

    mediaQuery.addEventListener("change", updateResolvedTheme);
    updateResolvedTheme(); // Initial check

    return () => mediaQuery.removeEventListener("change", updateResolvedTheme);
  }, [context.theme]);

  return {
    ...context,
    resolvedTheme,
  };
}

export default useTheme;
