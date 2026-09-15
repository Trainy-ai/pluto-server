import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createClaudeRunner } from "./agents/claude.js";
import { createCodexRunner } from "./agents/codex.js";
import {
  API_KEY_ENV,
  claudeMcpConfig,
  DEFAULT_MCP_URL,
  probeMcp,
  type McpProbeResult,
} from "./mcp.js";
import { createBridgeServer } from "./server.js";
import { resolveToken, tokenPath } from "./token.js";
import type { AgentRunner } from "./types.js";

const DEFAULT_PORT = 8377;
const DEFAULT_ORIGIN = "https://pluto.trainy.ai";

interface CliOptions {
  port: number;
  agent: "claude" | "codex";
  token?: string;
  rotateToken: boolean;
  claudeCommand?: string;
  codexCommand?: string;
  mcpUrl: string;
  mcpConfigPath?: string;
  allowWrites: boolean;
  allowedOrigins: string[];
}

function packageVersion(): string {
  const packageJson = new URL("../package.json", import.meta.url);
  return (JSON.parse(readFileSync(packageJson, "utf8")) as { version: string })
    .version;
}

function printHelp(): void {
  console.log(`pluto-bridge — let your local Claude Code or Codex power the Pluto chat UI

Usage: PLUTO_API_KEY=mlpi_... pluto-bridge [options]

Options:
  --agent <claude|codex>   Which local agent answers chats (default: claude)
  --port <number>          Loopback port to listen on (default: ${DEFAULT_PORT})
  --token <string>         Pairing token for this run only (default: the one
                           saved in ~/.config/pluto-bridge/token)
  --rotate-token           Replace the saved pairing token with a new one
  --allow-writes           Let the agent change tags, notes and dashboards
                           (default: read-only)
  --origin <origin>        Also accept chats from this Pluto web origin, e.g.
                           a self-hosted https://pluto.example.com; repeatable
                           (always allowed: ${DEFAULT_ORIGIN})
  --mcp-url <url>          Pluto MCP endpoint, for self-hosted Pluto
                           (default: ${DEFAULT_MCP_URL})
  --mcp-config <path>      Claude only: MCP config file used instead of
                           --mcp-url; must define a server named "pluto"
  --claude-bin <path>      Claude Code binary (default: claude)
  --codex-bin <path>       Codex binary (default: codex)
  -v, --version            Print the version
  -h, --help               Show this help
`);
}

function parseHttpUrl(flag: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${flag} must be a URL, got "${value}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${flag} must be an http(s) URL, got "${value}"`);
  }
  return url.toString();
}

function parseOrigin(value: string): string {
  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {
    url = undefined;
  }
  if (
    !url ||
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `--origin must be a web origin like https://pluto.example.com, got "${value}"`,
    );
  }
  return url.origin;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    port: DEFAULT_PORT,
    agent: "claude",
    mcpUrl: DEFAULT_MCP_URL,
    rotateToken: false,
    allowWrites: false,
    allowedOrigins: [DEFAULT_ORIGIN],
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      return value;
    };
    switch (flag) {
      case "--":
        break;
      case "--agent": {
        const agent = next();
        if (agent !== "claude" && agent !== "codex") {
          throw new Error(`--agent must be "claude" or "codex", got "${agent}"`);
        }
        options.agent = agent;
        break;
      }
      case "--port": {
        const port = Number(next());
        if (!Number.isInteger(port) || port <= 0 || port > 65535) {
          throw new Error("--port must be a valid port number");
        }
        options.port = port;
        break;
      }
      case "--token":
        options.token = next();
        break;
      case "--rotate-token":
        options.rotateToken = true;
        break;
      case "--allow-writes":
        options.allowWrites = true;
        break;
      case "--origin": {
        const origin = parseOrigin(next());
        if (!options.allowedOrigins.includes(origin)) {
          options.allowedOrigins.push(origin);
        }
        break;
      }
      case "--mcp-url":
        options.mcpUrl = parseHttpUrl(flag, next());
        break;
      case "--mcp-config":
        options.mcpConfigPath = next();
        break;
      case "--claude-bin":
        options.claudeCommand = next();
        break;
      case "--codex-bin":
        options.codexCommand = next();
        break;
      case "-v":
      case "--version":
        console.log(packageVersion());
        process.exit(0);
        break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }
  if (options.token !== undefined && options.rotateToken) {
    throw new Error("--token and --rotate-token cannot be combined");
  }
  if (options.agent === "codex" && options.mcpConfigPath) {
    throw new Error("--mcp-config is only supported with --agent claude");
  }
  return options;
}

