// Lazily-loaded CodeMirror code editor.
//
// The CodeMirror bundle (~300KB) is only pulled in when an editor is
// actually shown (the Python panel editor dialog), so it never weighs
// on the initial app bundle. The implementation lives in
// code-editor-impl.tsx; this wrapper owns the lazy boundary and the
// loading fallback.

import { Suspense, lazy } from "react";
import { Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";

const CodeEditorImpl = lazy(() =>
  import("./code-editor-impl").then((module) => ({
    default: module.CodeEditorImpl,
  })),
);

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Syntax highlighting language. Only Python is bundled today. */
  language: "python";
  readOnly?: boolean;
  /** Invoked on Cmd/Ctrl+Enter inside the editor ("Run" hotkey). */
  onKeyRun?: () => void;
  className?: string;
}

export function CodeEditor({ className, ...props }: CodeEditorProps) {
  return (
    <div
      className={cn(
        "min-h-0 overflow-hidden rounded-md border bg-background",
        className,
      )}
      data-testid="code-editor"
    >
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Loading editor…
          </div>
        }
      >
        <CodeEditorImpl {...props} />
      </Suspense>
    </div>
  );
}
