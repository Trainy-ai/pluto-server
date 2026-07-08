import { useState, useEffect } from "react";

/** Module-level snapshot of the latest hidden GROUP pathKeys (the
 *  JSON-stringified `[{field, value}, ...]` trail used as a bucket
 *  key). Same pattern as `useHiddenRunIds` — a remounted bucket row
 *  (e.g. after scrolling the runs-table in/out of view) initialises
 *  with the current value rather than an empty Set. */
let latestHiddenGroupPaths: Set<string> = new Set();
/** Which project `latestHiddenGroupPaths` belongs to. The snapshot is global
 *  (module-level), but hidden-group path-keys — e.g. `group:a` — collide across
 *  projects, so we clear it when the active project changes (see the hook). */
let ownerProject: string | undefined;

if (typeof document !== "undefined") {
  document.addEventListener("group-visibility-change", (e: Event) => {
    if (e instanceof CustomEvent && e.detail instanceof Set) {
      latestHiddenGroupPaths = e.detail;
    }
  });
}

/** Subscribes to `group-visibility-change` events (dispatched when the
 *  user clicks the eye icon on a bucket header row) and returns the
 *  current hidden-paths set. The grouped chart query reads this and
 *  passes it as `hiddenGroupPaths` so the backend drops any run whose
 *  leaf pathKey is *prefixed* by a hidden trail — hiding a parent
 *  bucket cascades to every descendant. */
export function useHiddenGroupPaths(projectName?: string): Set<string> {
  const [hiddenGroupPaths, setHiddenGroupPaths] = useState<Set<string>>(() =>
    // Don't leak another project's hidden paths on the first render: the
    // module-global snapshot may still belong to the previous project until
    // the effect below resets it (e.g. on client-side project navigation).
    // Seed empty when the snapshot isn't ours yet.
    projectName !== undefined && projectName !== ownerProject
      ? new Set()
      : latestHiddenGroupPaths,
  );

  useEffect(() => {
    // Clear the global snapshot when the active project changes, so groups
    // hidden in one project don't leak into another on client-side navigation.
    if (projectName !== undefined && projectName !== ownerProject) {
      ownerProject = projectName;
      latestHiddenGroupPaths = new Set();
    }
    setHiddenGroupPaths(latestHiddenGroupPaths);

    function handler(e: Event) {
      if (e instanceof CustomEvent && e.detail instanceof Set) {
        setHiddenGroupPaths(e.detail);
      }
    }
    document.addEventListener("group-visibility-change", handler);
    return () => document.removeEventListener("group-visibility-change", handler);
  }, [projectName]);

  return hiddenGroupPaths;
}

