import React, { useState } from "react";
import { CodeBlock as ReactCodeBlock } from "react-code-block";
import { Copy, Check } from "lucide-react";
import { themes } from "prism-react-renderer";
import { useTheme } from "@/lib/hooks/use-theme";

interface CodeBlockProps {
  code: string;
  language: string;
  fontSize?: "sm" | "base" | "lg" | "xl";
  showLineNumbers?: boolean;
}

const CodeBlock = ({
  code,
  language,
  fontSize = "base",
  showLineNumbers = false,
}: CodeBlockProps) => {
  const [state, setState] = useState({ value: false });
  const { resolvedTheme } = useTheme();

  const copyCode = () => {
    setState({ value: true });
    navigator.clipboard.writeText(code);
    setTimeout(() => setState({ value: false }), 1000);
  };

  const fontSizeClasses = {
    sm: "text-xs sm:text-sm",
    base: "text-sm sm:text-base",
    lg: "text-base sm:text-lg",
    xl: "text-lg sm:text-xl",
  };

  return (
    <ReactCodeBlock
      code={code}
      language={language}
      theme={resolvedTheme === "dark" ? themes.vsDark : themes.vsLight}
    >
      <div className="group relative">
        <ReactCodeBlock.Code
          className={`rounded-xl border border-border bg-card !p-4 shadow-lg sm:!p-6 ${fontSizeClasses[fontSize]}`}
        >
          <div className="table-row">
            {showLineNumbers && (
              <ReactCodeBlock.LineNumber className="table-cell pr-3 text-right text-xs text-muted-foreground select-none sm:pr-4 sm:text-sm" />
            )}
            <ReactCodeBlock.LineContent className="table-cell">
              <ReactCodeBlock.Token />
            </ReactCodeBlock.LineContent>
          </div>
        </ReactCodeBlock.Code>

        <button
          className="absolute top-1.5 right-1.5 rounded-lg border border-border bg-background/80 px-2 py-1 text-xs font-medium text-muted-foreground opacity-0 shadow-sm transition-all group-hover:opacity-100 hover:bg-accent hover:text-accent-foreground sm:top-2 sm:right-2 sm:px-3 sm:py-1.5 sm:text-sm"
          onClick={copyCode}
        >
          <div className="flex items-center gap-1 sm:gap-1.5">
            {state.value ? (
              <>
                <Check className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                <span>Copied!</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                <span>Copy</span>
              </>
            )}
          </div>
        </button>
      </div>
    </ReactCodeBlock>
  );
};

export default CodeBlock;
