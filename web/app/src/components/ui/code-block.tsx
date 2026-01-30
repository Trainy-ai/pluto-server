import { useState, useMemo } from "react";
import { Copy, Check } from "lucide-react";
import { useShikiHtml } from "@/lib/hooks/use-shiki";

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
  const html = useShikiHtml(code, language);

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

  const wrapperClass = useMemo(() => {
    const classes = ["shiki-wrapper"];
    if (showLineNumbers) {
      classes.push("line-numbers");
    }
    return classes.join(" ");
  }, [showLineNumbers]);

  if (!html) {
    return (
      <div className="group relative">
        <pre
          className={`rounded-xl border border-border bg-card p-4 shadow-lg sm:p-6 ${fontSizeClasses[fontSize]}`}
        >
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="group relative">
      <div
        className={`${wrapperClass} rounded-xl border border-border bg-card p-4 shadow-lg sm:p-6 ${fontSizeClasses[fontSize]}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
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
  );
};

export default CodeBlock;
