import { useChat } from "@ai-sdk/react";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon, SparklesIcon, XIcon } from "lucide-react";
import { useLayoutEffect, useMemo } from "react";
import { ChatThread } from "@/components/chat/chat-thread";
import type { ChatMode } from "@/components/chat/chat-types";
import { LocalAgentConnect } from "@/components/chat/local-agent-connect";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocalBridge } from "@/hooks/use-local-bridge";
import { useAuth } from "@/lib/auth/client";
import { useChatConfig } from "@/lib/chat-api";
import { createChatTransport } from "@/lib/chat-transport";
import {
  formatPageContext,
  prependContextToLatestUserMessage,
  suggestedPrompts,
} from "@/lib/copilot-page-context";
import { getLocalBridgeCommand } from "@/lib/local-bridge";
import { trpc } from "@/utils/trpc";
import { CopilotContextChips } from "./copilot-context-chips";
import { useCopilotActions, useCopilotState } from "./copilot-provider";

/**
 * The copilot's contents: backend controls, the conversation, and the
 * context chips above the composer. Mounted only while the panel is open, so
 * the local-bridge health probe does not run on every page.
 */
export function CopilotPanel() {
  const state = useCopilotState()!;
  const actions = useCopilotActions()!;
  const { data: auth } = useAuth();
  const organizationId = auth?.activeOrganization?.id ?? "";
  const orgSlug = auth?.activeOrganization?.slug ?? "";
  const { data: chatConfig, isLoading: isConfigLoading } =
    useChatConfig(organizationId);
  const bridge = useLocalBridge();
  const serverEnabled = Boolean(chatConfig?.enabled);
  const mode: ChatMode =
    state.modeChoice ?? (serverEnabled ? "server" : "local");

  const { pageContext, excludedChips } = state;
  const { data: projectData } = useQuery({
    ...trpc.projects.list.queryOptions({
      organizationId,
      limit: 100,
      includeNRuns: 0,
      cursor: 0,
      direction: "forward",
    }),
    // Only needed to pick a project on pages that do not publish one.
    enabled: Boolean(organizationId) && !pageContext,
  });
  const projectName =
    pageContext?.projectName ??
    state.fallbackProject ??
    projectData?.projects[0]?.name;

  const preamble = useMemo(
    () => formatPageContext(pageContext, excludedChips),
    [pageContext, excludedChips],
  );

  const bridgePort = bridge.settings?.port;
  const bridgeToken = bridge.settings?.token;
  const transport = useMemo(
    () =>
      projectName
        ? createChatTransport({
            mode,
            bridgeSettings:
              bridgePort && bridgeToken
                ? { port: bridgePort, token: bridgeToken }
                : null,
            organizationId,
            orgSlug,
            projectName,
            // The preamble rides in the per-request body so it reflects the
            // screen at send time and never enters the visible transcript.
            transformMessages: (messages, body) =>
              prependContextToLatestUserMessage(
                messages,
                typeof body?.pageContext === "string" ? body.pageContext : null,
              ),
          })
        : null,
    [mode, bridgePort, bridgeToken, organizationId, orgSlug, projectName],
  );
  useLayoutEffect(() => {
    actions.transportRef.current = transport;
  }, [actions.transportRef, transport]);

  const { messages, sendMessage, status, stop, error } = useChat({
    chat: state.chat,
  });
  const isGenerating = status === "submitted" || status === "streaming";
  const send = (text: string) =>
    sendMessage({ text }, { body: { pageContext: preamble } });

  const bridgeCommand = getLocalBridgeCommand(window.location.origin);
  const needsBridge =
    mode === "local" && !bridge.isConnected && !bridge.hasConnected;
  const prompts = suggestedPrompts(pageContext, projectName);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="copilot-panel-body">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <SparklesIcon className="size-4 text-primary" />
        <span className="font-semibold">Copilot</span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={actions.newConversation}
            aria-label="New conversation"
            title="New conversation"
          >
            <PlusIcon className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => actions.setOpen(false)}
            aria-label="Close copilot"
            data-testid="copilot-close"
          >
            <XIcon className="size-4" />
          </Button>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <Select
          value={mode}
          onValueChange={(value) => actions.setModeChoice(value as ChatMode)}
        >
          <SelectTrigger className="h-8 w-32 text-xs" aria-label="Chat backend">
            <SelectValue />
          </SelectTrigger>
          <SelectContent data-tooltip-keep-pinned="">
            <SelectItem value="server" disabled={!serverEnabled}>
              Server model
            </SelectItem>
            <SelectItem value="local">Local agent</SelectItem>
          </SelectContent>
        </Select>
        {mode === "local" && <LocalAgentConnect bridge={bridge} />}
        {!pageContext && projectData && projectData.projects.length > 0 && (
          <Select
            value={projectName}
            onValueChange={actions.setFallbackProject}
          >
            <SelectTrigger className="h-8 w-40 text-xs" aria-label="Project">
              <SelectValue placeholder="Select a project" />
            </SelectTrigger>
            <SelectContent data-tooltip-keep-pinned="">
              {projectData.projects.map((project) => (
                <SelectItem key={project.id.toString()} value={project.name}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {isConfigLoading ? (
        <PanelMessage title="Loading…" />
      ) : mode === "server" && !serverEnabled ? (
        <PanelMessage
          title="Chat is not enabled"
          body="This organization is not part of the private preview. Switch to “Local agent” to answer with your own Claude Code or Codex."
        />
      ) : needsBridge ? (
        <PanelMessage
          title="Connect your local agent"
          body={
            <>
              Run{" "}
              <code className="rounded bg-muted px-1 py-0.5">{bridgeCommand}</code>{" "}
              on your machine, then use “Connect agent” above.
              {bridge.settings && !bridge.isProbing
                ? " The saved bridge is not reachable right now."
                : ""}
            </>
          }
        />
      ) : !projectName ? (
        <PanelMessage
          title="Create a project first"
          body="The copilot needs a project with experiment runs to analyze."
        />
      ) : (
        <>
          {mode === "local" && !bridge.isConnected && (
            <div className="border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Lost contact with the local agent bridge. Your conversation is
              still here and will continue once it reconnects.
            </div>
          )}
          <ChatThread
            variant="panel"
            messages={messages}
            isGenerating={isGenerating}
            error={error}
            orgSlug={orgSlug}
            projectName={projectName}
            onSend={send}
            onStop={() => void stop()}
            placeholder="Ask about what you're looking at…"
            footerNote="Verify important conclusions against the cited runs."
            composerHeader={
              pageContext && (
                <CopilotContextChips
                  ctx={pageContext}
                  excluded={excludedChips}
                  onToggleChip={actions.toggleChip}
                />
              )
            }
            emptyState={
              <div className="flex flex-col gap-2 pt-2">
                <p className="text-xs text-muted-foreground">
                  {pageContext
                    ? "The copilot sees what's on this page. Try:"
                    : `Ask about ${projectName}. Try:`}
                </p>
                {prompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void send(prompt)}
                    className="rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
                    data-testid="copilot-suggestion"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            }
          />
        </>
      )}
    </div>
  );
}

function PanelMessage({
  title,
  body,
}: {
  title: string;
  body?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <h2 className="text-sm font-semibold">{title}</h2>
      {body && <p className="text-xs text-muted-foreground">{body}</p>}
    </div>
  );
}
