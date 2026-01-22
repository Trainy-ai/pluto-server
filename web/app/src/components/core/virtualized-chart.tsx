"use client";

import { useRef, useState, useEffect, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

interface VirtualizedChartProps {
  children: ReactNode;
  className?: string;
  /**
   * Root margin for loading. Charts load when this close to viewport.
   * Default: 200px (pre-load slightly before visible)
   */
  loadMargin?: string;
  /**
   * Root margin for unloading. Charts unmount when this far from viewport.
   * Default: 800px (keep mounted while close to viewport)
   */
  unloadMargin?: string;
  /**
   * Minimum height for the placeholder skeleton.
   * Ensures consistent layout before the chart loads.
   */
  minHeight?: string;
}

/**
 * Virtualized chart wrapper that mounts/unmounts based on viewport distance.
 *
 * This component improves memory usage when displaying many charts by:
 * - Lazy loading charts when they approach the viewport (loadMargin)
 * - Unmounting charts when scrolled far away (unloadMargin)
 *
 * Charts remount quickly on scroll back due to frontend Dexie cache.
 *
 * Uses two IntersectionObservers:
 * 1. Load observer: triggers mount when chart is within loadMargin of viewport
 * 2. Unload observer: triggers unmount when chart is beyond unloadMargin from viewport
 */
export function VirtualizedChart({
  children,
  className = "h-full w-full",
  loadMargin = "200px",
  unloadMargin = "800px",
  minHeight = "384px",
}: VirtualizedChartProps) {
  const [isMounted, setIsMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Fallback for browsers without IntersectionObserver
    if (!("IntersectionObserver" in window)) {
      setIsMounted(true);
      return;
    }

    // Load observer: mount when within loadMargin of viewport
    const loadObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsMounted(true);
        }
      },
      { rootMargin: loadMargin }
    );

    // Unload observer: unmount when beyond unloadMargin from viewport
    // Uses negative margin to create a larger "viewport" for the check
    const unloadObserver = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) {
          setIsMounted(false);
        }
      },
      { rootMargin: unloadMargin }
    );

    loadObserver.observe(element);
    unloadObserver.observe(element);

    return () => {
      loadObserver.disconnect();
      unloadObserver.disconnect();
    };
  }, [loadMargin, unloadMargin]);

  return (
    <div
      ref={ref}
      className={`flex flex-1 flex-col ${className}`}
      style={{ minHeight, position: "relative" }}
    >
      {isMounted ? children : <Skeleton className="h-full w-full" />}
    </div>
  );
}