const TOKEN_NOTES: Record<ReturnType<typeof resolveToken>["source"], string> = {
  created: "This token is saved and reused on restart; --rotate-token replaces it.",
  stored: "Same token as last time, so an existing pairing keeps working.",
  rotated: "New token: pair the Chat page again. The old token no longer works.",
  flag: "Using the token from --token for this run only.",
};

export interface PreflightResult {
  ok: boolean;
  message?: string;
}

/**
 * Check the pluto MCP credential before accepting chats, so a missing or
 * rejected key is reported here rather than as a failed first turn.
 */
export async function preflightMcp(
  options: CliOptions,
  env: NodeJS.ProcessEnv,
  probe: (url: string, apiKey: string) => Promise<McpProbeResult> = probeMcp,
): Promise<PreflightResult> {
  // A custom config carries its own credentials; there is nothing to check.
  if (options.mcpConfigPath) return { ok: true };

  const apiKey = env[API_KEY_ENV];
  if (!apiKey) {
    return {
      ok: false,
      message: [
        `${API_KEY_ENV} is not set. The bridge uses it to read your Pluto data through the pluto MCP server.`,
        "",
        "Create an API key at https://pluto.trainy.ai/api-keys (self-hosted: <your Pluto URL>/api-keys),",
        "then start the bridge with it:",
        "",
        `  ${API_KEY_ENV}=mlpi_... npx @trainy/pluto-bridge@${packageVersion()}`,
      ].join("\n"),
    };
  }

  const result = await probe(options.mcpUrl, apiKey);
  if (result.status === "unauthorized") {
    return {
      ok: false,
      message: `The pluto MCP server at ${options.mcpUrl} rejected ${API_KEY_ENV}. Check that the key is current and belongs to this Pluto deployment.`,
    };
  }
  if (result.status === "unreachable") {
    return {
      ok: true,
      message: `Warning: could not reach the pluto MCP server at ${options.mcpUrl} (${result.reason}). Chats will fail until it is reachable.`,
    };
  }
  return { ok: true };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  let options: CliOptions;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printHelp();
    process.exit(1);
  }

  const preflight = await preflightMcp(options, process.env);
  if (preflight.message) {
    (preflight.ok ? console.warn : console.error)(preflight.message);
  }
  if (!preflight.ok) process.exit(1);

  const runner: AgentRunner =
    options.agent === "codex"
      ? createCodexRunner({
          command: options.codexCommand,
          mcpUrl: options.mcpUrl,
          allowWrites: options.allowWrites,
        })
      : createClaudeRunner({
          command: options.claudeCommand,
          mcpConfig: options.mcpConfigPath ?? claudeMcpConfig(options.mcpUrl),
          allowWrites: options.allowWrites,
        });

  const { token, source: tokenSource } = resolveToken({
    path: tokenPath(process.env, homedir()),
    token: options.token,
    rotate: options.rotateToken,
  });
  const reportedOrigins = new Set<string>();
  const bridge = createBridgeServer({
    token,
    runner,
    allowWrites: options.allowWrites,
    allowedOrigins: options.allowedOrigins,
    onRejectedOrigin: (origin) => {
      if (reportedOrigins.has(origin)) return;
      reportedOrigins.add(origin);
      console.warn(
        `Refused a request from ${origin}. If that is your Pluto web app, restart with --origin ${origin}`,
      );
    },
  });

  bridge.server.listen(options.port, "127.0.0.1", () => {
    console.log(`Pluto bridge listening on http://127.0.0.1:${options.port}`);
    console.log(`Agent: ${runner.name}`);
    console.log(`Allowed origins: ${options.allowedOrigins.join(", ")}`);
    console.log(
      options.allowWrites
        ? "Pluto tools: read and write (--allow-writes)"
        : "Pluto tools: read-only (pass --allow-writes to let the agent change tags, notes and dashboards)",
    );
    console.log("");
    console.log("In the Pluto Chat page, choose “Local agent” and enter:");
    console.log(`  Port:  ${options.port}`);
    console.log(`  Token: ${token}`);
    console.log("");
    console.log(TOKEN_NOTES[tokenSource]);
    console.log("The bridge only accepts loopback connections carrying this token.");
  });

  const shutdown = () => {
    bridge.server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
