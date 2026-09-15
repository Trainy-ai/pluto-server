import { runProcessLines } from "../process.js";
import {
  grantedTools,
  PLUTO_MCP_SERVER,
  withheldTools,
} from "../tool-policy.js";
import type { AgentEvent, AgentRunner, AgentTurnOptions } from "../types.js";

export interface ClaudeRunnerOptions {
  /** Binary to invoke; defaults to `claude` on PATH. */
  command?: string;
  /**
   * MCP config (JSON string or file path) defining the `pluto` server. It is
   * loaded with --strict-mcp-config, so no other MCP server the user has
   * configured is reachable from a chat turn.
   */
  mcpConfig: string;
  /** Grant the pluto write tools; read-only when false. */
  allowWrites?: boolean;
}

function plutoToolIds(tools: string[]): string {
  return tools.map((tool) => `mcp__${PLUTO_MCP_SERVER}__${tool}`).join(",");
}

export function buildClaudeArgs({
  systemPrompt,
  resumeSessionId,
  mcpConfig,
  allowWrites = false,
}: {
  systemPrompt: string;
  resumeSessionId?: string;
  mcpConfig: string;
  allowWrites?: boolean;
}): string[] {
  const withheld = withheldTools(allowWrites);
  // The prompt goes in via stdin, not argv: --allowedTools is variadic and
  // would swallow a trailing positional, and prompts can start with "-".
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--append-system-prompt",
    systemPrompt,
    ...(resumeSessionId ? ["--resume", resumeSessionId] : []),
    "--strict-mcp-config",
    "--mcp-config",
    mcpConfig,
    // Tools are listed individually: the bare `mcp__pluto` prefix would also
    // grant every write tool. Deny rules win over the user's own allow rules,
    // so withheld tools stay unavailable whatever their settings say.
    "--allowedTools",
    plutoToolIds(grantedTools(allowWrites)),
    ...(withheld.length > 0 ? ["--disallowedTools", plutoToolIds(withheld)] : []),
  ];
}

/** Map one `claude -p --output-format stream-json` line to bridge events. */
export function parseClaudeLine(line: string): AgentEvent[] {
  if (!line.trim()) return [];
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return [];
  }

  if (parsed.type === "system" && parsed.subtype === "init") {
    const sessionId = parsed.session_id;
    return typeof sessionId === "string"
      ? [{ type: "session", sessionId }]
      : [];
  }

  if (parsed.type === "assistant") {
    const message = parsed.message as
      | { content?: Array<{ type?: string; text?: string }> }
      | undefined;
    const text = (message?.content ?? [])
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
    return text ? [{ type: "text", text }] : [];
  }

  if (parsed.type === "result") {
    const isError = parsed.subtype !== "success";
    if (isError) {
      const errorText =
        typeof parsed.result === "string" && parsed.result
          ? parsed.result
          : `Claude Code failed (${String(parsed.subtype)})`;
      return [{ type: "done", isError: true, errorText }];
    }
    // The final answer already streamed via assistant messages.
    return [{ type: "done", isError: false }];
  }

  return [];
}

export function createClaudeRunner(options: ClaudeRunnerOptions): AgentRunner {
  const command = options.command ?? "claude";
  return {
    name: "claude",
    async *runTurn(turn: AgentTurnOptions): AsyncIterable<AgentEvent> {
      const args = buildClaudeArgs({
        systemPrompt: turn.systemPrompt,
        resumeSessionId: turn.resumeSessionId,
        mcpConfig: options.mcpConfig,
        allowWrites: options.allowWrites,
      });
      for await (const line of runProcessLines(command, args, {
        signal: turn.signal,
        input: turn.prompt,
      })) {
        yield* parseClaudeLine(line);
      }
    },
  };
}
