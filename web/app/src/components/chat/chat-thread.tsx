import { CircleStopIcon, SendIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { ChatMessageItem } from "@/components/chat/chat-message-item";
import type { ChatMessage } from "@/components/chat/chat-types";
import { getChatApiUrl } from "@/lib/chat-api";
import { cn } from "@/lib/utils";

interface ChatThreadProps {
  messages: ChatMessage[];
  isGenerating: boolean;
  error: Error | undefined;
  orgSlug: string;
  projectName: string;
  onSend: (text: string) => void | Promise<void>;
  onStop: () => void;
  placeholder: string;
  footerNote: ReactNode;
  /** Shown while the conversation has no messages. */
  emptyState: ReactNode;
  /** Rendered directly above the composer (e.g. context chips). */
  composerHeader?: ReactNode;
  /** `page` centers a readable column; `panel` fills a narrow sidebar. */
  variant?: "page" | "panel";
}

export function ChatThread({
  messages,
  isGenerating,
  error,
  orgSlug,
  projectName,
  onSend,
  onStop,
  placeholder,
  footerNote,
  emptyState,
  composerHeader,
  variant = "page",
}: ChatThreadProps) {
  const [input, setInput] = useState("");
  const [ratings, setRatings] = useState<Record<string, boolean>>({});
  const [pendingRating, setPendingRating] = useState<string>();
  const endRef = useRef<HTMLDivElement>(null);
  const isPanel = variant === "panel";
  const column = isPanel ? "w-full" : "mx-auto max-w-3xl";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || isGenerating) return;
    setInput("");
    try {
      await onSend(text);
    } catch {
      // Don't eat what the user typed if the send never got off the ground.
      setInput(text);
    }
  }

  async function submitFeedback(token: string, value: boolean) {
    if (pendingRating || token in ratings) return;
    setPendingRating(token);
    try {
      const response = await fetch(getChatApiUrl("/feedback"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          value,
        }),
      });
      if (!response.ok) throw new Error("Feedback could not be delivered");
      const result = (await response.json()) as { delivered: boolean };
      if (!result.delivered)
        throw new Error("Langfuse feedback is not configured");
      setRatings((current) => ({ ...current, [token]: value }));
      toast.success("Thanks for the feedback");
    } catch (feedbackError) {
      toast.error(
        feedbackError instanceof Error
          ? feedbackError.message
          : "Feedback could not be delivered",
      );
    } finally {
      setPendingRating(undefined);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-y-contain",
          isPanel ? "px-3 py-4" : "px-4 py-6 sm:px-8",
        )}
      >
        <div className={cn("flex flex-col gap-5", column)}>
          {messages.length === 0 && emptyState}

          {messages.map((message) => {
            const feedbackToken = message.metadata?.feedbackToken;
            return (
              <ChatMessageItem
                key={message.id}
                message={message}
                orgSlug={orgSlug}
                projectName={projectName}
                rating={feedbackToken ? ratings[feedbackToken] : undefined}
                feedbackDisabled={
                  Boolean(pendingRating) ||
                  Boolean(feedbackToken && feedbackToken in ratings)
                }
                onFeedback={(token, value) => void submitFeedback(token, value)}
              />
            );
          })}
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error.message}
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className={cn("border-t bg-background", isPanel ? "p-3" : "p-4")}>
        {composerHeader && (
          <div className={cn("mb-2", column)}>{composerHeader}</div>
        )}
        <form
          onSubmit={handleSubmit}
          className={cn("flex items-end gap-2", column)}
        >
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={placeholder}
            rows={2}
            maxLength={8_000}
            disabled={isGenerating}
            className="max-h-40 min-h-16 resize-none"
            data-testid="chat-composer"
          />
          {isGenerating ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={onStop}
              aria-label="Stop response"
            >
              <CircleStopIcon className="size-4" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim()}
              aria-label="Send message"
            >
              <SendIcon className="size-4" />
            </Button>
          )}
        </form>
        <p
          className={cn(
            "mt-2 text-center text-xs text-muted-foreground",
            column,
          )}
        >
          {footerNote}
        </p>
      </div>
    </div>
  );
}
