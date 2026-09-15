import { useChat } from "@ai-sdk/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DefaultChatTransport } from "ai";
import {
  CircleStopIcon,
  MessageSquareTextIcon,
  PlusIcon,
  SendIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import DashboardLayout from "@/components/layout/dashboard/layout";
import PageLayout from "@/components/layout/page-layout";
import { OrganizationPageTitle } from "@/components/layout/page-title";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { ChatMessageItem } from "@/components/chat/chat-message-item";
import { type ChatMessage, type ChatMode } from "@/components/chat/chat-types";
import { LocalAgentConnect } from "@/components/chat/local-agent-connect";
import { getChatApiUrl, useChatConfig } from "@/lib/chat-api";
import {
  getLocalBridgeUrl,
  type LocalBridgeSettings,
} from "@/lib/local-bridge";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useLocalBridge } from "@/hooks/use-local-bridge";
import { trpc } from "@/utils/trpc";

export const Route = createFileRoute("/o/$orgSlug/_authed/chat")({
  component: RouteComponent,
});

function ChatWorkspace({
  organizationId,
  orgSlug,
  projectName,
  conversationId,
  mode,
  bridgeSettings,
}: {
  organizationId: string;
  orgSlug: string;
  projectName: string;
  conversationId: string;
  mode: ChatMode;
  bridgeSettings: LocalBridgeSettings | null;
}) {
  const [input, setInput] = useState("");
  const [ratings, setRatings] = useState<Record<string, boolean>>({});
  const [pendingRating, setPendingRating] = useState<string>();
  const endRef = useRef<HTMLDivElement>(null);
  const bridgePort = bridgeSettings?.port;
  const bridgeToken = bridgeSettings?.token;
  const transport = useMemo(() => {
    // Turns with no text are dropped. Stop, and a generation that fails
    // before its first token, both leave an assistant turn behind with no
    // text parts — and sanitizeChatMessages rejects any empty message, so
    // forwarding one bricks the thread: every later send 400s until the user
    // starts a New chat.
    const textOnly = (messages: ChatMessage[]) =>
      messages
        .map((message) => ({
          id: message.id,
          role: message.role,
          parts: message.parts
            .filter((part) => part.type === "text")
            .map((part) => ({ type: "text", text: part.text })),
        }))
        .filter((message) =>
          message.parts.some((part) => part.text.trim().length > 0),
        );
    if (mode === "local" && bridgePort && bridgeToken) {
      // The user's own loopback bridge (Claude Code / Codex) answers; it
      // pulls data itself through the pluto MCP server.
      return new DefaultChatTransport<ChatMessage>({
        api: getLocalBridgeUrl(bridgePort, "/chat"),
        headers: { "x-bridge-token": bridgeToken },
        prepareSendMessagesRequest: ({ id, messages }) => ({
          body: {
            orgSlug,
            projectName,
            conversationId: id,
            messages: textOnly(messages),
          },
        }),
      });
    }
    return new DefaultChatTransport<ChatMessage>({
      api: getChatApiUrl(),
      credentials: "include",
      prepareSendMessagesRequest: ({ id, messages }) => ({
        body: {
          organizationId,
          projectName,
          conversationId: id,
          messages: textOnly(messages),
        },
      }),
    });
  }, [mode, bridgePort, bridgeToken, organizationId, orgSlug, projectName]);
  const { messages, sendMessage, status, stop, error } = useChat<ChatMessage>({
    id: conversationId,
    transport,
  });
  const isGenerating = status === "submitted" || status === "streaming";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || isGenerating) return;
    setInput("");
    await sendMessage({ text });
  }

  async function submitFeedback(token: string, value: boolean) {
    if (pendingRating || token in ratings) return;
    setPendingRating(token);
    try {
      const response = await fetch(getChatApiUrl("/feedback"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          value,
        }),
      });
      if (!response.ok) throw new Error("Feedback could not be delivered");
      const result = (await response.json()) as { delivered: boolean };
      if (!result.delivered)
        throw new Error("Langfuse feedback is not configured");
      setRatings((current) => ({ ...current, [token]: value }));
      toast.success("Thanks for the feedback");
    } catch (feedbackError) {
      toast.error(
        feedbackError instanceof Error
          ? feedbackError.message
          : "Feedback could not be delivered",
      );
    } finally {
      setPendingRating(undefined);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-6 sm:px-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {messages.length === 0 && (
            <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
              <div className="rounded-full bg-primary/10 p-3 text-primary">
                <MessageSquareTextIcon className="size-6" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">
                  Ask about {projectName}
                </h2>
                <p className="max-w-md text-sm text-muted-foreground">
                  {mode === "local"
                    ? "Answers come from your local agent, which queries this project through the pluto MCP tools."
                    : "Answers use a bounded snapshot of the 12 most recently updated runs and up to 240 metric summaries."}
                </p>
              </div>
            </div>
          )}

          {messages.map((message) => {
            const feedbackToken = message.metadata?.feedbackToken;
            return (
              <ChatMessageItem
                key={message.id}
                message={message}
                orgSlug={orgSlug}
                projectName={projectName}
                rating={feedbackToken ? ratings[feedbackToken] : undefined}
                feedbackDisabled={
                  Boolean(pendingRating) ||
                  Boolean(feedbackToken && feedbackToken in ratings)
                }
                onFeedback={(token, value) => void submitFeedback(token, value)}
              />
            );
          })}
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error.message}
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t bg-background p-4">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-3xl items-end gap-2"
        >
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={`Ask about ${projectName}…`}
            rows={2}
            maxLength={8_000}
            disabled={isGenerating}
            className="max-h-40 min-h-16 resize-none"
          />
          {isGenerating ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => void stop()}
              aria-label="Stop response"
            >
              <CircleStopIcon className="size-4" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim()}
              aria-label="Send message"
            >
              <SendIcon className="size-4" />
            </Button>
          )}
        </form>
        <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-muted-foreground">
          {mode === "local"
            ? "Verify important conclusions against the cited runs. Conversations stay on your machine."
            : "Verify important conclusions against the cited runs. Chat history is not retained in this preview."}
        </p>
      </div>
    </div>
  );
}

