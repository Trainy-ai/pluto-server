"use client";

import type React from "react";

import { useState } from "react";
import { z } from "zod";
import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  FileCode,
  GitBranch,
  GitCompare,
  GitCommit,
  Terminal,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface GitStatusProps {
  systemMetadata: any;
}

interface ParsedGitUrl {
  provider: "github" | "gitlab" | "bitbucket" | "azure" | "other";
  webUrl: string;
  displayUrl: string;
}

function parseGitUrl(url: string): ParsedGitUrl {
  // Remove .git suffix if present
  const cleanUrl = url.replace(/\.git$/, "");

  // Handle SSH format
  if (url.startsWith("git@")) {
    const sshMatch = url.match(/git@([^:]+):(.+)$/);
    if (sshMatch) {
      const [, host, path] = sshMatch;
      const httpsUrl = `https://${host}/${path}`;
      return formatGitUrl(httpsUrl);
    }
  }

  return formatGitUrl(cleanUrl);
}

function formatGitUrl(url: string): ParsedGitUrl {
  const urlObj = new URL(url);
  const host = urlObj.host.toLowerCase();

  // Initialize with default values
  let provider: ParsedGitUrl["provider"] = "other";
  let webUrl = url;
  let displayUrl = url;

  // GitHub
  if (host === "github.com") {
    provider = "github";
    displayUrl = `${urlObj.pathname.slice(1)}`;
  }
  // GitLab
  else if (host === "gitlab.com") {
    provider = "gitlab";
    displayUrl = `${urlObj.pathname.slice(1)}`;
  }
  // Bitbucket
  else if (host === "bitbucket.org") {
    provider = "bitbucket";
    displayUrl = `${urlObj.pathname.slice(1)}`;
  }
  // Azure DevOps
  else if (host.includes("azure.com") || host.includes("visualstudio.com")) {
    provider = "azure";
    displayUrl = `${urlObj.pathname.split("/_git/")[1] || urlObj.pathname}`;
  }
  // Other providers
  else {
    displayUrl = url.replace(/^https?:\/\//, "");
  }

  return {
    provider,
    webUrl: webUrl.replace(/\.git$/, ""),
    displayUrl,
  };
}

const gitStatusSchema = z.object({
  git: z.object({
    // URL of remote repository
    url: z.string().optional().nullable(),
    // Root directory of the repository
    root: z.string().optional().nullable(),
    // Branch name
    branch: z.string().optional().nullable(),
    // Whether there is untracked changes or not
    dirty: z.boolean().optional().nullable(),
    // Commit hash
    commit: z.string().optional().nullable(),
    // Diff between local and remote
    diff: z.object({
      // Head commit hash
      head: z.string().optional().nullable(),
      // Remote commit hash
      remote: z.string().optional().nullable(),
    }),
  }),
});

function getBranchUrl(parsedUrl: ParsedGitUrl, branch: string): string | null {
  const { provider, webUrl } = parsedUrl;
  const encodedBranch = encodeURIComponent(branch);

  switch (provider) {
    case "github":
      return `${webUrl}/tree/${encodedBranch}`;
    case "gitlab":
      return `${webUrl}/-/tree/${encodedBranch}`;
    case "bitbucket":
      return `${webUrl}/src/${encodedBranch}`;
    case "azure":
      return `${webUrl}?version=GB${encodedBranch}`;
    default:
      return null;
  }
}

interface GitSyncCommandsProps {
  gitUrl: string;
  branch: string;
  commit: string;
  isDirty: boolean;
  diff?: {
    head?: string | null;
    remote?: string | null;
  };
}

function GitSyncCommands({
  gitUrl,
  branch,
  commit,
  isDirty,
  diff,
}: GitSyncCommandsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

  const copyCommand = (command: string) => {
    navigator.clipboard.writeText(command);
    setCopiedCommand(command);
    setTimeout(() => setCopiedCommand(null), 2000);
  };

  const commands = [
    {
      title: "Clone and checkout commit",
      command: `git clone ${gitUrl} && cd ${gitUrl.split("/").pop()?.replace(".git", "")} && git checkout ${commit}`,
      description: "Clone the repository and checkout the exact commit",
    },
    {
      title: "Checkout from existing repo",
      command: `git fetch origin ${branch} && git checkout ${commit}`,
      description: "Fetch and checkout the commit in your existing repository",
    },
  ];

  if (diff?.head && diff?.remote) {
    commands.push({
      title: "Apply remote changes",
      command: `git fetch origin ${branch} && git checkout ${diff.head} && git pull origin ${branch}`,
      description: "Sync your local repository with the remote changes",
    });
  }

  if (isDirty) {
    commands.unshift({
      title: "⚠️ Warning",
      command: "git status && git stash",
      description:
        "You have local changes. Consider checking status and stashing changes before proceeding",
    });
  }

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="w-full space-y-2"
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border p-2 font-medium hover:bg-accent">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4" />
          <span>Sync Commands</span>
        </div>
        {isOpen ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2">
        {commands.map((cmd) => (
          <div
            key={cmd.title}
            className="rounded-md border bg-muted p-3 font-mono text-sm"
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {cmd.title}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => copyCommand(cmd.command)}
              >
                {copiedCommand === cmd.command ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </div>
            <div className="rounded bg-background p-2 break-all">
              {cmd.command}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {cmd.description}
            </p>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function GitStatus({ systemMetadata }: GitStatusProps) {
  const { data: gitStatus } = gitStatusSchema.safeParse(systemMetadata);
  const parsedUrl = gitStatus?.git?.url ? parseGitUrl(gitStatus.git.url) : null;

  if (!gitStatus || !gitStatus.git || !gitStatus.git.root) {
    return null;
  }

  return (
    <Card className="w-full shadow-md">
      <CardHeader className="bg-accent">
        <CardTitle className="flex items-center gap-2 text-lg">
          <GitBranch className="h-5 w-5" />
          Repository Status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        <div className="space-y-4">
          {gitStatus.git.url && (
            <GitInfoItem
              icon={<ExternalLink className="h-4 w-4 text-muted-foreground" />}
              label="Repository"
              value={gitStatus.git.url}
              isCopyable
              isLink
            />
          )}

          {gitStatus.git.root && (
            <GitInfoItem
              icon={<FileCode className="h-4 w-4 text-muted-foreground" />}
              label="Root"
              value={gitStatus.git.root}
              isCopyable
            />
          )}

          <div className="flex flex-wrap gap-4">
            {gitStatus.git.branch && (
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Branch:</span>
                {parsedUrl && getBranchUrl(parsedUrl, gitStatus.git.branch) ? (
                  <a
                    href={getBranchUrl(parsedUrl, gitStatus.git.branch)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:opacity-80"
                  >
                    <Badge
                      variant="outline"
                      className="cursor-pointer font-mono hover:bg-accent"
                    >
                      {gitStatus.git.branch}
                    </Badge>
                  </a>
                ) : (
                  <Badge variant="outline" className="font-mono">
                    {gitStatus.git.branch}
                  </Badge>
                )}
              </div>
            )}

            {gitStatus.git.dirty !== null && (
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Status:</span>
                {gitStatus.git.dirty ? (
                  <Badge variant="destructive" className="font-mono">
                    Uncommitted changes
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="border-green-600 font-mono text-green-600"
                  >
                    Clean
                  </Badge>
                )}
              </div>
            )}
          </div>

          {gitStatus.git.commit && (
            <GitInfoItem
              icon={<GitCommit className="h-4 w-4 text-muted-foreground" />}
              label="Commit"
              value={gitStatus.git.commit}
              isCopyable
              isHash
            />
          )}

          {(gitStatus.git.diff?.head || gitStatus.git.diff?.remote) && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2">
                <GitCompare className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Diff Status:</span>
              </div>

              {gitStatus.git.diff.head && (
                <GitInfoItem
                  icon={<GitBranch className="h-4 w-4 text-muted-foreground" />}
                  label="Local"
                  value={gitStatus.git.diff.head}
                  isCopyable
                  isHash
                  indented
                />
              )}

              {gitStatus.git.diff.remote && (
                <GitInfoItem
                  icon={<GitBranch className="h-4 w-4 text-muted-foreground" />}
                  label="Remote"
                  value={gitStatus.git.diff.remote}
                  isCopyable
                  isHash
                  indented
                />
              )}
            </div>
          )}
        </div>

        {gitStatus.git.url && gitStatus.git.branch && gitStatus.git.commit && (
          <GitSyncCommands
            gitUrl={gitStatus.git.url}
            branch={gitStatus.git.branch}
            commit={gitStatus.git.commit}
            isDirty={gitStatus.git.dirty ?? false}
            diff={gitStatus.git.diff}
          />
        )}
      </CardContent>
    </Card>
  );
}

interface GitInfoItemProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  isCopyable?: boolean;
  isHash?: boolean;
  indented?: boolean;
  isLink?: boolean;
}

function GitInfoItem({
  icon,
  label,
  value,
  isCopyable = false,
  isHash = false,
  indented = false,
  isLink = false,
}: GitInfoItemProps) {
  const [copied, setCopied] = useState(false);
  const parsedUrl = isLink ? parseGitUrl(value) : null;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`flex items-center gap-2 ${indented ? "ml-6" : ""}`}>
      <div className="flex-shrink-0">{icon}</div>
      <span className="min-w-20 text-sm font-medium">{label}:</span>
      <div className="flex items-center gap-1 overflow-hidden">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              {isLink && parsedUrl ? (
                <a
                  href={parsedUrl.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="max-w-[300px] truncate font-mono text-sm text-blue-600 hover:text-blue-800 hover:underline sm:max-w-[400px] md:max-w-[500px] dark:text-blue-400 dark:hover:text-blue-300"
                >
                  {parsedUrl.displayUrl}
                </a>
              ) : (
                <span className="max-w-[300px] truncate font-mono text-sm sm:max-w-[400px] md:max-w-[500px]">
                  {value}
                </span>
              )}
            </TooltipTrigger>
            <TooltipContent>
              <p className="max-w-[300px] font-mono text-xs break-all">
                {value}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {isCopyable && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0"
            onClick={copyToClipboard}
            aria-label="Copy to clipboard"
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3 text-muted-foreground" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
