const RECENT_AUTH_METHOD_KEY = "recent_auth_method";

export type AuthMethod = "google" | "github" | "email";

export function getRecentAuthMethod(): AuthMethod | null {
  if (typeof window === "undefined") return null;
  const method = localStorage.getItem(RECENT_AUTH_METHOD_KEY);
  return (method as AuthMethod) || null;
}

export function setRecentAuthMethod(method: AuthMethod): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(RECENT_AUTH_METHOD_KEY, method);
}
