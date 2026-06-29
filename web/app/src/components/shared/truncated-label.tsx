import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TruncatedLabelProps {
  /** Text shown on the label (truncated with an ellipsis when it overflows). */
  text: string;
  /** Full text for the hover tooltip; defaults to `text`. */
  title?: string;
  className?: string;
  style?: CSSProperties;
  /** Element to render — "span" (default, inline) or "p" (block). */
  as?: "span" | "p";
  /**
   * When set (>1), the label wraps onto up to this many lines before clamping
   * with an ellipsis, instead of truncating to a single line. Useful where
   * there is vertical room to fill (e.g. a full-width media caption).
   */
  clampLines?: number;
  /** Optional test id forwarded to the rendered element. */
  "data-testid"?: string;
}

/**
 * Label that truncates with an ellipsis and reveals the full text in a fast
 * Radix tooltip on hover — replaces the slow native `title=` attribute. The
 * tooltip is shown ONLY when the text is actually truncated (overflowing), so
 * fully-visible labels get no tooltip.
 *
 * By default it is single-line and needs a width-constrained parent (e.g. a
 * flex row) for truncation to engage. Pass `clampLines` to instead let the text
 * wrap onto multiple lines (line-clamp) before truncating.
 */
export function TruncatedLabel({
  text,
  title,
  className,
  style,
  as: Tag = "span",
  clampLines,
  "data-testid": dataTestId,
}: TruncatedLabelProps) {
  const elRef = useRef<HTMLElement | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  const isMultiline = clampLines != null && clampLines > 1;

  // Track whether the text overflows its box (i.e. the ellipsis is showing).
  // Single-line clamps horizontally (scrollWidth); multi-line clamps vertically
  // (scrollHeight). Re-checked on text/clamp change and whenever the element
  // resizes.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const measure = () =>
      setIsTruncated(
        isMultiline
          ? el.scrollHeight > el.clientHeight + 1
          : el.scrollWidth > el.clientWidth + 1,
      );
    measure();
    // ResizeObserver is absent in some environments (e.g. jsdom in unit tests).
    // The initial measure() above still runs; we just skip live resize tracking.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, clampLines]);

  // Tailwind has no arbitrary `line-clamp-N` for runtime values, so the
  // multi-line clamp is applied via the equivalent inline styles.
  const clampStyle: CSSProperties | undefined = isMultiline
    ? {
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: clampLines,
        overflow: "hidden",
      }
    : undefined;

  return (
    // Slight hover delay (not instant) before the tooltip appears.
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Tag
          ref={(el: HTMLElement | null) => {
            elRef.current = el;
          }}
          className={cn(
            "min-w-0",
            isMultiline ? "break-words" : "block truncate",
            className,
          )}
          style={clampStyle ? { ...style, ...clampStyle } : style}
          data-testid={dataTestId}
        >
          {text}
        </Tag>
      </TooltipTrigger>
      {isTruncated && (
        // `text-wrap` overrides TooltipContent's base `text-balance` (which
        // balances lines short and leaves dead space on the right for long
        // no-space strings); with `break-all` each line fills to the box edge.
        <TooltipContent side="top" className="max-w-[28rem] text-wrap break-all">
          {title ?? text}
        </TooltipContent>
      )}
    </Tooltip>
  );
}
