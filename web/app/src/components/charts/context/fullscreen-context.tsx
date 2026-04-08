"use client";

import { createContext, useContext, useCallback, useRef, useMemo, type ReactNode } from "react";

/**
 * CSS class applied to the FullscreenProvider's wrapper div when fullscreen is active.
 * VirtualizedChart uses a pure CSS descendant selector to hide itself, avoiding
 * React re-renders of every chart when fullscreen toggles.
 */
export const FULLSCREEN_ACTIVE_CLASS = "fullscreen-active";

interface FullscreenContextValue {
  isFullscreen: boolean;
  setFullscreen: (value: boolean) => void;
}

const FullscreenContext = createContext<FullscreenContextValue>({
  isFullscreen: false,
  setFullscreen: () => {},
});

export function FullscreenProvider({ children }: { children: ReactNode }) {
  // Use a ref + DOM class toggle instead of React state to avoid re-rendering
  // every VirtualizedChart (dozens of them) when fullscreen opens/closes.
  const isFullscreenRef = useRef(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const setFullscreen = useCallback((value: boolean) => {
    isFullscreenRef.current = value;
    wrapperRef.current?.classList.toggle(FULLSCREEN_ACTIVE_CLASS, value);
  }, []);

  const value = useMemo(
    () => ({ isFullscreen: false, setFullscreen }),
    [setFullscreen],
  );

  return (
    <FullscreenContext.Provider value={value}>
      <div ref={wrapperRef} className="contents">
        {children}
      </div>
    </FullscreenContext.Provider>
  );
}

export function useFullscreenContext() {
  return useContext(FullscreenContext);
}
