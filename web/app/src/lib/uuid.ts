// `crypto.randomUUID()` is only defined in secure contexts (HTTPS or
// localhost). In CI we hit the app over an IP address, which is *not*
// a secure context, so the global is undefined and calling it throws.
// Fall back to a Math.random()-based v4 UUID in that case — it's not
// cryptographically strong but these IDs are only local React keys.
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
