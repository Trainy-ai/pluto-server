import { Link } from "@tanstack/react-router";
import { useMemo, type ComponentPropsWithoutRef, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  rehypeRunCitations,
  remarkRunCitationsLiteral,
  runIdFromCitationHref,
} from "@/lib/chat-citations";
import { cn } from "@/lib/utils";

interface ChatMarkdownProps {
  text: string;
  orgSlug: string;
  projectName: string;
}

/**
 * Assistant answers, rendered as markdown.
 *
 * Models answer with tables, bold and lists because that is how you present
 * a run comparison; rendered as plain text, a leaderboard arrives as a wall
 * of pipes. GFM is on for tables and strikethrough.
 *
 * Styling is per element rather than a `prose` class: the app has no
 * typography plugin, and chat bubbles want tighter spacing than prose
 * defaults anyway. Raw HTML is not enabled (react-markdown ignores it by
 * default), so model output cannot inject markup.
 */
export function ChatMarkdown({ text, orgSlug, projectName }: ChatMarkdownProps) {
  const components = useMemo<Components>(
    () => ({
      p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
      ul: ({ children }) => (
        <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">
          {children}
        </ul>
      ),
      ol: ({ children }) => (
        <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0">
          {children}
        </ol>
      ),
      li: ({ children }) => <li className="leading-6">{children}</li>,
      strong: ({ children }) => (
        <strong className="font-semibold">{children}</strong>
      ),
      // Markdown has six heading levels; a chat bubble has room for one
      // weight. Keep them all legible and compact instead of scaling down.
      h1: heading,
      h2: heading,
      h3: heading,
      h4: heading,
      h5: heading,
      h6: heading,
      a: ({ href, children }) => {
        const runId = href ? runIdFromCitationHref(href) : undefined;
        if (runId) {
          return (
            <Link
              to="/o/$orgSlug/projects/$projectName/$runId"
              params={{ orgSlug, projectName, runId }}
              className="mx-0.5 rounded bg-primary/10 px-1 py-0.5 font-mono text-xs font-medium text-primary hover:underline"
            >
              {children}
            </Link>
          );
        }
        return (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary underline underline-offset-2"
          >
            {children}
          </a>
        );
      },
      // Styled for the inline case. A fence with no info string carries no
      // language class, so "is this a block?" cannot be read from the props
      // here — `pre` below neutralises these styles for its own child
      // instead, which holds however the fence was written.
      code: ({ className, children, ...props }: CodeProps) => (
        <code
          className={cn(
            "rounded bg-muted px-1 py-0.5 font-mono text-xs whitespace-pre-wrap",
            className,
          )}
          {...props}
        >
          {children}
        </code>
      ),
      pre: ({ children }) => (
        <pre className="my-2 overflow-x-auto rounded-md bg-muted p-3 first:mt-0 last:mb-0 [&>code]:block [&>code]:bg-transparent [&>code]:p-0 [&>code]:whitespace-pre">
          {children}
        </pre>
      ),
      // Tables get their own scroll container so a wide leaderboard never
      // widens the chat bubble.
      table: ({ children }) => (
        <div className="my-2 overflow-x-auto first:mt-0 last:mb-0">
          <table className="w-full border-collapse text-xs">{children}</table>
        </div>
      ),
      thead: ({ children }) => <thead className="border-b">{children}</thead>,
      th: ({ children }) => (
        <th className="px-2 py-1 text-left font-semibold whitespace-nowrap">
          {children}
        </th>
      ),
      td: ({ children }) => (
        <td className="border-t px-2 py-1 align-top">{children}</td>
      ),
      blockquote: ({ children }) => (
        <blockquote className="my-2 border-l-2 pl-3 text-muted-foreground first:mt-0 last:mb-0">
          {children}
        </blockquote>
      ),
      hr: () => <hr className="my-3" />,
      // Images are dropped rather than rendered: an <img> fires a request to
      // whatever host the answer names, the moment the answer appears, with
      // no click. That is a tracking beacon (and an IP leak) available to
      // anything that can steer the model's output — a run named to carry an
      // injection, say. Answers have no legitimate need to embed remote
      // images; media lives in the run's own panels.
      img: ({ alt }) => (
        <span className="text-muted-foreground italic">
          {alt ? `[image: ${alt}]` : "[image omitted]"}
        </span>
      ),
    }),
    [orgSlug, projectName],
  );

  return (
    <div className="text-sm leading-6 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkRunCitationsLiteral]}
        rehypePlugins={[rehypeRunCitations]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

type CodeProps = ComponentPropsWithoutRef<"code">;

function heading({ children }: { children?: ReactNode }) {
  return (
    <p className="mt-3 mb-1 font-semibold first:mt-0 last:mb-0">{children}</p>
  );
}
