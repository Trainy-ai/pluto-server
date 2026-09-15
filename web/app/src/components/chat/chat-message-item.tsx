import { Link } from "@tanstack/react-router";
import { BotIcon, ThumbsDownIcon, ThumbsUpIcon, UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseRunCitations } from "@/lib/chat-citations";
import { cn } from "@/lib/utils";
import { messageText, type ChatMessage } from "./chat-types";

interface ChatMessageItemProps {
  message: ChatMessage;
  orgSlug: string;
  projectName: string;
  rating?: boolean;
  feedbackDisabled: boolean;
  onFeedback: (token: string, value: boolean) => void;
}

export function ChatMessageItem({
  message,
  orgSlug,
  projectName,
  rating,
  feedbackDisabled,
  onFeedback,
}: ChatMessageItemProps) {
  const text = messageText(message);
  const feedbackToken = message.metadata?.feedbackToken;
  return (
    <div
      className={cn("flex gap-3", message.role === "user" && "justify-end")}
    >
      {message.role === "assistant" && (
        <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <BotIcon className="size-4" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[85%] rounded-xl px-4 py-3",
          message.role === "user"
            ? "bg-primary text-primary-foreground"
            : "border bg-card",
        )}
      >
        {message.role === "assistant" ? (
          <AssistantText
            text={text}
            orgSlug={orgSlug}
            projectName={projectName}
          />
        ) : (
          <p className="text-sm leading-6 whitespace-pre-wrap">{text}</p>
        )}
        {message.role === "assistant" && feedbackToken && text && (
          <div className="mt-2 flex gap-1 border-t pt-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn("size-7", rating === true && "text-emerald-600")}
              aria-label="Helpful answer"
              disabled={feedbackDisabled}
              onClick={() => onFeedback(feedbackToken, true)}
            >
              <ThumbsUpIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn("size-7", rating === false && "text-destructive")}
              aria-label="Unhelpful answer"
              disabled={feedbackDisabled}
              onClick={() => onFeedback(feedbackToken, false)}
            >
              <ThumbsDownIcon className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
      {message.role === "user" && (
        <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
          <UserIcon className="size-4" />
        </div>
      )}
    </div>
  );
}

function AssistantText({
  text,
  orgSlug,
  projectName,
}: {
  text: string;
  orgSlug: string;
  projectName: string;
}) {
  return (
    <p className="text-sm leading-6 whitespace-pre-wrap">
      {parseRunCitations(text).map((segment, index) =>
        segment.type === "text" ? (
          segment.value
        ) : (
          <Link
            key={`${segment.runId}-${index}`}
            to="/o/$orgSlug/projects/$projectName/$runId"
            params={{ orgSlug, projectName, runId: segment.runId }}
            className="mx-0.5 rounded bg-primary/10 px-1 py-0.5 font-mono text-xs font-medium text-primary hover:underline"
          >
            run:{segment.runId}
          </Link>
        ),
      )}
    </p>
  );
}