function RouteComponent() {
  const { orgSlug } = Route.useParams();
  const { auth } = Route.useRouteContext();
  const organizationId = auth.activeOrganization.id;
  const { data: chatConfig, isLoading: isConfigLoading } =
    useChatConfig(organizationId);
  const { data: projectData, isLoading: isProjectsLoading } = useQuery({
    ...trpc.projects.list.queryOptions({
      organizationId,
      limit: 100,
      includeNRuns: 0,
      cursor: 0,
      direction: "forward",
    }),
  });
  const [projectName, setProjectName] = useState<string>();
  const [conversationId, setConversationId] = useState(() =>
    crypto.randomUUID(),
  );
  const bridge = useLocalBridge();
  const serverEnabled = Boolean(chatConfig?.enabled);
  const [modeChoice, setModeChoice] = useState<ChatMode>();
  const mode: ChatMode = modeChoice ?? (serverEnabled ? "server" : "local");
  useDocumentTitle("Chat");

  useEffect(() => {
    if (!projectName && projectData?.projects[0]) {
      setProjectName(projectData.projects[0].name);
    }
  }, [projectData, projectName]);

  const newChat = () => setConversationId(crypto.randomUUID());

  return (
    <DashboardLayout>
      <PageLayout
        disableScroll
        headerLeft={<OrganizationPageTitle title="Chat" />}
        headerRight={
          <div className="flex items-center gap-2">
            <Select
              value={mode}
              onValueChange={(value) => {
                setModeChoice(value as ChatMode);
                setConversationId(crypto.randomUUID());
              }}
            >
              <SelectTrigger className="w-36" aria-label="Chat backend">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="server" disabled={!serverEnabled}>
                  Server model
                </SelectItem>
                <SelectItem value="local">Local agent</SelectItem>
              </SelectContent>
            </Select>
            {mode === "local" && <LocalAgentConnect bridge={bridge} />}
            <Select
              value={projectName}
              onValueChange={(value) => {
                setProjectName(value);
                setConversationId(crypto.randomUUID());
              }}
              disabled={isProjectsLoading || !projectData?.projects.length}
            >
              <SelectTrigger className="w-40 sm:w-56" aria-label="Project">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {projectData?.projects.map((project) => (
                  <SelectItem key={project.id.toString()} value={project.name}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={newChat}
              disabled={!projectName}
            >
              <PlusIcon className="mr-1 size-4" />
              New chat
            </Button>
          </div>
        }
      >
        <div className="flex h-full min-h-0 flex-col">
          {isConfigLoading || isProjectsLoading ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Loading chat…
            </div>
          ) : mode === "server" && !serverEnabled ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <MessageSquareTextIcon className="size-8 text-muted-foreground" />
              <h2 className="font-semibold">Chat is not enabled</h2>
              <p className="max-w-md text-sm text-muted-foreground">
                This organization is not part of the private preview, or the
                model endpoint is not configured. You can still switch to “Local
                agent” and answer with your own Claude Code or Codex.
              </p>
            </div>
          ) : mode === "local" &&
            !bridge.isConnected &&
            !bridge.hasConnected ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <MessageSquareTextIcon className="size-8 text-muted-foreground" />
              <h2 className="font-semibold">Connect your local agent</h2>
              <p className="max-w-md text-sm text-muted-foreground">
                Run{" "}
                <code className="rounded bg-muted px-1 py-0.5">
                  pnpm --filter @mlop/agent-bridge start
                </code>{" "}
                on your machine, then use “Connect agent” above to pair the port
                and token it prints.
                {bridge.settings && !bridge.isProbing
                  ? " The saved bridge is not reachable right now."
                  : ""}
              </p>
            </div>
          ) : !projectName ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <h2 className="font-semibold">Create a project first</h2>
              <p className="text-sm text-muted-foreground">
                Chat needs a project with experiment runs to analyze.
              </p>
            </div>
          ) : (
            <>
              {mode === "local" && !bridge.isConnected ? (
                // The bridge stopped answering, but the conversation is still
                // here. Unmounting the workspace would discard it — chat
                // history is in-memory only — so a dropped probe is a banner,
                // not a teardown.
                <div className="border-b bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
                  Lost contact with the local agent bridge. Your conversation is
                  still here; restart{" "}
                  <code className="rounded bg-muted px-1 py-0.5">
                    pnpm --filter @mlop/agent-bridge start
                  </code>{" "}
                  and it will reconnect automatically.
                </div>
              ) : null}
              <ChatWorkspace
                key={`${mode}:${projectName}:${conversationId}`}
                organizationId={organizationId}
                orgSlug={orgSlug}
                projectName={projectName}
                conversationId={conversationId}
                mode={mode}
                bridgeSettings={bridge.settings}
              />
            </>
          )}
        </div>
      </PageLayout>
    </DashboardLayout>
  );
}
