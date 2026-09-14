export type ChatTextSegment =
  | { type: "text"; value: string }
  | { type: "citation"; runId: string };

const CITATION_PATTERN = /\[run:([A-Za-z0-9]+)\]/g;

export function parseRunCitations(text: string): ChatTextSegment[] {
  const segments: ChatTextSegment[] = [];
  let previousIndex = 0;

  for (const match of text.matchAll(CITATION_PATTERN)) {
    if (match.index > previousIndex) {
      segments.push({
        type: "text",
        value: text.slice(previousIndex, match.index),
      });
    }
    segments.push({ type: "citation", runId: match[1] });
    previousIndex = match.index + match[0].length;
  }

  if (previousIndex < text.length) {
    segments.push({ type: "text", value: text.slice(previousIndex) });
  }

  return segments.length > 0 ? segments : [{ type: "text", value: text }];
}
