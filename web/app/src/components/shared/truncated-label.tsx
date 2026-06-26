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
}

/**
 * Single-line label that truncates with an ellipsis and reveals the full text
 * in a fast (0-delay) Radix tooltip on hover — replaces the slow native
 * `title=` attribute. The tooltip is shown ONLY when the text is actually
 * truncated (overflowing), so fully-visible labels get no tooltip. Needs a
 * width-constrained parent (e.g. a flex row) for truncation to engage.
 */
export function TruncatedLabel({
  text,
  title,
  className,
  style,
  as: Tag = "span",
}: TruncatedLabelProps) {
  const elRef = useRef<HTMLElement | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  // Track whether the single-line text overflows its box (i.e. the ellipsis is
  // showing). Re-checked on text change and whenever the element resizes.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const measure = () => setIsTruncated(el.scrollWidth > el.clientWidth + 1);
    measure();
    // ResizeObserver is absent in some environments (e.g. jsdom in unit tests).
    // The initial measure() above still runs; we just skip live resize tracking.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  return (
    // Slight hover delay (not instant) before the tooltip appears.
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Tag
          ref={(el: HTMLElement | null) => {
            elRef.current = el;
          }}
          className={cn("block min-w-0 truncate", className)}
          style={style}
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
