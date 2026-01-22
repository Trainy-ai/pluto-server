"use client";

import { useRef, useState, useEffect, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

interface LazyChartProps {
  children: ReactNode;
  className?: string;
  rootMargin?: string;
  /**
   * Minimum height for the placeholder skeleton.
   * Ensures consistent layout before the chart loads.
   */
  minHeight?: string;
}

/**
 * Lazy loading wrapper for charts using Intersection Observer.
 * Only renders children when the component enters the viewport.
 * Shows a skeleton placeholder until visible.
 */
export function LazyChart({
  children,
  className = "h-full w-full",
  rootMargin = "200px", // Pre-load charts 200px before they enter viewport
  minHeight = "384px",
}: LazyChartProps) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Check if IntersectionObserver is available (should be in all modern browsers)
    if (!("IntersectionObserver" in window)) {
      // Fallback: render immediately if IntersectionObserver is not available
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect(); // Once visible, no need to observe anymore
        }
      },
      { rootMargin }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin]);

  return (
    <div
      ref={ref}
      className={`flex flex-1 flex-col ${className}`}
      style={{ minHeight, position: "relative" }}
    >
      {isVisible ? children : <Skeleton className="h-full w-full" />}
    </div>
  );
}
