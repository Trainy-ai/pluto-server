import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export default function Loader({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex h-full items-center justify-center pt-8", className)}
    >
      <Loader2 className={cn("animate-spin", className)} />
    </div>
  );
}
