export interface BridgeMessage {
  role: "user" | "assistant";
  text: string;
}

export interface BridgeChatRequest {
  conversationId: string;
  orgSlug: string;
  projectName: string;
  messages: BridgeMessage[];
}

/** Normalized events produced by an agent CLI while answering one turn. */
export type AgentEvent =
  | { type: "session"; sessionId: string }
  | { type: "text"; text: string }
  | { type: "done"; isError: boolean; errorText?: string };

export interface AgentTurnOptions {
  /** The user-visible prompt for this turn (may embed replayed history). */
  prompt: string;
  /** Project context appended to the agent's system prompt. */
  systemPrompt: string;
  /** Agent-native session to resume, when the bridge has seen this conversation. */
  resumeSessionId?: string;
  signal: AbortSignal;
}

export interface AgentRunner {
  name: string;
  runTurn(options: AgentTurnOptions): AsyncIterable<AgentEvent>;
}
