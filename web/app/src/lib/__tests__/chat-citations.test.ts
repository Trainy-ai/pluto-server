import { describe, expect, it } from "vitest";
import {
  RUN_CITATION_HREF_PREFIX,
  rehypeRunCitations,
  runIdFromCitationHref,
} from "@/lib/chat-citations";

interface TestNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: TestNode[];
}

const text = (value: string): TestNode => ({ type: "text", value });
const el = (tagName: string, children: TestNode[]): TestNode => ({
  type: "element",
  tagName,
  children,
});

/** Runs the plugin over a tree and returns it, mutated in place. */
function transform(tree: TestNode): TestNode {
  rehypeRunCitations()(tree as never);
  return tree;
}

/** Flattens a subtree to the strings a reader would see. */
function textOf(node: TestNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

function links(node: TestNode): TestNode[] {
  const found: TestNode[] = [];
  const walk = (n: TestNode) => {
    if (n.type === "element" && n.tagName === "a") found.push(n);
    (n.children ?? []).forEach(walk);
  };
  walk(node);
  return found;
}

describe("rehypeRunCitations", () => {
  it("turns a citation into an anchor with the citation href", () => {
    const tree = transform(el("root", [el("p", [text("best is [run:T02679]")])]));
    const [link] = links(tree);
    expect(link.properties?.href).toBe(`${RUN_CITATION_HREF_PREFIX}T02679`);
    expect(textOf(link)).toBe("run:T02679");
  });

  it("keeps the surrounding text in order", () => {
    const tree = transform(
      el("root", [el("p", [text("[run:A] beats [run:B] today")])]),
    );
    expect(textOf(tree)).toBe("run:A beats run:B today");
    expect(links(tree)).toHaveLength(2);
  });

  it("leaves text inside <code> alone", () => {
    const tree = transform(
      el("root", [el("p", [el("code", [text("[run:ID]")])])]),
    );
    expect(links(tree)).toHaveLength(0);
    expect(textOf(tree)).toBe("[run:ID]");
  });

  it("leaves text inside <pre> alone, whatever fence produced it", () => {
    // Tilde fences and indented blocks parse to the same pre/code pair as
    // backtick fences, which is why this runs after parsing.
    const tree = transform(
      el("root", [el("pre", [el("code", [text("[run:ID]\n")])])]),
    );
    expect(links(tree)).toHaveLength(0);
  });

  it("descends into tables and lists", () => {
    const tree = transform(
      el("root", [
        el("table", [el("tbody", [el("tr", [el("td", [text("[run:A]")])])])]),
        el("ul", [el("li", [text("see [run:B]")])]),
      ]),
    );
    expect(links(tree).map((l) => l.properties?.href)).toEqual([
      `${RUN_CITATION_HREF_PREFIX}A`,
      `${RUN_CITATION_HREF_PREFIX}B`,
    ]);
  });

  it("leaves a tree with no citations untouched", () => {
    const original = el("root", [el("p", [text("no citations here")])]);
    const tree = transform(original);
    expect(tree.children?.[0].children?.[0]).toEqual(text("no citations here"));
  });

  it("ignores malformed citations", () => {
    const tree = transform(
      el("root", [el("p", [text("[run:] [run:bad-id] [runs:A]")])]),
    );
    expect(links(tree)).toHaveLength(0);
  });
});

describe("runIdFromCitationHref", () => {
  it("reads the run id back out", () => {
    expect(runIdFromCitationHref("#run-T02679")).toBe("T02679");
  });

  it("ignores other hrefs and malformed ids", () => {
    expect(runIdFromCitationHref("https://example.com")).toBeUndefined();
    expect(runIdFromCitationHref("#section")).toBeUndefined();
    expect(runIdFromCitationHref("#run-not/an/id")).toBeUndefined();
    expect(runIdFromCitationHref("#run-")).toBeUndefined();
  });
});
