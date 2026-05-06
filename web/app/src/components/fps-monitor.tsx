import { useEffect, useState } from "react";

import { useFpsMonitorEnabled } from "@/lib/hooks/use-fps-monitor-enabled";
import { cn } from "@/lib/utils";

export function FpsMonitor() {
  const { enabled } = useFpsMonitorEnabled();
  const [fps, setFps] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    let frames = 0;
    let windowStart = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      frames++;
      if (now - windowStart >= 1000) {
        setFps(frames);
        frames = 0;
        windowStart = now;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);

  if (!enabled) return null;

  const color =
    fps >= 55
      ? "text-green-400"
      : fps >= 30
        ? "text-yellow-400"
        : "text-red-400";

  return (
    <div
      className={cn(
        "fixed bottom-2 left-2 z-[9999] rounded bg-black/70 px-2 py-1",
        "pointer-events-none select-none font-mono text-xs tabular-nums",
      )}
    >
      <span className={color}>{fps} fps</span>
    </div>
  );
}
