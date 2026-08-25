// Comet-style two-pane editor for Python panel widgets: code + settings
// on the left, the live PanelSandbox preview on the right, Run/status
// on the bottom bar. Full-screen dialog following ChartFullscreenDialog.
//
// Run semantics: EXPLICIT runs only, never on keystroke. The first Run
// boots the sandbox with the draft code; later Runs use the fast rerun
// path (rewrite panel_code.py inside the live kernel, ~2s) unless the
// requirements changed, which forces a fresh kernel boot (packages
// install at mount). Save is soft-guarded behind one successful run.

import { useCallback, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CodeEditor } from "@/components/ui/code-editor";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type {
  PanelSandboxHandle,
  SandboxPhase,
} from "@/components/panels/panel-sandbox";
import {
  formatRequirements,
  parseRequirements,
  requirementsEqual,
  validateRequirements,
} from "@/lib/panels/panel-requirements";
import type { PanelTemplate } from "@/lib/panels/panel-templates";
import type { PanelWidgetConfig } from "../../~types/dashboard-types";
import type { SelectedRunWithColor } from "../../~hooks/use-selected-runs";
import {
  PanelEditorPreview,
  type PanelEditorBootConfig,
} from "./panel-editor-preview";
import {
  PanelDiscardConfirmDialog,
  PanelEditorStatusBar,
} from "./panel-editor-status-bar";
import { PanelTemplateMenu } from "./panel-template-menu";

/** Server-enforced cap on panel code size (PanelWidgetConfigSchema). */
const MAX_CODE_LENGTH = 65_536;

interface PanelEditorDialogProps {
  /** Seed config: the starter template for adds, the widget's config for edits. */
  initialConfig: PanelWidgetConfig;
  /** True when editing an existing widget (affects labels only). */
  isEditing: boolean;
  onSave: (config: PanelWidgetConfig) => void;
  onClose: () => void;
  selectedRuns: Record<string, SelectedRunWithColor>;
  organizationId: string;
  projectName: string;
}

