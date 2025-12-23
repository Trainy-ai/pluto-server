import * as React from "react";

import { useCallbackRef } from "./use-callback-ref";

type MediaQueryCallback = (event: MediaQueryListEvent) => void;

function listen(query: MediaQueryList, callback: MediaQueryCallback) {
  try {
    query.addEventListener("change", callback);
    return () => query.removeEventListener("change", callback);
  } catch {
    query.addListener(callback);
    return () => query.removeListener(callback);
  }
}

export type UseMediaQueryOptions = {
  fallback?: boolean;
  ssr?: boolean;
  getWindow?(): typeof window;
};

export function useMediaQuery(
  query: string,
  options: UseMediaQueryOptions = {},
): boolean {
  const { fallback, ssr = true, getWindow } = options;
  const getWin = useCallbackRef(getWindow);
  const [value, setValue] = React.useState(() => ({
    media: query,
    matches: !ssr
      ? (getWin() ?? window).matchMedia?.(query)?.matches
      : !!fallback,
  }));

  React.useEffect(() => {
    const win = getWin() ?? window;
    setValue((prev) => {
      const current = {
        media: query,
        matches: win.matchMedia(query).matches,
      };

      return prev.matches === current.matches && prev.media === current.media
        ? prev
        : current;
    });

    const handler = (evt: MediaQueryListEvent) => {
      setValue((prev) => {
        if (prev.media === evt.media) {
          return { ...prev, matches: evt.matches };
        }
        return prev;
      });
    };

    const cleanup = listen(win.matchMedia(query), handler);

    return () => cleanup();
    // eslint-disable-next-line
  }, [getWin]);

  return value.matches;
}
