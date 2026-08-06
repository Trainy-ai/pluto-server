import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Contains a render failure to a single panel/media tile.
 *
 * Without this, one unrenderable value takes the whole route down: a migrated
 * run whose artifact hit an unhandled shape threw during render, the error
 * escaped past every chart and table on the page, and the user got a blank
 * screen with "Error / Retry" instead of the ~50 panels that were perfectly
 * fine. Degrading one tile to "preview unavailable" is always better than
 * losing the workspace.
 *
 * This is a class because React still exposes error boundaries only via
 * `getDerivedStateFromError` / `componentDidCatch` — there is no hook
 * equivalent, so the repo's function-component rule cannot apply here.
 */
interface RendererErrorBoundaryProps {
  children: ReactNode;
  /** Shown in the fallback so it is obvious which tile failed. */
  label?: string;
  /** Escape hatch when the underlying artifact is still downloadable. */
  onDownload?: () => void;
  /**
   * Identifies what is being rendered. Changing it clears a caught error, so
   * moving on to a different artifact gets a fresh attempt.
   *
   * The error lives in state, so without this one unrenderable file left
   * "Preview unavailable" showing for everything selected afterwards. Resetting
   * via `resetKey` rather than a `key` on the boundary is deliberate: a `key`
   * would remount the children too, throwing away view state they own — the
   * file preview's zoom level, for one, which should survive changing files.
   */
  resetKey?: string | number;
}

/**
 * Marks an error caught but not yet associated with a resetKey.
 *
 * `getDerivedStateFromError` is static and never sees props, so the key an
 * error belongs to can only be stamped on the following render. A distinct
 * sentinel — rather than `undefined` — keeps that pending state separate from
 * a genuine `resetKey={undefined}`, which would otherwise look identical and
 * clear the error on the very render that was meant to display it.
 */
const UNSTAMPED = Symbol("unstamped");

interface RendererErrorBoundaryState {
  error: Error | null;
  /** The resetKey the current error belongs to. */
  errorKey?: string | number | typeof UNSTAMPED;
}

export class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  state: RendererErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): Partial<RendererErrorBoundaryState> {
    return { error, errorKey: UNSTAMPED };
  }

  /**
   * Order matters: stamp first, clear second. React runs this before every
   * render, including the re-render that follows a caught error — so checking
   * "key changed" before the error has been stamped would wipe the error on the
   * very render meant to display it.
   */
  static getDerivedStateFromProps(
    props: RendererErrorBoundaryProps,
    state: RendererErrorBoundaryState,
  ): Partial<RendererErrorBoundaryState> | null {
    if (!state.error) {
      return null;
    }
    if (state.errorKey === UNSTAMPED) {
      return { errorKey: props.resetKey };
    }
    if (state.errorKey !== props.resetKey) {
      return { error: null, errorKey: undefined };
    }
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the real stack reachable — a silent fallback would turn a crash into
    // an invisible "this panel is just empty", which is harder to diagnose than
    // the white screen it replaces.
    console.error(
      `[RendererErrorBoundary] ${this.props.label ?? "panel"} failed to render:`,
      error,
      info.componentStack,
    );
  }

  handleRetry = () => {
    this.setState({ error: null, errorKey: undefined });
  };

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-[160px] flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertTriangle className="h-8 w-8 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">Preview unavailable</p>
          <p className="mt-1 max-w-[32rem] text-xs text-muted-foreground">
            {this.props.label ? `"${this.props.label}" ` : "This panel "}
            could not be displayed. The data is intact — only the preview
            failed.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={this.handleRetry}>
            Retry
          </Button>
          {this.props.onDownload && (
            <Button size="sm" onClick={this.props.onDownload}>
              <Download className="mr-2 h-3.5 w-3.5" />
              Download
            </Button>
          )}
        </div>
      </div>
    );
  }
}
