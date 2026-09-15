import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Server } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { buildSystemPrompt, buildTurnPrompt } from "./prompt";
import type { AgentRunner, BridgeChatRequest, BridgeMessage } from "./types";
import { DONE_EVENT, encodeUiChunk, UI_STREAM_HEADERS } from "./ui-stream";

export interface BridgeServerOptions {
  token: string;
  runner: AgentRunner;
}

export interface BridgeServer {
  server: Server;
  /** conversationId -> agent-native session id, for multi-turn resume. */
  sessions: Map<string, string>;
}

const MAX_BODY_BYTES = 512 * 1024;

function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function extractToken(request: IncomingMessage): string | undefined {
  const header = request.headers["x-bridge-token"];
  if (typeof header === "string" && header) return header;
  const auth = request.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length);
  return undefined;
}

function applyCors(request: IncomingMessage, response: ServerResponse): void {
  const origin = request.headers.origin;
  // The token is the actual gate; reflecting the origin lets any mlop
  // deployment (localhost or hosted) talk to the user's own bridge.
  if (origin) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "Origin");
  }
}

function handlePreflight(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  applyCors(request, response);
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader(
    "access-control-allow-headers",
    "content-type, x-bridge-token, authorization",
  );
  response.setHeader("access-control-max-age", "600");
  // Chrome's Private Network Access preflight for public-site -> localhost.
  if (request.headers["access-control-request-private-network"] === "true") {
    response.setHeader("access-control-allow-private-network", "true");
  }
  response.writeHead(204).end();
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function normalizeMessages(raw: unknown): BridgeMessage[] {
  if (!Array.isArray(raw)) throw new Error("messages must be an array");
  return raw.map((entry) => {
    const message = entry as {
      role?: string;
      text?: string;
      parts?: Array<{ type?: string; text?: string }>;
    };
    if (message.role !== "user" && message.role !== "assistant") {
      throw new Error("Unsupported message role");
    }
    const text =
      typeof message.text === "string"
        ? message.text
        : (message.parts ?? [])
            .filter(
              (part) => part.type === "text" && typeof part.text === "string",
            )
            .map((part) => part.text)
            .join("");
    return { role: message.role, text };
  });
}

function parseChatRequest(body: string): BridgeChatRequest {
  const parsed = JSON.parse(body) as Record<string, unknown>;
  const { conversationId, orgSlug, projectName } = parsed;
  if (
    typeof conversationId !== "string" ||
    typeof orgSlug !== "string" ||
    typeof projectName !== "string" ||
    !conversationId ||
    !orgSlug ||
    !projectName
  ) {
    throw new Error("conversationId, orgSlug and projectName are required");
  }
  const messages = normalizeMessages(parsed.messages);
  if (messages.length === 0) throw new Error("messages must not be empty");
  return { conversationId, orgSlug, projectName, messages };
}

function json(
  response: ServerResponse,
  status: number,
  payload: unknown,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function handleChat(
  options: BridgeServerOptions,
  sessions: Map<string, string>,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  let chat: BridgeChatRequest;
  try {
    chat = parseChatRequest(await readBody(request));
  } catch (error) {
    json(response, 400, {
      error: error instanceof Error ? error.message : "Invalid chat request",
    });
    return;
  }

  const abort = new AbortController();
  response.on("close", () => {
    // Fires after a normal end too; only treat it as a client disconnect
    // while the stream is still open.
    if (!response.writableEnded) abort.abort();
  });

  const resumeSessionId = sessions.get(chat.conversationId);
  let prompt: string;
  try {
    prompt = buildTurnPrompt(chat.messages, Boolean(resumeSessionId));
  } catch (error) {
    json(response, 400, {
      error: error instanceof Error ? error.message : "Invalid messages",
    });
    return;
  }

  response.writeHead(200, UI_STREAM_HEADERS);
  response.write(encodeUiChunk({ type: "start" }));

  let openTextId: string | undefined;
  const endText = () => {
    if (openTextId) {
      response.write(encodeUiChunk({ type: "text-end", id: openTextId }));
      openTextId = undefined;
    }
  };

  try {
    for await (const event of options.runner.runTurn({
      prompt,
      systemPrompt: buildSystemPrompt(chat),
      resumeSessionId,
      signal: abort.signal,
    })) {
      if (event.type === "session") {
        sessions.set(chat.conversationId, event.sessionId);
      } else if (event.type === "text") {
        if (!openTextId) {
          openTextId = randomUUID();
          response.write(encodeUiChunk({ type: "text-start", id: openTextId }));
        }
        response.write(
          encodeUiChunk({ type: "text-delta", id: openTextId, delta: event.text }),
        );
      } else if (event.type === "done") {
        endText();
        if (event.isError) {
          response.write(
            encodeUiChunk({
              type: "error",
              errorText: event.errorText ?? "The local agent failed",
            }),
          );
        }
        break;
      }
    }
    endText();
    response.write(encodeUiChunk({ type: "finish" }));
  } catch (error) {
    endText();
    if (!abort.signal.aborted) {
      response.write(
        encodeUiChunk({
          type: "error",
          errorText:
            error instanceof Error ? error.message : "The local agent failed",
        }),
      );
      response.write(encodeUiChunk({ type: "finish" }));
    }
  } finally {
    response.write(DONE_EVENT);
    response.end();
  }
}

export function createBridgeServer(options: BridgeServerOptions): BridgeServer {
  const sessions = new Map<string, string>();
  const server = createServer((request, response) => {
    if (request.method === "OPTIONS") {
      handlePreflight(request, response);
      return;
    }
    applyCors(request, response);

    if (!tokenMatches(extractToken(request), options.token)) {
      json(response, 401, { error: "Missing or invalid bridge token" });
      return;
    }

    const path = (request.url ?? "").split("?")[0];
    if (request.method === "GET" && path === "/health") {
      json(response, 200, { ok: true, agent: options.runner.name });
      return;
    }
    if (request.method === "POST" && path === "/chat") {
      void handleChat(options, sessions, request, response).catch(() => {
        if (!response.headersSent) {
          json(response, 500, { error: "Bridge error" });
        } else {
          response.end();
        }
      });
      return;
    }
    json(response, 404, { error: "Not found" });
  });

  return { server, sessions };
}
