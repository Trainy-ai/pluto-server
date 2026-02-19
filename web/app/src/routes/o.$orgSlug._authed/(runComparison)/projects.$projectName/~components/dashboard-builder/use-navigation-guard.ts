import { useBlocker } from "@tanstack/react-router";

interface NavigationGuardResult {
  isBlocked: boolean;
  proceed: () => void;
  reset: () => void;
}

/**
 * Blocks in-app navigation and browser tab close when there are unsaved changes.
 * Returns a resolver to show a custom confirmation dialog.
 */
export function useNavigationGuard(hasUnsavedChanges: boolean): NavigationGuardResult {
  const blocker = useBlocker({
    shouldBlockFn: () => hasUnsavedChanges,
    enableBeforeUnload: () => hasUnsavedChanges,
    withResolver: true,
  });

  if (blocker.status === "blocked") {
    return {
      isBlocked: true,
      proceed: blocker.proceed,
      reset: blocker.reset,
    };
  }

  return {
    isBlocked: false,
    proceed: () => {},
    reset: () => {},
  };
}
