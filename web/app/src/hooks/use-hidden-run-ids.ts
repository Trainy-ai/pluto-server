import { useState, useEffect } from "react";

/**
 * Module-level snapshot of the latest hidden run IDs.
 *
 * When a component using `useHiddenRunIds` is unmounted by VirtualizedChart
 * (scrolled out of viewport) and later remounted (scrolled back), the hook
 * would previously initialise with an empty Set and miss the last
 * `run-visibility-change` event.  By reading from this module-level variable
 * during `useState` initialisation, newly-mounted components immediately
 * reflect the current hidden state.
 */
let latestHiddenRunIds: Set<string> = new Set();

/**
 * Persistent global listener that keeps `latestHiddenRunIds` in sync even
 * when no React component with `useHiddenRunIds` is currently mounted.
 * This ensures that a component remounted later (e.g. by VirtualizedChart)
 * will read the correct value during its initial render.
 */
if (typeof document !== "undefined") {
  document.addEventListener("run-visibility-change", (e: Event) => {
    if (e instanceof CustomEvent && e.detail instanceof Set) {
      latestHiddenRunIds = e.detail;
    }
  });
}

/**
 * Subscribes to `run-visibility-change` DOM events (dispatched when users
 * toggle run visibility via the Eye icon) and returns the current set of
 * hidden run IDs.  This triggers a React re-render so media components
 * (images, video, audio, histograms) can filter out hidden runs.
 */
export function useHiddenRunIds(): Set<string> {
  const [hiddenRunIds, setHiddenRunIds] = useState<Set<string>>(
    () => latestHiddenRunIds,
  );

  useEffect(() => {
    // Sync with the latest value in case an event fired between the initial
    // render (which read the module variable) and this effect running.
    // Read directly from module variable to avoid adding hiddenRunIds as a dep.
    setHiddenRunIds(latestHiddenRunIds);

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