export function PanelEditorDialog({
  initialConfig,
  isEditing,
  onSave,
  onClose,
  selectedRuns,
  organizationId,
  projectName,
}: PanelEditorDialogProps) {
  // ── Draft state (reset per mount — the parent unmounts us on close) ──
  const [title, setTitle] = useState(initialConfig.title ?? "");
  const [code, setCode] = useState(initialConfig.code);
  const [requirementsText, setRequirementsText] = useState(() =>
    formatRequirements(initialConfig.requirements),
  );
  const [autoRun, setAutoRun] = useState(initialConfig.autoRunOnRunChange);
  const [validationError, setValidationError] = useState<string | null>(null);

  // ── Run state ────────────────────────────────────────────────────────
  const sandboxRef = useRef<PanelSandboxHandle>(null);
  const [bootConfig, setBootConfig] = useState<PanelEditorBootConfig | null>(
    null,
  );
  const [phase, setPhase] = useState<SandboxPhase | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [hasSuccessfulRun, setHasSuccessfulRun] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const handlePhaseChange = useCallback(
    (nextPhase: SandboxPhase, detail?: string) => {
      setPhase(nextPhase);
      if (nextPhase === "error") {
        setErrorDetail(detail ?? "Unknown sandbox error");
      } else {
        setErrorDetail(null);
        if (nextPhase === "done") {
          setHasSuccessfulRun(true);
          setLastRunAt(Date.now());
        }
      }
    },
    [],
  );

  const handleRun = useCallback(() => {
    // The Run button is disabled while the sandbox is busy, but the
    // Cmd/Ctrl+Enter hotkey bypasses it — enforce the same gate here so
    // a rerun can't race a boot/install in flight.
    if (phase !== null && phase !== "done" && phase !== "error") {
      return;
    }
    const requirements = parseRequirements(requirementsText);
    const error = validateRequirements(requirements) ?? validateCode(code);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    if (!bootConfig) {
      // First run: mount + boot the sandbox with the draft code.
      setPhase("waiting");
      setBootConfig({ code, requirements, bootId: 0 });
      return;
    }
    if (!requirementsEqual(requirements, bootConfig.requirements)) {
      // Requirements install at kernel mount — force a fresh boot.
      setPhase("waiting");
      setBootConfig({ code, requirements, bootId: bootConfig.bootId + 1 });
      return;
    }
    // Fast path: rewrite the script inside the live kernel (~2s).
    sandboxRef.current?.rerun(code);
    // Keep the boot snapshot current so a host-page reload (re-fired
    // ready → init) would deliver the latest run code.
    setBootConfig({ ...bootConfig, code });
  }, [code, requirementsText, phase, bootConfig]);

  // ── Dirty tracking / close flow ──────────────────────────────────────
  const isDirty = useMemo(() => {
    return (
      title !== (initialConfig.title ?? "") ||
      code !== initialConfig.code ||
      autoRun !== initialConfig.autoRunOnRunChange ||
      !requirementsEqual(
        parseRequirements(requirementsText),
        initialConfig.requirements,
      )
    );
  }, [title, code, autoRun, requirementsText, initialConfig]);

  const attemptClose = useCallback(() => {
    if (isDirty) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  }, [isDirty, onClose]);

  // Template gallery: replace the DRAFT code + packages (dirty-confirm
  // handled inside PanelTemplateMenu). Never runs or saves by itself.
  const applyTemplate = useCallback((template: PanelTemplate) => {
    setCode(template.code);
    setRequirementsText(formatRequirements(template.requirements));
    setValidationError(null);
  }, []);

  const handleSave = useCallback(() => {
    const requirements = parseRequirements(requirementsText);
    const error = validateRequirements(requirements) ?? validateCode(code);
    if (error) {
      setValidationError(error);
      return;
    }
    onSave({
      ...initialConfig,
      title: title.trim() || undefined,
      code,
      requirements,
      autoRunOnRunChange: autoRun,
    });
  }, [requirementsText, code, title, autoRun, initialConfig, onSave]);

  const canSave = hasSuccessfulRun && code.trim().length > 0;

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (!open) {
          attemptClose();
        }
      }}
    >
      <DialogContent
        className="flex h-[90vh] max-w-[95vw] flex-col p-6 data-[state=open]:!animate-none"
        data-testid="panel-editor-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Python Panel" : "New Python Panel"}
          </DialogTitle>
          <DialogDescription>
            Write a Streamlit script against the <code>mlop</code> data
            bridge, Run to preview it against the selected runs, then save it
            to the dashboard.
          </DialogDescription>
        </DialogHeader>

        <ResizablePanelGroup
          orientation="horizontal"
          className="flex-1 min-h-0"
        >
          {/* react-resizable-panels v4: bare numbers are PIXELS — use
           *  percent strings for proportional sizing. */}
          <ResizablePanel defaultSize="50%" minSize="25%" className="min-w-0">
            <div className="flex h-full flex-col gap-3 pr-4">
              <div className="grid gap-1.5">
                <Label htmlFor="panel-editor-title">Title (optional)</Label>
                <Input
                  id="panel-editor-title"
                  placeholder="Enter panel title..."
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  data-testid="panel-editor-title"
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Code</Label>
                <PanelTemplateMenu isDirty={isDirty} onApply={applyTemplate} />
              </div>
              <CodeEditor
                value={code}
                onChange={setCode}
                language="python"
                onKeyRun={handleRun}
                className="flex-1"
              />
              <div className="grid gap-1.5">
                <Label htmlFor="panel-editor-requirements">
                  Packages{" "}
                  <span className="font-normal text-muted-foreground">
                    (comma-separated, installed via micropip)
                  </span>
                </Label>
                <Input
                  id="panel-editor-requirements"
                  placeholder="seaborn, plotly==5.22.0"
                  value={requirementsText}
                  onChange={(event) => setRequirementsText(event.target.value)}
                  data-testid="panel-editor-requirements"
                />
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Switch
                    id="panel-editor-autorun"
                    checked={autoRun}
                    onCheckedChange={setAutoRun}
                    data-testid="panel-editor-autorun"
                  />
                  <Label
                    htmlFor="panel-editor-autorun"
                    className="text-sm font-normal text-muted-foreground"
                  >
                    Re-run automatically when the selected runs change
                  </Label>
                </div>
                <p
                  className="pl-11 text-xs text-amber-600 dark:text-amber-500"
                  data-testid="panel-editor-autorun-warning"
                >
                  May cause a performance hit — the panel re-executes on every
                  run-selection change.
                </p>
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel minSize="25%" className="min-w-0">
            <div className="h-full pl-4">
              <PanelEditorPreview
                bootConfig={bootConfig}
                selectedRuns={selectedRuns}
                organizationId={organizationId}
                projectName={projectName}
                onPhaseChange={handlePhaseChange}
                sandboxRef={sandboxRef}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>

        <PanelEditorStatusBar
          phase={phase}
          errorDetail={errorDetail}
          validationError={validationError}
          lastRunAt={lastRunAt}
          canSave={canSave}
          isEditing={isEditing}
          onRun={handleRun}
          onCancel={attemptClose}
          onSave={handleSave}
        />
      </DialogContent>

      <PanelDiscardConfirmDialog
        open={showDiscardConfirm}
        onOpenChange={setShowDiscardConfirm}
        onConfirm={() => {
          setShowDiscardConfirm(false);
          onClose();
        }}
      />
    </Dialog>
  );
}

function validateCode(code: string): string | null {
  if (code.trim().length === 0) {
    return "Panel code is empty.";
  }
  if (code.length > MAX_CODE_LENGTH) {
    return `Panel code is too large (${code.length.toLocaleString()} chars) — the limit is ${MAX_CODE_LENGTH.toLocaleString()}.`;
  }
  return null;
}
