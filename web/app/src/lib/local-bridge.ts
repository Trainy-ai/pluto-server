/**
 * Settings and probing for the local agent bridge (`@mlop/agent-bridge`),
 * a loopback server the user runs so their own Claude Code or Codex can
 * power the chat UI.
 */

export interface LocalBridgeSettings {
  port: number;
  token: string;
}

export const LOCAL_BRIDGE_STORAGE_KEY = "mlop.chat.local-bridge";
export const LOCAL_BRIDGE_DEFAULT_PORT = 8377;

export function getLocalBridgeUrl(port: number, path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

export function loadLocalBridgeSettings(): LocalBridgeSettings | null {
  try {
    const raw = localStorage.getItem(LOCAL_BRIDGE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalBridgeSettings>;
    if (
      typeof parsed.port !== "number" ||
      !Number.isInteger(parsed.port) ||
      parsed.port <= 0 ||
      parsed.port > 65535 ||
      typeof parsed.token !== "string" ||
      !parsed.token
    ) {
      return null;
    }
    return { port: parsed.port, token: parsed.token };
  } catch {
    return null;
  }
}

export function saveLocalBridgeSettings(
  settings: LocalBridgeSettings | null,
): void {
  try {
    if (settings) {
      localStorage.setItem(LOCAL_BRIDGE_STORAGE_KEY, JSON.stringify(settings));
    } else {
      localStorage.removeItem(LOCAL_BRIDGE_STORAGE_KEY);
    }
  } catch {
    // Private browsing or blocked storage — the session just won't persist.
  }
}

export interface LocalBridgeStatus {
  ok: boolean;
  agent?: string;
}

export async function probeLocalBridge(
  settings: LocalBridgeSettings,
): Promise<LocalBridgeStatus> {
  try {
    const response = await fetch(getLocalBridgeUrl(settings.port, "/health"), {
      headers: { "x-bridge-token": settings.token },
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return { ok: false };
    const payload = (await response.json()) as { ok?: boolean; agent?: string };
    return { ok: payload.ok === true, agent: payload.agent };
  } catch {
    return { ok: false };
  }
}
