"use client";

import React, { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Copy, ExternalLink, ChevronDown } from "lucide-react";
import { z } from "zod";

interface RequirementsProps {
  systemMetadata: any;
}

const requirementsSchema = z.object({
  requirements: z.array(z.string()),
});

export function Requirements({ systemMetadata }: RequirementsProps) {
  const [visibleItems, setVisibleItems] = useState(30);

  const { data: { requirements } = { requirements: [] } } =
    requirementsSchema.safeParse(systemMetadata);

  if (requirements.length === 0) {
    return null;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(requirements.join("\n"));
      alert("Requirements copied to clipboard!");
    } catch (error) {
      console.error("Failed to copy requirements:", error);
    }
  };

  const handleLoadMore = () => {
    setVisibleItems(requirements.length);
  };

  const getPackageName = (req: string) => req.split(/[<>=!]/)[0];
  const getPyPiUrl = (pkgName: string) =>
    `https://pypi.org/project/${pkgName}/`;

  const visibleRequirements = requirements.slice(0, visibleItems);
  const hasMore = visibleItems < requirements.length;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Python Requirements</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative w-full rounded-lg bg-muted py-2 font-mono text-sm">
          {/* Copy button in top-right of code block */}
          <div className="absolute top-2 right-2">
            <Button variant="outline" size="sm" onClick={handleCopy}>
              <Copy className="mr-1 h-4 w-4" /> Copy all
            </Button>
          </div>
          <TooltipProvider>
            <div className="overflow-x-auto overflow-y-auto pb-2">
              {visibleRequirements.map((req, idx) => {
                const lineNumber = idx + 1;
                const pkg = getPackageName(req);
                const url = getPyPiUrl(pkg);
                return (
                  <div
                    key={req}
                    className="group flex items-center hover:bg-accent/50"
                  >
                    {/* PyPI Link */}
                    <div className="flex items-center pl-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => window.open(url, "_blank")}
                            className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                            aria-label={`Open ${pkg} on PyPI`}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <span>Visit {pkg} on PyPI</span>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    {/* Line number gutter */}
                    <span className="min-w-[1rem] border-r border-border text-right text-muted-foreground select-none">
                      {lineNumber}
                    </span>
                    {/* Content wrapper */}
                    <div className="flex flex-1 items-center">
                      {/* Selectable code text */}
                      <span className="flex-1 px-4 py-1 select-text">
                        {req}
                      </span>
                    </div>
                  </div>
                );
              })}
              {hasMore && (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleLoadMore}
                    className="w-full hover:bg-accent/50"
                  >
                    <ChevronDown className="mr-2 h-4 w-4" />
                    Show all {requirements.length} requirements
                  </Button>
                </div>
              )}
            </div>
          </TooltipProvider>
        </div>
      </CardContent>
    </Card>
  );
}
