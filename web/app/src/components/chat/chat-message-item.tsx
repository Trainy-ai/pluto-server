import { BotIcon, ThumbsDownIcon, ThumbsUpIcon, UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChatMarkdown } from "./chat-markdown";
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
          <ChatMarkdown
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
