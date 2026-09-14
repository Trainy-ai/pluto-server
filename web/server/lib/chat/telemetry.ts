import { createHash } from "node:crypto";
import { LangfuseClient } from "@langfuse/client";
import {
  createTraceId,
  startObservation,
  type LangfuseGeneration,
  type LangfuseRetriever,
  type LangfuseSpan,
} from "@langfuse/tracing";
import { env } from "../env";

const PROMPT_VERSION = env.CHAT_PROMPT_VERSION;
const RETRIEVAL_VERSION = "recent-runs-v1";

function isLangfuseConfigured(): boolean {
  return Boolean(
    env.LANGFUSE_BASE_URL && env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY,
  );
}

function opaqueIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

let langfuseClient: LangfuseClient | undefined;

function getLangfuseClient(): LangfuseClient | undefined {
  if (!isLangfuseConfigured()) return undefined;
  langfuseClient ??= new LangfuseClient({
    baseUrl: env.LANGFUSE_BASE_URL,
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
  });
  return langfuseClient;
}

export async function getChatTraceId(input: {
  organizationId: string;
  userId: string;
  projectName: string;
  conversationId: string;
  turnId: string;
}): Promise<string> {
  return createTraceId(
    `${input.organizationId}:${input.userId}:${input.projectName}:${input.conversationId}:${input.turnId}`,
  );
}

export class ChatTurnTrace {
  readonly traceId: string;
  private root?: LangfuseSpan;
  private retrieval?: LangfuseRetriever;
  private generation?: LangfuseGeneration;
  private finished = false;
  private firstTokenRecorded = false;

  private constructor(traceId: string, root?: LangfuseSpan) {
    this.traceId = traceId;
    this.root = root;
  }

  private safely(operation: () => void): void {
    try {
      operation();
    } catch {
      // Telemetry is deliberately fail-open. Do not export the SDK error or
      // let it escape into the chat request/stream lifecycle.
      console.warn("[chat] Langfuse operation failed");
    }
  }

  static async create(input: {
    organizationId: string;
    userId: string;
    projectName: string;
    conversationId: string;
    turnId: string;
    latestUserText: string;
  }): Promise<ChatTurnTrace> {
    const traceId = await getChatTraceId(input);
    if (!isLangfuseConfigured()) return new ChatTurnTrace(traceId);

    try {
      const root = startObservation(
        "project-chat-turn",
        {
          input: env.CHAT_CAPTURE_CONTENT
            ? { prompt: input.latestUserText }
            : { promptCharacters: input.latestUserText.length },
          metadata: {
            organization: opaqueIdentifier(input.organizationId),
            project: opaqueIdentifier(input.projectName),
            promptVersion: PROMPT_VERSION,
            retrievalVersion: RETRIEVAL_VERSION,
            captureContent: env.CHAT_CAPTURE_CONTENT,
          },
          version: PROMPT_VERSION,
          environment: env.NODE_ENV ?? "development",
        },
        {
          parentSpanContext: {
            traceId,
            spanId: "0123456789abcdef",
            traceFlags: 1,
          },
        },
      );
      root.otelSpan.setAttribute("user.id", opaqueIdentifier(input.userId));
      root.otelSpan.setAttribute("session.id", input.conversationId);
      return new ChatTurnTrace(traceId, root);
    } catch (error) {
      console.warn("[chat] Langfuse trace initialization failed", {
        error: error instanceof Error ? error.message : "unknown error",
      });
      return new ChatTurnTrace(traceId);
    }
  }

  startRetrieval(projectName: string): void {
    this.safely(() => {
      this.retrieval = this.root?.startObservation(
        "project-snapshot",
        {
          input: { project: opaqueIdentifier(projectName) },
          metadata: { retrievalVersion: RETRIEVAL_VERSION },
        },
        { asType: "retriever" },
      );
    });
  }

  finishRetrieval(input: { runCount: number; metricCount: number }): void {
    this.safely(() => this.retrieval?.update({ output: input }));
    this.safely(() => this.retrieval?.end());
    this.retrieval = undefined;
  }

  startGeneration(input: {
    model: string;
    maxOutputTokens: number;
    systemPrompt: string;
  }): void {
    this.safely(() => {
      this.generation = this.root?.startObservation(
        "answer-generation",
        {
          input: env.CHAT_CAPTURE_CONTENT
            ? { systemPrompt: input.systemPrompt }
            : { systemPromptCharacters: input.systemPrompt.length },
          model: input.model,
          modelParameters: { maxOutputTokens: input.maxOutputTokens },
          metadata: { promptVersion: PROMPT_VERSION },
        },
        { asType: "generation" },
      );
    });
  }

  recordFirstToken(): void {
    if (this.firstTokenRecorded) return;
    this.firstTokenRecorded = true;
    this.safely(() =>
      this.generation?.update({ completionStartTime: new Date() }),
    );
  }

  finishSuccess(input: {
    text: string;
    finishReason: string;
    usage: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
  }): void {
    if (this.finished) return;
    this.finished = true;
    const usageDetails = Object.fromEntries(
      Object.entries(input.usage).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      ),
    );
    this.safely(() =>
      this.generation?.update({
        output: env.CHAT_CAPTURE_CONTENT
          ? { text: input.text }
          : { responseCharacters: input.text.length },
        usageDetails,
        metadata: { finishReason: input.finishReason },
      }),
    );
    this.safely(() => this.generation?.end());
    this.safely(() => this.root?.update({ output: { status: "completed" } }));
    this.safely(() => this.root?.end());
  }

  finishError(message: string, level: "ERROR" | "WARNING" = "ERROR"): void {
    if (this.finished) return;
    this.finished = true;
    this.safely(() =>
      this.retrieval?.update({ level, statusMessage: message }),
    );
    this.safely(() => this.retrieval?.end());
    this.safely(() =>
      this.generation?.update({ level, statusMessage: message }),
    );
    this.safely(() => this.generation?.end());
    this.safely(() => this.root?.update({ level, statusMessage: message }));
    this.safely(() => this.root?.end());
  }
}

export async function submitChatFeedback(input: {
  organizationId: string;
  userId: string;
  projectName: string;
  conversationId: string;
  turnId: string;
  value: boolean;
  comment?: string;
}): Promise<boolean> {
  const client = getLangfuseClient();
  if (!client) return false;

  const traceId = await getChatTraceId(input);
  const scoreSeed = await createTraceId(`user-feedback:${traceId}`);
  const scoreId = `${scoreSeed.slice(0, 8)}-${scoreSeed.slice(8, 12)}-${scoreSeed.slice(12, 16)}-${scoreSeed.slice(16, 20)}-${scoreSeed.slice(20)}`;
  client.score.create({
    id: scoreId,
    traceId,
    sessionId: input.conversationId,
    name: "user-feedback",
    value: input.value ? 1 : 0,
    dataType: "BOOLEAN",
    comment: input.comment,
    metadata: { organization: opaqueIdentifier(input.organizationId) },
  });
  await client.flush();
  return true;
}
