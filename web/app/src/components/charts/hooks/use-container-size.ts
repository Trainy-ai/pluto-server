import { useRef, useEffect, useState, type RefObject } from "react";

const RESIZE_THROTTLE_MS = 200;

export function useContainerSize(ref: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const lastUpdateRef = useRef<number>(0);
  const pendingUpdateRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!ref?.current) return;

    const element = ref.current;
    const measureElement = () => {
      const rect = element.getBoundingClientRect();
      const computedStyle = getComputedStyle(element);
      const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
      const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
      const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
      const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;
      const width = rect.width - paddingLeft - paddingRight;
      const height = rect.height - paddingTop - paddingBottom;
      return { width, height };
    };

    const { width: initialWidth, height: initialHeight } = measureElement();
    if (initialWidth > 0 && initialHeight > 0) {
      setSize({ width: initialWidth, height: initialHeight });
    } else {
      requestAnimationFrame(() => {
        const { width, height } = measureElement();
        if (width > 0 && height > 0) {
          setSize({ width, height });
        }
      });
    }

    const observer = new ResizeObserver((entries) => {
      const now = Date.now();
      const entry = entries[0];
      if (!entry) return;

      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) return;

      if (now - lastUpdateRef.current >= RESIZE_THROTTLE_MS) {
        lastUpdateRef.current = now;
        setSize({ width, height });
      } else {
        if (pendingUpdateRef.current) {
          clearTimeout(pendingUpdateRef.current);
        }
        pendingUpdateRef.current = setTimeout(() => {
          lastUpdateRef.current = Date.now();
          setSize({ width, height });
          pendingUpdateRef.current = null;
        }, RESIZE_THROTTLE_MS - (now - lastUpdateRef.current));
      }
    });

    observer.observe(element);
    return () => {
      observer.disconnect();
      if (pendingUpdateRef.current) {
        clearTimeout(pendingUpdateRef.current);
      }
    };
  }, [ref]);

  return size;
}
