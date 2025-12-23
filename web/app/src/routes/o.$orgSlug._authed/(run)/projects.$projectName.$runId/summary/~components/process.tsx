import { z } from "zod";
import { Terminal, Hash, Copy, Check } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface ProcessProps {
  systemMetadata: any;
}

const processSchema = z.object({
  process: z.object({
    exe: z.string(),
    pid: z.number(),
    cmdline: z.array(z.string()),
  }),
});

export function Process({ systemMetadata }: ProcessProps) {
  const [copied, setCopied] = useState(false);
  const process = processSchema.safeParse(systemMetadata);
  if (!process.success) {
    return null;
  }

  const { exe, pid, cmdline } = process.data.process;
  const exeName = exe.split("/").pop() || exe;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(cmdline.join(" "));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="w-full max-w-md transition-shadow duration-300 hover:shadow-md">
      <CardHeader className="space-y-1 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="font-mono text-base font-medium">
              {exeName}
            </CardTitle>
          </div>
          <Badge variant="outline" className="bg-accent">
            <Hash className="mr-1 h-3 w-3" />
            PID: {pid}
          </Badge>
        </div>
        <CardDescription
          className="mt-0 truncate font-mono text-xs"
          title={exe}
        >
          {exe}
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="pt-3">
        <div className="flex items-start gap-2">
          <div className="relative flex-1">
            <div className="overflow-hidden rounded-md bg-muted">
              <div className="overflow-x-auto">
                <pre className="p-2 text-xs">
                  <code className="font-mono break-all whitespace-pre-wrap">
                    {cmdline.join(" ")}
                  </code>
                </pre>
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 flex-shrink-0"
            onClick={handleCopy}
            title="Copy command"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
