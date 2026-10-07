const CITATION_PATTERN = /\[run:([A-Za-z0-9]+)\]/g;

/**
 * Href the markdown renderer recognises as a run citation. A fragment, so
 * react-markdown's URL sanitising leaves it alone (an invented scheme would
 * be stripped), and a stray one degrades to a harmless same-page anchor.
 */
export const RUN_CITATION_HREF_PREFIX = "#run-";

/** `#run-ABC` → `ABC`, or undefined for any other href. */
export function runIdFromCitationHref(href: string): string | undefined {
  if (!href.startsWith(RUN_CITATION_HREF_PREFIX)) return undefined;
  const runId = href.slice(RUN_CITATION_HREF_PREFIX.length);
  return /^[A-Za-z0-9]+$/.test(runId) ? runId : undefined;
}

/**
 * Elements this pass does not descend into.
 *
 * `code`/`pre` quote their text verbatim, so a citation inside them is an
 * example and must stay literal. `a` is skipped because an anchor inside an
 * anchor is invalid HTML with no reliable click behaviour — `[run:A](url)`
 * keeps the author's link rather than growing a citation inside it.
 */
const SKIPPED_TAGS = new Set(["code", "pre", "a"]);

// Minimal structural view of the hast nodes this plugin touches. Declared
// locally rather than importing `hast` types, which are only a transitive
// dependency of react-markdown.
interface TextNode {
  type: "text";
  value: string;
}
interface ElementNode {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown>;
  children: Node[];
}
type Node = TextNode | ElementNode | { type: string; children?: Node[] };

/**
 * Rewrites `[run:ABC]` into run links, after markdown parsing.
 *
 * Done on the parsed tree rather than the source text for two reasons: the
 * raw `[run:ABC]` would otherwise be parsed as markdown link-reference
 * syntax, and "is this inside code?" is a structural question. A text-level
 * pass has to re-implement every code syntax — backtick fences, tilde
 * fences, indented blocks, inline spans — and silently linkifies the ones it
 * misses. Here, anything inside <code> or <pre> is simply not visited, so an
 * answer explaining the citation format keeps its example intact.
 */
export function rehypeRunCitations() {
  return (tree: Node): void => {
    transformChildren(tree);
  };
}

function transformChildren(node: Node): void {
  const children = "children" in node ? node.children : undefined;
  if (!children) return;

  const next: Node[] = [];
  let changed = false;
  for (const child of children) {
    if (isElement(child) && SKIPPED_TAGS.has(child.tagName)) {
      next.push(child);
      continue;
    }
    if (isText(child)) {
      const split = splitCitations(child.value);
      if (split) {
        next.push(...split);
        changed = true;
        continue;
      }
      next.push(child);
      continue;
    }
    transformChildren(child);
    next.push(child);
  }
  if (changed && "children" in node) {
    node.children = next;
  }
}

/** `null` when the text holds no citation, so untouched nodes stay identical. */
function splitCitations(value: string): Node[] | null {
  const matches = [...value.matchAll(CITATION_PATTERN)];
  if (matches.length === 0) return null;

  const nodes: Node[] = [];
  let index = 0;
  for (const match of matches) {
    if (match.index > index) {
      nodes.push({ type: "text", value: value.slice(index, match.index) });
    }
    const runId = match[1];
    nodes.push({
      type: "element",
      tagName: "a",
      properties: { href: `${RUN_CITATION_HREF_PREFIX}${runId}` },
      children: [{ type: "text", value: `run:${runId}` }],
    });
    index = match.index + match[0].length;
  }
  if (index < value.length) {
    nodes.push({ type: "text", value: value.slice(index) });
  }
  return nodes;
}

function isElement(node: Node): node is ElementNode {
  return node.type === "element" && "tagName" in node;
}

function isText(node: Node): node is TextNode {
  return node.type === "text" && "value" in node;
}

/** `run:A` style label, as written inside the brackets. */
function isRunLabel(label: unknown): label is string {
  return typeof label === "string" && /^run:[A-Za-z0-9]+$/.test(label);
}

interface MdastNode {
  type: string;
  children?: MdastNode[];
  label?: string;
  url?: string;
  value?: string;
}

/**
 * Keeps `[run:ID]` out of CommonMark's link-reference machinery.
 *
 * A line such as `[run:A]: 0.67` is a link *definition*: markdown drops it
 * from the output entirely and rewrites every earlier `[run:A]` into a link
 * to `0.67`. So a compact "citation: value" list — a plausible thing for a
 * model to write — would lose a line and turn its citations into off-app
 * links. This runs before the rehype pass and turns both halves back into
 * the text the model wrote, so the line survives and both citations render
 * as ordinary citation links (the rescued line reading "run:A: 0.67").
 */
export function remarkRunCitationsLiteral() {
  return (tree: MdastNode): void => {
    restore(tree);
  };
}

function restore(node: MdastNode): void {
  if (!node.children) return;
  const next: MdastNode[] = [];
  for (const child of node.children) {
    if (child.type === "definition" && isRunLabel(child.label)) {
      // Block position, so the replacement has to be a block.
      next.push({
        type: "paragraph",
        children: [
          { type: "text", value: `[${child.label}]: ${child.url ?? ""}` },
        ],
      });
      continue;
    }
    if (child.type === "linkReference" && isRunLabel(child.label)) {
      next.push({ type: "text", value: `[${child.label}]` });
      continue;
    }
    restore(child);
    next.push(child);
  }
  node.children = next;
}
