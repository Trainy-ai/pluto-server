import { useRef, useState, useEffect, type ReactNode } from "react";

interface VirtualizedGroupProps {
  /** Unique key for persisting measured height */
  groupId: string;
  /** Group title shown in the placeholder */
  groupTitle: string;
  /** Number of metrics in this group (used for height estimation) */
  metricCount: number;
  /** The full group content to render when near the viewport */
  children: ReactNode;
  /** IntersectionObserver rootMargin for mounting (default "600px") */
  loadMargin?: string;
  /** Distance beyond loadMargin before unmounting (default "1200px") */
  unloadMargin?: string;
}

// Module-level cache for measured group heights — survives re-renders and
// component unmount/remount cycles within the same session.
const heightCache = new Map<string, number>();

/**
 * Group-level virtualization wrapper.
 *
 * Only mounts the full chart group (children) when the placeholder is
 * within `loadMargin` of the viewport. Once mounted, the group stays
 * mounted until it scrolls beyond `unloadMargin` to avoid flicker during
 * small scroll adjustments.
 *
 * The placeholder preserves the group's measured height (or an estimate)
 * and displays the group title so scroll landmarks remain stable.
 */
export function VirtualizedGroup({
  groupId,
  groupTitle,
  metricCount,
  children,
  loadMargin = "600px",
  unloadMargin = "1200px",
}: VirtualizedGroupProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Start visible so charts render immediately on first paint.
  // IntersectionObserver takes over after mount — groups scrolled far
  // out of the unload zone will be switched to placeholder state.
  // This avoids a blank-screen race condition in headless browsers (CI)
  // where the observer fires before layout is computed.
  const [isVisible, setIsVisible] = useState(true);
  const measuredHeightRef = useRef<number>(heightCache.get(groupId) ?? 0);

  // Estimate height for groups that have never been measured.
  // DropdownRegion header ≈ 48px, each chart row ≈ 420px, 2 columns default.
  const estimatedHeight = 48 + Math.ceil(metricCount / 2) * 420;
  const placeholderHeight = measuredHeightRef.current || estimatedHeight;

  // IntersectionObserver with hysteresis: mount at loadMargin, unmount at unloadMargin.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Mount observer — triggers when element enters the load zone
    const mountObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        }
      },
      { rootMargin: loadMargin },
    );

    // Unmount observer — triggers when element leaves the larger unload zone
    const unmountObserver = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) {
          setIsVisible(false);
        }
      },
      { rootMargin: unloadMargin },
    );

    mountObserver.observe(el);
    unmountObserver.observe(el);

    return () => {
      mountObserver.disconnect();
      unmountObserver.disconnect();
    };
  }, [loadMargin, unloadMargin]);

  // Measure the actual height whenever visible content changes.
  useEffect(() => {
    if (!isVisible || !containerRef.current) return;

    const ro = new ResizeObserver(([entry]) => {
      const h = entry.contentRect.height;
      if (h > 0) {
        measuredHeightRef.current = h;
        heightCache.set(groupId, h);
      }
    });

    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [isVisible, groupId]);

  if (!isVisible) {
    return (
      <div
        ref={containerRef}
        data-testid="virtualized-group"
        data-state="placeholder"
        style={{ minHeight: placeholderHeight }}
        className="rounded-lg border border-border/50 bg-card/30"
      >
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground animate-pulse">
          <span className="font-medium">{groupTitle}</span>
          <span className="text-xs opacity-60">
            ({metricCount} metric{metricCount !== 1 ? "s" : ""})
          </span>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} data-testid="virtualized-group" data-state="mounted">
      {children}
    </div>
  );
}
