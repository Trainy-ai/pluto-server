import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/hooks/use-theme";
import type { PlotlyFigure } from "@/lib/media-json";

interface PlotlyViewProps {
  figure: PlotlyFigure;
  className?: string;
}

/**
 * A Plotly figure — and therefore also a matplotlib one.
 *
 * wandb converts an mpl figure to a Plotly figure at log time and stores both
 * as `*.plotly.json`, so a single viewer covers both. Before this they landed
 * in Pluto as raw JSON text; an earlier attempt to render mpl as an `<img>` was
 * wrong, because a migrated mpl figure is not a raster at all.
 *
 * `plotly.js` is ~3.5MB, so it is imported dynamically — a project with no
 * Plotly files never pays for it.
 */
export function PlotlyView({ figure, className }: PlotlyViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    let disposed = false;
    const host = hostRef.current;
    if (!host) return;

    // Clear any prior failure so a later figure/theme change can retry. The
    // host div must stay mounted (see return) — swapping it out for an error
    // message used to leave hostRef null and freeze the error forever.
    setError(null);

    (async () => {
      try {
        const Plotly = (await import("plotly.js-dist-min")).default;
        if (disposed || !hostRef.current) return;

        const dark = resolvedTheme === "dark";
        const axis = {
          gridcolor: dark ? "rgba(148,163,184,0.15)" : "rgba(71,85,105,0.15)",
          zerolinecolor: dark ? "rgba(148,163,184,0.3)" : "rgba(71,85,105,0.3)",
          color: dark ? "#94a3b8" : "#475569",
        };

        // A converted matplotlib figure carries mpl's own pixel size (640x480
        // by default). Plotly honours an explicit width/height over `autosize`,
        // so the figure kept that size and overflowed a small widget, showing
        // only its top-left corner. Drop them and let the container decide.
        const layout = structuredClone(figure.layout ?? {});
        delete layout.width;
        delete layout.height;

        await Plotly.newPlot(
          hostRef.current,
          // Plotly mutates the arrays it is handed; the figure comes from a
          // cached query result, so hand it a copy rather than let it write
          // back into the cache.
          structuredClone(figure.data) as never,
          {
            ...layout,
            // Theme the chrome, but leave the traces' own colours alone —
            // those are the author's choice and carry meaning.
            paper_bgcolor: "transparent",
            plot_bgcolor: "transparent",
            font: { color: dark ? "#94a3b8" : "#475569", size: 11 },
            xaxis: { ...(figure.layout?.xaxis as object), ...axis },
            yaxis: { ...(figure.layout?.yaxis as object), ...axis },
            margin: { l: 48, r: 16, t: 32, b: 40 },
            autosize: true,
          } as never,
          { responsive: true, displaylogo: false } as never,
        );
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      disposed = true;
      // Plotly attaches listeners and a WebGL context per plot; without purge
      // a scrolled-past figure leaks both.
      void import("plotly.js-dist-min")
        .then(({ default: P }) => host && P.purge(host))
        .catch(() => {});
    };
  }, [figure, resolvedTheme]);

  // Keep the host mounted under an error overlay so a subsequent effect can
  // still find it and clear the failure.
  return (
    <div className={cn("relative h-full w-full", className)}>
      {error ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-4 text-center text-xs text-destructive">
          Could not render figure: {error}
        </div>
      ) : null}
      <div
        ref={hostRef}
        data-testid="plotly-view"
        className={cn("h-full w-full", error && "invisible")}
      />
    </div>
  );
}
