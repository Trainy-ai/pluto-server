import { Chat } from "@ai-sdk/react";
import { generateId, type ChatTransport } from "ai";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import type { ChatMessage, ChatMode } from "@/components/chat/chat-types";
import type {
  ContextChipKey,
  CopilotPageContext,
} from "@/lib/copilot-page-context";

export const COPILOT_DEFAULT_WIDTH = 380;
export const COPILOT_MIN_WIDTH = 320;
export const COPILOT_MAX_WIDTH = 640;
const OPEN_KEY = "mlop.copilot.open";
const WIDTH_KEY = "mlop.copilot.width";

interface CopilotState {
  isOpen: boolean;
  width: number;
  pageContext: CopilotPageContext | null;
  excludedChips: ReadonlySet<ContextChipKey>;
  /** Explicit backend choice; `undefined` means "server if enabled". */
  modeChoice: ChatMode | undefined;
  /** Project used when the page publishes none (e.g. the org home page). */
  fallbackProject: string | undefined;
  chat: Chat<ChatMessage>;
}

interface CopilotActions {
  setOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setWidth: (width: number) => void;
  publishPageContext: (ctx: CopilotPageContext | null) => void;
  /** Leaves a context chip out of (or back into) what the model sees. */
  toggleChip: (key: ContextChipKey) => void;
  setModeChoice: (mode: ChatMode) => void;
  setFallbackProject: (projectName: string) => void;
  newConversation: () => void;
  /** The panel owns the bridge probe, so it supplies the live transport. */
  transportRef: { current: ChatTransport<ChatMessage> | null };
}

const CopilotStateContext = createContext<CopilotState | null>(null);
const CopilotActionsContext = createContext<CopilotActions | null>(null);

/**
 * App-wide copilot state. Lives above the per-page layouts so the open
 * panel, its width and — most importantly — the conversation survive
 * navigation: every route renders its own layout, so anything owned by the
 * panel itself would be torn down on each page change.
 *
 * State and actions are separate contexts. Pages only need the (stable)
 * actions to publish what is on screen, so the heavy project page does not
 * re-render when the conversation streams or the panel resizes.
 */
export function CopilotProvider({ children }: PropsWithChildren) {
  const [isOpen, setIsOpen] = useState(() => readStorage(OPEN_KEY) === "1");
  const [width, setWidthState] = useState(() =>
    clampWidth(Number(readStorage(WIDTH_KEY)) || COPILOT_DEFAULT_WIDTH),
  );
  const [pageContext, setPageContext] = useState<CopilotPageContext | null>(
    null,
  );
  const [excludedChips, setExcludedChips] = useState<
    ReadonlySet<ContextChipKey>
  >(() => new Set());
  const [modeChoice, setModeChoiceState] = useState<ChatMode>();
  const [fallbackProject, setFallbackProject] = useState<string>();
  // Not crypto.randomUUID(): it only exists in secure contexts, and the app
  // is also served over plain http (e.g. http://app:3000 in CI). The provider
  // wraps every authed page, so a throw here blanks the whole app.
  const [conversationId, setConversationId] = useState(() => generateId());
  const transportRef = useRef<ChatTransport<ChatMessage> | null>(null);

  const chat = useMemo(
    () =>
      new Chat<ChatMessage>({
        id: conversationId,
        // Delegates to whatever the panel installed at send time, so the
        // conversation keeps working when the bridge pairing, backend or
        // project changes underneath it.
        transport: {
          sendMessages: (options) => requireTransport(transportRef).sendMessages(options),
          reconnectToStream: (options) =>
            requireTransport(transportRef).reconnectToStream(options),
        },
      }),
    [conversationId],
  );
  // A replaced conversation (New conversation, backend switch) may still be
  // streaming; abandoning it would keep the request — and on the local
  // bridge, the agent process — running with nobody listening.
  useEffect(() => {
    return () => {
      void chat.stop();
    };
  }, [chat]);

  // Removed chips are a per-page decision: a new page starts with the full
  // context again.
  const contextKey = pageContext
    ? `${pageContext.page}:${pageContext.projectName}:${pageContext.page === "run" ? pageContext.runs?.[0]?.id : ""}`
    : "";
  useEffect(() => {
    setExcludedChips(new Set());
  }, [contextKey]);

  const setOpen = useCallback<CopilotActions["setOpen"]>((open) => {
    setIsOpen((prev) => {
      const next = typeof open === "function" ? open(prev) : open;
      writeStorage(OPEN_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  const setWidth = useCallback((next: number) => {
    const clamped = clampWidth(next);
    writeStorage(WIDTH_KEY, String(clamped));
    setWidthState(clamped);
  }, []);

  const actions = useMemo<CopilotActions>(
    () => ({
      setOpen,
      setWidth,
      publishPageContext: setPageContext,
      toggleChip: (key) =>
        setExcludedChips((prev) => {
          const next = new Set(prev);
          if (!next.delete(key)) next.add(key);
          return next;
        }),
      setModeChoice: (mode) => {
        setModeChoiceState(mode);
        setConversationId(generateId());
      },
      setFallbackProject,
      newConversation: () => setConversationId(generateId()),
      transportRef,
    }),
    [setOpen, setWidth],
  );

  const state = useMemo<CopilotState>(
    () => ({
      isOpen,
      width,
      pageContext,
      excludedChips,
      modeChoice,
      fallbackProject,
      chat,
    }),
    [isOpen, width, pageContext, excludedChips, modeChoice, fallbackProject, chat],
  );

  return (
    <CopilotActionsContext.Provider value={actions}>
      <CopilotStateContext.Provider value={state}>
        {children}
      </CopilotStateContext.Provider>
    </CopilotActionsContext.Provider>
  );
}

/** `null` outside the provider (e.g. auth pages), so callers can no-op. */
export function useCopilotState(): CopilotState | null {
  return useContext(CopilotStateContext);
}

export function useCopilotActions(): CopilotActions | null {
  return useContext(CopilotActionsContext);
}

/**
 * Tells the copilot what the current page shows. Pass a memoized value; the
 * context is withdrawn when the page unmounts.
 */
export function useCopilotPageContext(ctx: CopilotPageContext | null): void {
  const actions = useCopilotActions();
  const publish = actions?.publishPageContext;
  useEffect(() => {
    if (!publish) return;
    publish(ctx);
  }, [publish, ctx]);
  useEffect(() => {
    if (!publish) return;
    return () => publish(null);
  }, [publish]);
}

function requireTransport(ref: CopilotActions["transportRef"]) {
  if (!ref.current) {
    throw new Error("The copilot is not connected to a chat backend yet");
  }
  return ref.current;
}

function clampWidth(width: number): number {
  return Math.min(COPILOT_MAX_WIDTH, Math.max(COPILOT_MIN_WIDTH, Math.round(width)));
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode / blocked storage: the preference just isn't remembered.
  }
}
