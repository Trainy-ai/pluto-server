// Right pane of the Python panel editor: the live sandbox preview.
//
// Nothing is booted until the user's first explicit Run (bootConfig
// stays null and a hint placeholder renders instead) — Pyodide costs
// ~100MB, so no speculative boots. After the first Run the sandbox
// stays alive for fast reruns; a bootId bump remounts it (fresh kernel)
// when the requirements change.

import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import { useParams } from "@tanstack/react-router";
import { PlayIcon } from "lucide-react";
import { useTheme } from "@/lib/hooks/use-theme";
import {
  PanelSandbox,
  type PanelSandboxHandle,
  type SandboxPhase,
} from "@/components/panels/panel-sandbox";
import type { PanelContext } from "@/lib/panels/panel-bridge-protocol";
import type { SelectedRunWithColor } from "../../~hooks/use-selected-runs";

/** Debounce for ResizeObserver → context updates while pane-resizing. */
const RESIZE_DEBOUNCE_MS = 300;

export interface PanelEditorBootConfig {
  code: string;
  requirements: string[];
  /** Remount discriminator — bump to force a fresh kernel boot. */
  bootId: number;
}

interface PanelEditorPreviewProps {
  /** null until the first explicit Run. */
  bootConfig: PanelEditorBootConfig | null;
  selectedRuns: Record<string, SelectedRunWithColor>;
  organizationId: string;
  projectName: string;
  onPhaseChange: (phase: SandboxPhase, detail?: string) => void;
  sandboxRef: Ref<PanelSandboxHandle>;
}

export function PanelEditorPreview({
  bootConfig,
  selectedRuns,
  organizationId,
  projectName,
  onPhaseChange,
  sandboxRef,
}: PanelEditorPreviewProps) {
  const { orgSlug } = useParams({ strict: false });
  const { resolvedTheme } = useTheme();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) {
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        setDims({
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(node);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  const runs = useMemo(
    () =>
      Object.entries(selectedRuns).map(([runId, { run, color }]) => ({
        id: runId,
        name: run.name,
        color,
      })),
    [selectedRuns],
  );

  const context = useMemo<PanelContext>(
    () => ({
      projectName,
      orgSlug: orgSlug ?? "",
      organizationId,
      theme: resolvedTheme,
      runs,
      panel: dims,
    }),
    [projectName, orgSlug, organizationId, resolvedTheme, runs, dims],
  );

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-card"
      data-testid="panel-editor-preview"
    >
      {bootConfig ? (
        <PanelSandbox
          key={bootConfig.bootId}
          ref={sandboxRef}
          code={bootConfig.code}
          requirements={bootConfig.requirements}
          context={context}
          onPhaseChange={onPhaseChange}
        />
      ) : (
        <div
          className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center"
          data-testid="panel-editor-preview-placeholder"
        >
          <PlayIcon className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">Run to preview</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Press Run (or Cmd/Ctrl+Enter in the editor) to boot the Python
            runtime and render your panel against the selected runs.
          </p>
        </div>
      )}
    </div>
  );
}
