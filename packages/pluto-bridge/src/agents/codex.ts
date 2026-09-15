import { runProcessLines } from "../process.js";
import { codexMcpOverrides } from "../mcp.js";
import { grantedTools } from "../tool-policy.js";
import type { AgentEvent, AgentRunner, AgentTurnOptions } from "../types.js";

export interface CodexRunnerOptions {
  /** Binary to invoke; defaults to `codex` on PATH. */
  command?: string;
  /** Pluto MCP endpoint; authenticated with PLUTO_API_KEY from the environment. */
  mcpUrl: string;
  /** Enable the pluto write tools; read-only when false. */
  allowWrites?: boolean;
}

/**
 * Codex has no system-prompt flag in exec mode, so project context is
 * prepended to the first prompt of a thread.
 *
 * --ignore-user-config keeps the user's other MCP servers (and any broader
 * pluto config) out of the turn; auth still comes from CODEX_HOME. Shell
 * commands run in the read-only sandbox even with allowWrites, since pluto
 * writes are MCP calls, not shell commands.
 */
export function buildCodexArgs({
  prompt,
  systemPrompt,
  resumeSessionId,
  mcpUrl,
  allowWrites = false,
}: {
  prompt: string;
  systemPrompt: string;
  resumeSessionId?: string;
  mcpUrl: string;
  allowWrites?: boolean;
}): string[] {
  const options = [
    "--json",
    "--ignore-user-config",
    "--skip-git-repo-check",
    "-c",
    'sandbox_mode="read-only"',
    ...codexMcpOverrides(mcpUrl, grantedTools(allowWrites)),
  ];
  if (resumeSessionId) {
    return ["exec", "resume", resumeSessionId, ...options, prompt];
  }
  return ["exec", ...options, `${systemPrompt}\n\n${prompt}`];
}

/** Map one `codex exec --json` line to bridge events. */
export function parseCodexLine(line: string): AgentEvent[] {
  if (!line.trim()) return [];
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return [];
  }

  // Current thread-event shape.
  if (parsed.type === "thread.started") {
    const threadId = parsed.thread_id;
    return typeof threadId === "string"
      ? [{ type: "session", sessionId: threadId }]
      : [];
  }
  if (parsed.type === "item.completed") {
    const item = parsed.item as { type?: string; text?: string } | undefined;
    if (item?.type === "agent_message" && typeof item.text === "string") {
      return [{ type: "text", text: item.text }];
    }
    return [];
  }
  if (parsed.type === "turn.completed") {
    return [{ type: "done", isError: false }];
  }
  if (parsed.type === "turn.failed" || parsed.type === "error") {
    const message =
      typeof parsed.message === "string" ? parsed.message : "Codex failed";
    return [{ type: "done", isError: true, errorText: message }];
  }

  // Legacy `{"id":..., "msg": {...}}` envelope.
  const msg = parsed.msg as
    | { type?: string; message?: string; session_id?: string }
    | undefined;
  if (msg?.type === "session_configured" && typeof msg.session_id === "string") {
    return [{ type: "session", sessionId: msg.session_id }];
  }
  if (msg?.type === "agent_message" && typeof msg.message === "string") {
    return [{ type: "text", text: msg.message }];
  }
  if (msg?.type === "task_complete") {
    return [{ type: "done", isError: false }];
  }
  if (msg?.type === "error") {
    return [
      { type: "done", isError: true, errorText: msg.message ?? "Codex failed" },
    ];
  }

  return [];
}

export function createCodexRunner(options: CodexRunnerOptions): AgentRunner {
  const command = options.command ?? "codex";
  return {
    name: "codex",
    async *runTurn(turn: AgentTurnOptions): AsyncIterable<AgentEvent> {
      const args = buildCodexArgs({
        prompt: turn.prompt,
        systemPrompt: turn.systemPrompt,
        resumeSessionId: turn.resumeSessionId,
        mcpUrl: options.mcpUrl,
        allowWrites: options.allowWrites,
      });
      for await (const line of runProcessLines(command, args, {
        signal: turn.signal,
      })) {
        yield* parseCodexLine(line);
      }
    },
  };
}
