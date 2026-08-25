// Python Panels — sandboxed stlite iframe lifecycle.
//
// Renders the /stlite/panel-host.html host page in an
// <iframe sandbox="allow-scripts"> (opaque origin: no cookies, no
// storage, network fenced by CSP). Boot is lazy (IntersectionObserver),
// the ready→init handshake delivers the user code + mlop SDK + host
// context, and usePanelBridge services the panel's data RPCs.

import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import { AlertTriangleIcon, Loader2Icon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  PANEL_BRIDGE_VERSION,
  createBridgeToken,
  type PanelContext,
  type ParentToPanelMessage,
} from "@/lib/panels/panel-bridge-protocol";
import type { PanelHostContext } from "@/lib/panels/panel-bridge-allowlist";
import mlopSdkSource from "@/lib/panels/mlop_sdk.py?raw";
import { usePanelBridge, type PanelStatusPhase } from "./use-panel-bridge";

export interface PanelSandboxHandle {
  /**
   * Re-execute the panel script inside the live kernel (~2s, no reboot).
   * Pass `code` to replace the running script first — the panel editor's
   * fast Run path.
   */
  rerun: (code?: string) => void;
}

interface PanelSandboxProps {
  code: string;
  requirements: string[];
  context: PanelContext;
  className?: string;
  /**
   * Observe boot/run lifecycle transitions (mirrors the internal phase
   * state, including the pre-boot "waiting" phase). Used by the panel
   * editor's status bar; rendering widgets can ignore it.
   */
  onPhaseChange?: (phase: SandboxPhase, detail?: string) => void;
  ref?: Ref<PanelSandboxHandle>;
}

export type SandboxPhase = "waiting" | PanelStatusPhase;

export function PanelSandbox({
  code,
  requirements,
  context,
  className,
  onPhaseChange,
  ref,
}: PanelSandboxProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const initSentRef = useRef(false);

  const [shouldBoot, setShouldBoot] = useState(false);
  const [bootAttempt, setBootAttempt] = useState(0);
  const [phase, setPhase] = useState<SandboxPhase>("waiting");
  const [hasBooted, setHasBooted] = useState(false);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  // Fresh per-boot secret; a retry gets a new iframe AND a new token.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- bootAttempt intentionally forces a new token per boot
  const token = useMemo(() => createBridgeToken(), [bootAttempt]);

  const propsRef = useRef({ code, requirements, context, onPhaseChange });
  propsRef.current = { code, requirements, context, onPhaseChange };

  const transitionPhase = (nextPhase: SandboxPhase, detail?: string) => {
    setPhase(nextPhase);
    propsRef.current.onPhaseChange?.(nextPhase, detail);
  };
  const transitionPhaseRef = useRef(transitionPhase);
  transitionPhaseRef.current = transitionPhase;

  const hostCtx = useMemo<PanelHostContext>(
    () => ({
      organizationId: context.organizationId,
      projectName: context.projectName,
      selectedRunIds: context.runs.map((run) => run.id),
    }),
    [context],
  );

  const postToPanel = (message: ParentToPanelMessage) => {
    iframeRef.current?.contentWindow?.postMessage(message, "*");
  };
  const postToPanelRef = useRef(postToPanel);
  postToPanelRef.current = postToPanel;

  usePanelBridge({
    token,
    hostCtx,
    getIframeWindow: () => iframeRef.current?.contentWindow ?? null,
    onReady: () => {
      // Always answer `ready` with init — a re-fired ready means the
      // host page reloaded and needs the code/context again.
      const current = propsRef.current;
      postToPanel({
        mlop: PANEL_BRIDGE_VERSION,
        type: "init",
        token,
        code: current.code,
        requirements: current.requirements,
        sdk: mlopSdkSource,
        context: current.context,
      });
      initSentRef.current = true;
      transitionPhase("loading-runtime");
    },
    onStatus: (statusPhase, detail) => {
      transitionPhase(statusPhase, detail);
      if (statusPhase === "error") {
        setErrorDetail(detail ?? "Unknown sandbox error");
      } else if (statusPhase === "done") {
        setHasBooted(true);
      }
    },
  });

  // Lazy boot: don't spend ~100MB of Pyodide on off-screen panels.
  useEffect(() => {
    if (shouldBoot) {
      return;
    }
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setShouldBoot(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShouldBoot(true);
        observer.disconnect();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldBoot]);

  // Keep the panel's context file current (run selection, theme, size).
  const contextSignature = useMemo(() => JSON.stringify(context), [context]);
  useEffect(() => {
    if (initSentRef.current) {
      postToPanelRef.current({
        mlop: PANEL_BRIDGE_VERSION,
        type: "context-update",
        context: propsRef.current.context,
      });
    }
  }, [contextSignature]);

  // Best-effort dispose so the host page can unmount its kernel before
  // the iframe is torn down.
  useEffect(() => {
    return () => {
      postToPanelRef.current({ mlop: PANEL_BRIDGE_VERSION, type: "dispose" });
    };
  }, [bootAttempt]);

  useImperativeHandle(
    ref,
    () => ({
      rerun: (nextCode?: string) => {
        postToPanelRef.current({
          mlop: PANEL_BRIDGE_VERSION,
          type: "rerun",
          code: nextCode,
        });
      },
    }),
    [],
  );

  const retry = () => {
    initSentRef.current = false;
    setErrorDetail(null);
    transitionPhaseRef.current("waiting");
    setHasBooted(false);
    setBootAttempt((attempt) => attempt + 1);
  };

  const hasError = errorDetail !== null;
  const showSkeleton = !hasError && !hasBooted;

  return (
    <div
      ref={containerRef}
      data-testid="panel-sandbox"
      className={cn("relative h-full w-full overflow-hidden", className)}
    >
      {shouldBoot && !hasError && (
        <iframe
          key={bootAttempt}
          ref={iframeRef}
          src={`/stlite/panel-host.html#t=${token}`}
          sandbox="allow-scripts"
          title="Python panel sandbox"
          data-testid="panel-sandbox-iframe"
          className="h-full w-full border-0"
        />
      )}
      {showSkeleton && (
        <div
          data-testid="panel-sandbox-loading"
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-card"
        >
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">{PHASE_LABELS[phase]}</p>
        </div>
      )}
      {hasError && (
        <div
          data-testid="panel-sandbox-error"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card p-4"
        >
          <AlertTriangleIcon className="size-5 text-destructive" />
          <p className="text-sm font-medium">Panel failed to load</p>
          <p className="max-h-24 max-w-full overflow-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">
            {errorDetail}
          </p>
          <Button variant="outline" size="sm" onClick={retry}>
            <RotateCcwIcon className="mr-1.5 size-3.5" />
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

const PHASE_LABELS: Record<SandboxPhase, string> = {
  waiting: "Preparing sandbox…",
  "loading-runtime": "Loading Python runtime…",
  installing: "Installing packages…",
  running: "Running panel…",
  done: "",
  error: "",
};
