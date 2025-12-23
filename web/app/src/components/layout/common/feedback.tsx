import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/lib/auth/client";
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";

interface FeedbackProps {
  className?: string;
  showText?: boolean;
  variant?: "sidebar" | "navbar";
}

type Sentiment =
  | "very-sad"
  | "sad"
  | "neutral"
  | "happy"
  | "very-happy"
  | undefined;

const sentiments = [
  { value: "very-sad", emoji: "😢", label: "Very Sad" },
  { value: "sad", emoji: "😕", label: "Sad" },
  { value: "neutral", emoji: "😐", label: "Neutral" },
  { value: "happy", emoji: "🙂", label: "Happy" },
  { value: "very-happy", emoji: "😄", label: "Very Happy" },
] as const;

export function Feedback({
  className,
  showText = true,
  variant = "navbar",
}: FeedbackProps) {
  const [feedback, setFeedback] = useState("");
  const [sentiment, setSentiment] = useState<Sentiment>(undefined);
  const [open, setOpen] = useState(false);
  const { data: session } = useAuth();

  if (
    !session?.activeOrganization ||
    !session.user ||
    !session.activeOrganization.id
  ) {
    return null;
  }

  const orgId = session.activeOrganization.id;

  const mutation = useMutation(
    trpc.feedback.mutationOptions({
      onSuccess: () => {
        toast.success("Feedback sent successfully");
      },
      onError: (error) => {
        toast.error("Failed to send feedback", {
          description: error.message || "Please try again",
        });
      },
    }),
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mutation.isPending) return;

    await mutation.mutateAsync({
      organizationId: orgId,
      feedback,
      feedbackSentiment: sentiment as string | undefined,
    });
    setFeedback("");
    setSentiment(undefined);
    setOpen(false);
  };

  const trigger = (
    <DialogTrigger asChild>
      {variant === "sidebar" ? (
        <SidebarMenuButton tooltip="Give Feedback" className="w-full">
          <div className="flex items-center gap-2">
            <MessageSquare className="size-4 shrink-0 translate-y-[1px] text-muted-foreground" />
            {showText && (
              <span className="leading-none font-medium text-muted-foreground">
                Give Feedback
              </span>
            )}
          </div>
        </SidebarMenuButton>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-9", className)}
          title="Give Feedback"
        >
          <MessageSquare className="size-4" />
        </Button>
      )}
    </DialogTrigger>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {variant === "sidebar" ? (
        <SidebarGroup className={className}>
          <SidebarMenu>
            <SidebarMenuItem>{trigger}</SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      ) : (
        trigger
      )}
      <DialogContent className="max-w-2xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Share Your Feedback</DialogTitle>
            <DialogDescription>
              You can also email us directly at{" "}
              <a
                href="mailto:founders@mlop.ai"
                className="text-primary hover:underline"
              >
                founders@mlop.ai
              </a>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Textarea
              placeholder="Tell us what you think, e.g one thing that I do not like about mlop..."
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              className="min-h-[100px]"
            />
          </div>
          <DialogFooter className="flex items-center justify-between">
            <div className="mr-auto flex items-center gap-2">
              {sentiments.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setSentiment(s.value as Sentiment)}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full text-xl transition-all hover:scale-110",
                    sentiment === s.value
                      ? s.value === "very-happy" || s.value === "happy"
                        ? "bg-green-500/30 text-green-500"
                        : s.value === "very-sad" || s.value === "sad"
                          ? "bg-red-500/30 text-red-500"
                          : "bg-yellow-500/30 text-yellow-500"
                      : "hover:bg-muted",
                  )}
                  title={s.label}
                >
                  {s.emoji}
                </button>
              ))}
            </div>
            <Button
              type="submit"
              disabled={!feedback.trim() || mutation.isPending}
            >
              {mutation.isPending ? "Submitting..." : "Submit Feedback"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
