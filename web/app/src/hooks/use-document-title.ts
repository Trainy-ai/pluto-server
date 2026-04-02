import { useEffect } from "react";

/**
 * Sets the document title (browser tab title).
 * Appends " - Pluto" suffix automatically.
 * Resets to "Pluto" on unmount.
 */
export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (!title) return;
    const fullTitle = `${title} - Pluto`;
    document.title = fullTitle;
    return () => {
      if (document.title === fullTitle) {
        document.title = "Pluto";
      }
    };
  }, [title]);
}
