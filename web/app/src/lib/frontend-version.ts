/**
 * Pinned frontend-version support.
 *
 * The frontend image bakes in the last N releases side-by-side (see
 * web/app/Dockerfile): every release's content-hashed assets are merged into a
 * single `/assets/` directory (hashes guarantee no collisions) and each
 * release's `index.html` is kept at `/v/<version>/index.html`. A `mlop_fe_version`
 * cookie tells nginx (see web/app/nginx.conf) which `index.html` to serve;
 * absent/invalid cookie falls back to the latest build.
 *
 * The available versions are published at `/versions.json` at build time.
 *
 * This module holds the pure, framework-free helpers so they can be unit
 * tested without a DOM. Browser-only wrappers live at the bottom.
 */

export const FRONTEND_VERSION_COOKIE = "mlop_fe_version";
export const FRONTEND_VERSION_PARAM = "fe";
export const FRONTEND_VERSIONS_URL = "/versions.json";

// Sentinel used by the `?fe=` param to explicitly drop a pin and return to the
// latest build.
export const LATEST_SENTINEL = "latest";

export interface FrontendVersionsManifest {
  // The newest build (served when no version is pinned).
  current: string;
  // All available builds, newest first.
  versions: string[];
}

/**
 * Charset nginx will route on. MUST stay in sync with the cookie regex in
 * web/app/nginx.conf. Rejecting `..` defends against any path-traversal attempt
 * via the cookie/`?fe=` value (nginx normalizes too, but defense in depth).
 */
const SAFE_VERSION = /^[A-Za-z0-9._-]+$/;

export function isValidVersion(version: string): boolean {
  return SAFE_VERSION.test(version) && !version.includes("..");
}

/**
 * Parse the `/versions.json` manifest defensively — it is generated at image
 * build time and we never want a malformed file to crash the switcher.
 * Returns null when there is nothing usable to show.
 */
export function parseVersionsManifest(
  raw: unknown,
): FrontendVersionsManifest | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const versions = Array.isArray(obj.versions)
    ? obj.versions.filter(
        (v): v is string => typeof v === "string" && isValidVersion(v),
      )
    : [];
  if (versions.length === 0) {
    return null;
  }
  const current =
    typeof obj.current === "string" && isValidVersion(obj.current)
      ? obj.current
      : versions[0];
  return { current, versions };
}

/**
 * Read the pinned version from a raw `document.cookie` string. Pure so it can
 * be tested without a DOM.
 */
export function readVersionCookie(cookieString: string): string | null {
  const match = cookieString.match(
    new RegExp(`(?:^|;\\s*)${FRONTEND_VERSION_COOKIE}=([^;]*)`),
  );
  if (!match) {
    return null;
  }
  const value = decodeURIComponent(match[1]);
  return value.length > 0 ? value : null;
}

export function buildSetCookie(version: string): string {
  // 30 days; path=/ so nginx sees it on every navigation, lax so it rides
  // top-level navigations from ops links.
  return `${FRONTEND_VERSION_COOKIE}=${encodeURIComponent(
    version,
  )}; path=/; max-age=2592000; samesite=lax`;
}

export function buildClearCookie(): string {
  return `${FRONTEND_VERSION_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

// ---------------------------------------------------------------------------
// Browser-only wrappers (not unit tested; thin shims over the pure helpers).
// ---------------------------------------------------------------------------

export function getPinnedVersion(): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  return readVersionCookie(document.cookie);
}

export function pinVersion(version: string): void {
  if (typeof document === "undefined" || !isValidVersion(version)) {
    return;
  }
  document.cookie = buildSetCookie(version);
  window.location.reload();
}

export function unpinVersion(): void {
  if (typeof document === "undefined") {
    return;
  }
  document.cookie = buildClearCookie();
  window.location.reload();
}

/**
 * Honour a `?fe=<version>` query param (e.g. an ops/canary share link), then
 * strip it and reload so nginx serves the pinned `index.html`. Because the
 * served `index.html` is chosen by nginx BEFORE this JS runs, the param can
 * only take effect on the next request — hence the redirect.
 *
 * Returns true when a redirect was triggered (caller should skip rendering).
 */
export function applyVersionParamFromUrl(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const url = new URL(window.location.href);
  const requested = url.searchParams.get(FRONTEND_VERSION_PARAM);
  if (!requested) {
    return false;
  }

  url.searchParams.delete(FRONTEND_VERSION_PARAM);
  const clean = `${url.pathname}${
    url.searchParams.toString() ? `?${url.searchParams.toString()}` : ""
  }${url.hash}`;

  if (requested === LATEST_SENTINEL) {
    document.cookie = buildClearCookie();
  } else if (isValidVersion(requested)) {
    document.cookie = buildSetCookie(requested);
  } else {
    // Unrecognized value — just clean the URL without changing the pin.
    window.location.replace(clean);
    return true;
  }

  window.location.replace(clean);
  return true;
}
