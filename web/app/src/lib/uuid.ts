// `crypto.randomUUID()` is only defined in secure contexts (HTTPS or
// localhost). In CI we hit the app over an IP address, which is *not*
// a secure context, so the global is undefined and calling it throws.
// Fall back to a Math.random()-based v4 UUID in that case — it's not
// cryptographically strong. Most callers only use these as local React
// keys; `addSection` in use-charts-layout-draft.ts also persists the
// first 8 chars (as `custom:<8 chars>`) into the shared project layout
// config as a section key, but at that length collision odds stay low
// enough for a per-project set of hand-created sections.
export function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
