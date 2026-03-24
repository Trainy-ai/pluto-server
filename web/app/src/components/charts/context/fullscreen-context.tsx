"use client";

import { createContext, useContext, useState, useMemo, type ReactNode } from "react";

interface FullscreenContextValue {
  isFullscreen: boolean;
  setFullscreen: (value: boolean) => void;
}

const FullscreenContext = createContext<FullscreenContextValue>({
  isFullscreen: false,
  setFullscreen: () => {},
});

export function FullscreenProvider({ children }: { children: ReactNode }) {
  const [isFullscreen, setFullscreen] = useState(false);
  const value = useMemo(
    () => ({ isFullscreen, setFullscreen }),
    [isFullscreen],
  );
  return (
    <FullscreenContext.Provider value={value}>
      {children}
    </FullscreenContext.Provider>
  );
}

export function useFullscreenContext() {
  return useContext(FullscreenContext);
}
