import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// TanStack's Link needs a RouterProvider; the routing itself is not what is
// under test here, only which props a citation resolves to.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    params,
    children,
  }: {
    params: Record<string, string>;
    children?: React.ReactNode;
  }) => (
    <a data-testid="run-link" data-params={JSON.stringify(params)}>
      {children}
    </a>
  ),
}));
import { ChatMarkdown } from "../chat-markdown";

// This project's vitest setup has no auto-cleanup, so renders would otherwise
// pile up in the same document and queries would match earlier tests' output.
afterEach(cleanup);

/**
 * Assistant answers arrive as markdown — leaderboards as tables, emphasis as
 * `**bold**`. They used to render as plain text, so a comparison reached the
 * user as a wall of pipes.
 */
describe("ChatMarkdown", () => {
  const props = { orgSlug: "linum-n", projectName: "t0" };

  it("renders a GFM table as a real table", () => {
    render(
      <ChatMarkdown
        {...props}
        text={"| Run | MASE |\n| --- | ---: |\n| a | 0.67 |"}
      />,
    );
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Run" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "0.67" })).toBeTruthy();
  });

  it("renders emphasis and lists as elements, not literal syntax", () => {
    const { container } = render(
      <ChatMarkdown {...props} text={"**top three**\n\n- one\n- two"} />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("top three");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.textContent).not.toContain("**");
  });

  it("keeps a fenced code block verbatim inside a pre", () => {
    const { container } = render(
      <ChatMarkdown {...props} text={"```\npluto.init(project='x')\n```"} />,
    );
    const pre = container.querySelector("pre");
    expect(pre?.textContent).toContain("pluto.init(project='x')");
  });

  it("does not render raw HTML from the model", () => {
    const { container } = render(
      <ChatMarkdown {...props} text={"<img src=x onerror=alert(1)>"} />,
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("keeps citations literal in code, whatever fence was used", () => {
    for (const source of [
      "```\n[run:ID]\n```",
      "~~~\n[run:ID]\n~~~",
      "    [run:ID]",
      "inline `[run:ID]` here",
    ]) {
      const { container, unmount } = render(
        <ChatMarkdown {...props} text={source} />,
      );
      expect(container.textContent).toContain("[run:ID]");
      expect(container.querySelector("a")).toBeNull();
      unmount();
    }
  });

  it("drops remote images instead of requesting them", () => {
    const { container } = render(
      <ChatMarkdown
        {...props}
        text="![pixel](https://tracker.example/p.gif)"
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("[image: pixel]");
  });

  it("keeps an authored link intact instead of nesting a citation in it", () => {
    const { container } = render(
      <ChatMarkdown {...props} text="[run:A](https://example.com/report)" />,
    );
    const anchors = container.querySelectorAll("a");
    expect(anchors).toHaveLength(1);
    expect(anchors[0].getAttribute("href")).toBe("https://example.com/report");
    expect(anchors[0].querySelector("a")).toBeNull();
  });

  it("renders a fence with no language as a block, not an inline pill", () => {
    const { container } = render(
      <ChatMarkdown {...props} text={"```\nline one\nline two\n```"} />,
    );
    const code = container.querySelector("pre > code");
    expect(code).not.toBeNull();
    // `pre` neutralises the inline styles for its own child, whatever class
    // react-markdown put on it.
    expect(container.querySelector("pre")?.className).toContain(
      "[&>code]:whitespace-pre",
    );
  });

  it("survives a citation line markdown would eat as a link definition", () => {
    const { container } = render(
      <ChatMarkdown
        {...props}
        text={"best so far [run:A]\n\n[run:A]: 0.67"}
      />,
    );
    // The line survives rather than being swallowed as a definition. Its own
    // citation renders as a link too, so the text reads "run:A: 0.67".
    expect(container.textContent).toContain("0.67");
    expect(container.textContent).toContain("best so far");
    // Neither citation points off-app at the definition's "url".
    const anchors = [...container.querySelectorAll("a")];
    expect(anchors.map((a) => a.getAttribute("href"))).not.toContain("0.67");
    expect(container.querySelectorAll('[data-testid="run-link"]')).toHaveLength(
      2,
    );
  });

  it("puts a wide table in its own scroll container", () => {
    const { container } = render(
      <ChatMarkdown {...props} text={"| a | b |\n| - | - |\n| 1 | 2 |"} />,
    );
    const table = container.querySelector("table");
    expect(table?.parentElement?.className).toContain("overflow-x-auto");
  });
});

describe("ChatMarkdown run citations", () => {
  const props = { orgSlug: "linum-n", projectName: "t0" };

  it("renders a citation as a link to that run", () => {
    render(<ChatMarkdown {...props} text="best is [run:T02679] so far" />);
    const link = screen.getByTestId("run-link");
    expect(link.textContent).toBe("run:T02679");
    expect(JSON.parse(link.dataset.params!)).toEqual({
      orgSlug: "linum-n",
      projectName: "t0",
      runId: "T02679",
    });
  });

  it("renders citations inside a table cell", () => {
    render(
      <ChatMarkdown
        {...props}
        text={"| Run | WQL |\n| --- | --- |\n| [run:A] | 0.45 |"}
      />,
    );
    expect(screen.getByTestId("run-link").textContent).toBe("run:A");
  });

  it("leaves an external link as a new-tab anchor", () => {
    const { container } = render(
      <ChatMarkdown {...props} text="see [docs](https://docs.trainy.ai)" />,
    );
    const anchor = container.querySelector("a[href]");
    expect(anchor?.getAttribute("href")).toBe("https://docs.trainy.ai");
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toContain("noreferrer");
  });

  it("keeps a citation in code as text, not a link", () => {
    render(<ChatMarkdown {...props} text="cite as `[run:ID]`" />);
    expect(screen.queryByTestId("run-link")).toBeNull();
  });
});
