import { runProcessLines } from "../process";
import type { AgentEvent, AgentRunner, AgentTurnOptions } from "../types";

export interface ClaudeRunnerOptions {
  /** Binary to invoke; defaults to `claude` on PATH. */
  command?: string;
  /** Optional MCP config file passed through to the CLI. */
  mcpConfigPath?: string;
  /**
   * Tool patterns pre-approved for headless runs. Defaults to the pluto MCP
   * server so data lookups don't stall on permission prompts.
   */
  allowedTools?: string[];
}

export function buildClaudeArgs({
  systemPrompt,
  resumeSessionId,
  mcpConfigPath,
  allowedTools = ["mcp__pluto"],
}: {
  systemPrompt: string;
  resumeSessionId?: string;
  mcpConfigPath?: string;
  allowedTools?: string[];
}): string[] {
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
    ...(mcpConfigPath ? ["--mcp-config", mcpConfigPath] : []),
    ...(allowedTools.length > 0
      ? ["--allowedTools", allowedTools.join(",")]
      : []),
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

export function createClaudeRunner(
  options: ClaudeRunnerOptions = {},
): AgentRunner {
  const command = options.command ?? "claude";
  return {
    name: "claude",
    async *runTurn(turn: AgentTurnOptions): AsyncIterable<AgentEvent> {
      const args = buildClaudeArgs({
        systemPrompt: turn.systemPrompt,
        resumeSessionId: turn.resumeSessionId,
        mcpConfigPath: options.mcpConfigPath,
        allowedTools: options.allowedTools,
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
