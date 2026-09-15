import { randomBytes } from "node:crypto";
import { createClaudeRunner } from "./agents/claude";
import { createCodexRunner } from "./agents/codex";
import { createBridgeServer } from "./server";
import type { AgentRunner } from "./types";

const DEFAULT_PORT = 8377;

interface CliOptions {
  port: number;
  agent: "claude" | "codex";
  token?: string;
  claudeCommand?: string;
  codexCommand?: string;
  mcpConfigPath?: string;
  allowedTools?: string[];
}

function printHelp(): void {
  console.log(`mlop-agent-bridge — let your local Claude Code or Codex power the mlop chat UI

Usage: mlop-agent-bridge [options]

Options:
  --agent <claude|codex>   Which local agent answers chats (default: claude)
  --port <number>          Loopback port to listen on (default: ${DEFAULT_PORT})
  --token <string>         Pairing token (default: freshly generated)
  --claude-bin <path>      Claude Code binary (default: claude)
  --codex-bin <path>       Codex binary (default: codex)
  --mcp-config <path>      MCP config file passed to Claude Code (for the
                           pluto MCP server, if not already in your settings)
  --allowed-tools <list>   Comma-separated tool patterns auto-approved for
                           Claude Code (default: mcp__pluto)
  -h, --help               Show this help
`);
}

export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = { port: DEFAULT_PORT, agent: "claude" };
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
      case "--claude-bin":
        options.claudeCommand = next();
        break;
      case "--codex-bin":
        options.codexCommand = next();
        break;
      case "--mcp-config":
        options.mcpConfigPath = next();
        break;
      case "--allowed-tools":
        options.allowedTools = next()
          .split(",")
          .map((tool) => tool.trim())
          .filter(Boolean);
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
  return options;
}

export function main(argv = process.argv.slice(2)): void {
  let options: CliOptions;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printHelp();
    process.exit(1);
  }

  const runner: AgentRunner =
    options.agent === "codex"
      ? createCodexRunner({ command: options.codexCommand })
      : createClaudeRunner({
          command: options.claudeCommand,
          mcpConfigPath: options.mcpConfigPath,
          allowedTools: options.allowedTools,
        });

  const token = options.token ?? randomBytes(16).toString("hex");
  const bridge = createBridgeServer({ token, runner });

  bridge.server.listen(options.port, "127.0.0.1", () => {
    console.log(`mlop agent bridge listening on http://127.0.0.1:${options.port}`);
    console.log(`Agent: ${runner.name}`);
    console.log("");
    console.log("In the mlop Chat page, choose “Local agent” and enter:");
    console.log(`  Port:  ${options.port}`);
    console.log(`  Token: ${token}`);
    console.log("");
    console.log("The bridge only accepts loopback connections carrying this token.");
  });

  const shutdown = () => {
    bridge.server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.argv[1]?.endsWith("cli.ts")) main();
