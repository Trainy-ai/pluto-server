import type { DiffSpan } from "@/lib/inline-diff";

// Inline diff highlight colors (deeper than cell-level for word contrast)
const INLINE_ADDED_BG = "rgba(34, 197, 94, 0.35)";
const INLINE_REMOVED_BG = "rgba(239, 68, 68, 0.35)";

/** Renders a sequence of diff spans with inline highlighting. */
export function InlineDiffText({ spans }: { spans: DiffSpan[] }) {
  return (
    <>
      {spans.map((span, i) => {
        if (span.type === "equal") {
          return <span key={i}>{span.text}</span>;
        }
        return (
          <span
            key={i}
            style={{
              backgroundColor: span.type === "added" ? INLINE_ADDED_BG : INLINE_REMOVED_BG,
              fontWeight: span.type === "added" ? 600 : undefined,
              textDecoration: span.type === "removed" ? "line-through" : undefined,
              borderRadius: 2,
            }}
          >
            {span.text}
          </span>
        );
      })}
    </>
  );
}
