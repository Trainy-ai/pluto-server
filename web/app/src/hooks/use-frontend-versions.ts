import { useEffect, useState } from "react";

import {
  FRONTEND_VERSIONS_URL,
  parseVersionsManifest,
  type FrontendVersionsManifest,
} from "@/lib/frontend-version";

/**
 * The manifest is immutable for the life of a deployed image, so fetch it once
 * and share the promise across every hook consumer. `cache: "no-cache"` forces
 * a conditional revalidation against the server so a freshly deployed image's
 * manifest isn't masked by a stale HTTP cache entry.
 */
let manifestPromise: Promise<FrontendVersionsManifest | null> | null = null;

function fetchManifest(): Promise<FrontendVersionsManifest | null> {
  if (!manifestPromise) {
    manifestPromise = fetch(FRONTEND_VERSIONS_URL, {
      headers: { Accept: "application/json" },
      cache: "no-cache",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((raw) => parseVersionsManifest(raw))
      .catch(() => null);
  }
  return manifestPromise;
}

/**
 * Returns the `/versions.json` manifest baked into the frontend image. In dev
 * (no nginx, no manifest) the fetch 404s and we return null so callers can hide
 * the version switcher.
 */
export function useFrontendVersions(): FrontendVersionsManifest | null {
  const [manifest, setManifest] = useState<FrontendVersionsManifest | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    fetchManifest().then((data) => {
      if (!cancelled) {
        setManifest(data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return manifest;
}
