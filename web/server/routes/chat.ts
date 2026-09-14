import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { Hono } from "hono";
import { z } from "zod";
import { buildProjectChatContext } from "../lib/chat/context";
import { isChatEnabledForOrganization } from "../lib/chat/config";
import {
  createChatFeedbackToken,
  verifyChatFeedbackToken,
} from "../lib/chat/feedback-token";
import { chatRequestSchema, sanitizeChatMessages } from "../lib/chat/messages";
import { getChatModel } from "../lib/chat/model";
import { ChatTurnTrace, submitChatFeedback } from "../lib/chat/telemetry";
import { createContext } from "../lib/context";
import { env } from "../lib/env";

const routes = new Hono();

const feedbackSchema = z.object({
  token: z.string().min(1).max(4096),
  value: z.boolean(),
  comment: z.string().max(500).optional(),
});

type ChatResponseMessage = UIMessage<{ feedbackToken?: string }>;

async function withDeadline<T>(
  promise: Promise<T>,
  deadline: number,
): Promise<T> {
  const remainingMilliseconds = deadline - Date.now();
  if (remainingMilliseconds <= 0) throw new Error("Chat request timed out");

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Chat request timed out")),
          remainingMilliseconds,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function authorizeOrganization(
  honoContext: Parameters<typeof createContext>[0]["hono"],
  organizationId: string,
) {
  const context = await createContext({ hono: honoContext });
  if (!context.session?.user) return { error: "unauthorized" as const };

  const membership = await context.prisma.member.findFirst({
    where: { organizationId, userId: context.session.user.id },
    select: { id: true },
  });
  if (!membership) return { error: "forbidden" as const };

  return { context, user: context.session.user };
}

routes.get("/config", async (c) => {
  const organizationId = c.req.query("organizationId");
  if (!organizationId)
    return c.json({ error: "organizationId is required" }, 400);

  const authorization = await authorizeOrganization(c, organizationId);
  if ("error" in authorization) {
    return c.json(
      { error: authorization.error },
      authorization.error === "unauthorized" ? 401 : 403,
    );
  }

  return c.json({ enabled: isChatEnabledForOrganization(organizationId) });
});

routes.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid chat request" }, 400);
  const deadline = Date.now() + env.CHAT_REQUEST_TIMEOUT_MS;

  const authorization = await withDeadline(
    authorizeOrganization(c, parsed.data.organizationId),
    deadline,
  );
  if ("error" in authorization) {
    return c.json(
      { error: authorization.error },
      authorization.error === "unauthorized" ? 401 : 403,
    );
  }

  if (!isChatEnabledForOrganization(parsed.data.organizationId)) {
    return c.json({ error: "Chat is not enabled for this organization" }, 404);
  }

  const project = await withDeadline(
    authorization.context.prisma.projects.findUnique({
      where: {
        organizationId_name: {
          organizationId: parsed.data.organizationId,
          name: parsed.data.projectName,
        },
      },
      select: { id: true },
    }),
    deadline,
  );
  if (!project) return c.json({ error: "Project not found" }, 404);

  let sanitized;
  try {
    sanitized = sanitizeChatMessages(parsed.data.messages);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Invalid messages" },
      400,
    );
  }

  const trace = await ChatTurnTrace.create({
    organizationId: parsed.data.organizationId,
    userId: authorization.user.id,
    projectName: parsed.data.projectName,
    conversationId: parsed.data.conversationId,
    turnId: sanitized.turnId,
    latestUserText: sanitized.latestUserText,
  });
  const feedbackToken = createChatFeedbackToken(
    {
      organizationId: parsed.data.organizationId,
      userId: authorization.user.id,
      projectName: parsed.data.projectName,
      conversationId: parsed.data.conversationId,
      turnId: sanitized.turnId,
      issuedAt: Date.now(),
    },
    env.BETTER_AUTH_SECRET,
  );
  try {
    trace.startRetrieval(parsed.data.projectName);
    const projectContext = await withDeadline(
      buildProjectChatContext(
        authorization.context.prisma,
        authorization.context.clickhouse,
        parsed.data,
      ),
      deadline,
    );
    trace.finishRetrieval(projectContext);

    trace.startGeneration({
      model: env.OPENAI_COMPATIBLE_MODEL!,
      maxOutputTokens: env.CHAT_MAX_OUTPUT_TOKENS,
      systemPrompt: projectContext.systemPrompt,
    });

    const result = streamText({
      model: getChatModel(),
      system: projectContext.systemPrompt,
      messages: await convertToModelMessages(sanitized.messages),
      maxOutputTokens: env.CHAT_MAX_OUTPUT_TOKENS,
      abortSignal: c.req.raw.signal,
      timeout: Math.max(1, deadline - Date.now()),
      onChunk: ({ chunk }) => {
        if (chunk.type === "text-delta") trace.recordFirstToken();
      },
      onEnd: ({ text, finishReason, usage }) => {
        trace.finishSuccess({
          text,
          finishReason,
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
          },
        });
      },
      onAbort: () => trace.finishError("request aborted", "WARNING"),
      onError: () => {
        trace.finishError("generation failed");
      },
    });

    return result.toUIMessageStreamResponse<ChatResponseMessage>({
      headers: {
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "X-Chat-Trace-Id": trace.traceId,
      },
      messageMetadata: ({ part }) =>
        part.type === "finish" ? { feedbackToken } : undefined,
    });
  } catch (error) {
    trace.finishError("chat request failed");
    throw error;
  }
});

routes.post("/feedback", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = feedbackSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid feedback" }, 400);
  const claims = verifyChatFeedbackToken(
    parsed.data.token,
    env.BETTER_AUTH_SECRET,
  );
  if (!claims) return c.json({ error: "Invalid feedback token" }, 400);

  const authorization = await authorizeOrganization(c, claims.organizationId);
  if ("error" in authorization) {
    return c.json(
      { error: authorization.error },
      authorization.error === "unauthorized" ? 401 : 403,
    );
  }
  if (authorization.user.id !== claims.userId) {
    return c.json({ error: "forbidden" }, 403);
  }
  if (!isChatEnabledForOrganization(claims.organizationId)) {
    return c.json({ error: "Chat is not enabled for this organization" }, 404);
  }

  const project = await authorization.context.prisma.projects.findUnique({
    where: {
      organizationId_name: {
        organizationId: claims.organizationId,
        name: claims.projectName,
      },
    },
    select: { id: true },
  });
  if (!project) return c.json({ error: "Project not found" }, 404);

  try {
    const delivered = await submitChatFeedback({
      ...claims,
      value: parsed.data.value,
      comment: parsed.data.comment,
    });
    return c.json({ delivered });
  } catch (error) {
    console.warn("[chat] feedback delivery failed", {
      error: error instanceof Error ? error.message : "unknown error",
    });
    return c.json({ error: "Feedback could not be delivered" }, 503);
  }
});

export default routes;
