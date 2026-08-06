import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SandboxedHtmlViewProps {
  /** The markup to render. Fetched by the caller — see the note below. */
  content: string;
  /** Used as the frame's accessible title. */
  fileName: string;
  /**
   * Tighter type and padding, for the Files-tab preview pane. The group
   * viewer uses the roomier default.
   */
  compact?: boolean;
}

/**
 * An HTML artifact rendered as a page rather than as syntax-highlighted source.
 *
 * Migrated `wandb.Html` is untrusted content, so it renders through `srcDoc` in
 * a sandboxed iframe. The sandbox deliberately omits `allow-same-origin`: the
 * frame gets an opaque origin, so even with scripts enabled it cannot reach
 * this app's DOM, cookies or storage. `allow-scripts` is included because much
 * wandb-exported HTML is inert and renders blank without it. **The two flags
 * are only dangerous together, which this avoids — do not add
 * `allow-same-origin` alongside `allow-scripts` here.**
 *
 * That pairing is why this is one component and not two. The Files tab and the
 * group viewer each had their own copy, identical down to the doc comment; a
 * sandbox flag is the last thing that should exist in two places, because
 * loosening it in one file to fix a rendering complaint would silently leave
 * the other correct and nobody looking.
 *
 * A source toggle is kept so the raw markup stays reachable.
 *
 * Content is a prop rather than fetched here: the group viewer already has the
 * text in hand (it sniffs the same fetch to decide between this, a Plotly
 * figure and a point cloud), so fetching internally would duplicate the
 * request.
 */
export function SandboxedHtmlView({
  content,
  fileName,
  compact = false,
}: SandboxedHtmlViewProps) {
  const [showSource, setShowSource] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5">
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          Sandboxed
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 shrink-0 whitespace-nowrap px-2 text-xs"
          onClick={() => setShowSource((v) => !v)}
          data-testid="html-source-toggle"
        >
          {showSource ? "Show preview" : "Show source"}
        </Button>
      </div>
      {showSource ? (
        <div className="min-w-0 flex-1 overflow-auto">
          <pre
            className={cn(
              "whitespace-pre-wrap break-words",
              compact ? "p-3 text-xs" : "p-4 text-sm",
            )}
          >
            <code>{content}</code>
          </pre>
        </div>
      ) : (
        <iframe
          title={fileName}
          srcDoc={content}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          className={cn(
            "w-full flex-1 border-0 bg-white",
            compact ? "min-h-[320px]" : "min-h-[400px]",
          )}
          data-testid="html-preview-frame"
        />
      )}
    </div>
  );
}
