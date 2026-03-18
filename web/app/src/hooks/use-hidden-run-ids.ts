import { useState, useEffect } from "react";

/**
 * Subscribes to `run-visibility-change` DOM events (dispatched when users
 * toggle run visibility via the Eye icon) and returns the current set of
 * hidden run IDs.  This triggers a React re-render so media components
 * (images, video, audio, histograms) can filter out hidden runs.
 */
export function useHiddenRunIds(): Set<string> {
  const [hiddenRunIds, setHiddenRunIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    function handler(e: Event) {
      if (e instanceof CustomEvent && e.detail instanceof Set) {
        setHiddenRunIds(e.detail);
      }
    }
    document.addEventListener("run-visibility-change", handler);
    return () => document.removeEventListener("run-visibility-change", handler);
  }, []);

  return hiddenRunIds;
}
