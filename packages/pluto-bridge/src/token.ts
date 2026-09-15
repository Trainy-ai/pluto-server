import { randomBytes } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

export type TokenSource = "flag" | "stored" | "created" | "rotated";

export function tokenPath(env: NodeJS.ProcessEnv, homeDir: string): string {
  const configHome = env.XDG_CONFIG_HOME || join(homeDir, ".config");
  return join(configHome, "pluto-bridge", "token");
}

function readStoredToken(path: string): string | undefined {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8").trim();
  } catch {
    return undefined;
  }
  if (!TOKEN_PATTERN.test(contents)) return undefined;
  if ((statSync(path).mode & 0o077) !== 0) chmodSync(path, 0o600);
  return contents;
}

function storeToken(path: string, token: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  // The mode option only applies when the file is created.
  chmodSync(path, 0o600);
}

/**
 * Reuse one pairing token across restarts, so the browser's saved pairing
 * keeps working. An explicit --token is used as-is and never written.
 */
export function resolveToken({
  path,
  token,
  rotate = false,
}: {
  path: string;
  token?: string;
  rotate?: boolean;
}): { token: string; source: TokenSource } {
  if (token !== undefined) return { token, source: "flag" };

  if (!rotate) {
    const stored = readStoredToken(path);
    if (stored) return { token: stored, source: "stored" };
  }

  const fresh = randomBytes(16).toString("hex");
  storeToken(path, fresh);
  return { token: fresh, source: rotate ? "rotated" : "created" };
}
