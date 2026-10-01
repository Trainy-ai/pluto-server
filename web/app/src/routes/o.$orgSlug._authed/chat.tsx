import { useChat } from "@ai-sdk/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { MessageSquareTextIcon, PlusIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { ChatThread } from "@/components/chat/chat-thread";
import { type ChatMessage, type ChatMode } from "@/components/chat/chat-types";
import { LocalAgentConnect } from "@/components/chat/local-agent-connect";
import { useChatConfig } from "@/lib/chat-api";
import { createChatTransport } from "@/lib/chat-transport";
import {
  getLocalBridgeCommand,
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
  const bridgePort = bridgeSettings?.port;
  const bridgeToken = bridgeSettings?.token;
  const transport = useMemo(
    () =>
      createChatTransport({
        mode,
        bridgeSettings:
          bridgePort && bridgeToken
            ? { port: bridgePort, token: bridgeToken }
            : null,
        organizationId,
        orgSlug,
        projectName,
      }),
    [mode, bridgePort, bridgeToken, organizationId, orgSlug, projectName],
  );
  const { messages, sendMessage, status, stop, error } = useChat<ChatMessage>({
    id: conversationId,
    transport,
  });
  const isGenerating = status === "submitted" || status === "streaming";

  return (
    <ChatThread
      messages={messages}
      isGenerating={isGenerating}
      error={error}
      orgSlug={orgSlug}
      projectName={projectName}
      onSend={(text) => sendMessage({ text })}
      onStop={() => void stop()}
      placeholder={`Ask about ${projectName}…`}
      footerNote={
        mode === "local"
          ? "Verify important conclusions against the cited runs. Conversations stay on your machine."
          : "Verify important conclusions against the cited runs. Chat history is not retained in this preview."
      }
      emptyState={
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
          <div className="rounded-full bg-primary/10 p-3 text-primary">
            <MessageSquareTextIcon className="size-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Ask about {projectName}</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {mode === "local"
                ? "Answers come from your local agent, which queries this project through the pluto MCP tools."
                : "Answers use a bounded snapshot of the 12 most recently updated runs and up to 240 metric summaries."}
            </p>
          </div>
        </div>
      }
    />
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
  const bridgeCommand = getLocalBridgeCommand(window.location.origin);
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
                  {bridgeCommand}
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
                    {bridgeCommand}
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
