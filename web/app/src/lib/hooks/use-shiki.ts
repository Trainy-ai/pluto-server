import { useEffect, useState } from "react";
import type { Highlighter, BundledLanguage } from "shiki";
import { createHighlighter } from "shiki";
import { useTheme } from "@/lib/hooks/use-theme";

const PRELOADED_LANGS: BundledLanguage[] = [
  "python",
  "javascript",
  "typescript",
  "json",
  "yaml",
  "bash",
];

const DARK_THEME = "dracula" as const;
const LIGHT_THEME = "github-light" as const;

let highlighterInstance: Highlighter | null = null;
let highlighterPromise: Promise<Highlighter> | null = null;
const loadedLanguages = new Set<string>(PRELOADED_LANGS);

function getHighlighter(): Promise<Highlighter> {
  if (highlighterInstance) {
    return Promise.resolve(highlighterInstance);
  }
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [DARK_THEME, LIGHT_THEME],
      langs: PRELOADED_LANGS,
    }).then((h) => {
      highlighterInstance = h;
      return h;
    });
  }
  return highlighterPromise;
}

async function ensureLanguage(
  highlighter: Highlighter,
  lang: string
): Promise<string> {
  if (loadedLanguages.has(lang)) {
    return lang;
  }
  try {
    await highlighter.loadLanguage(lang as BundledLanguage);
    loadedLanguages.add(lang);
    return lang;
  } catch (error) {
    console.error(`[Shiki] Failed to load language "${lang}":`, error);
    return "text";
  }
}

function useShikiHighlighter(): Highlighter | null {
  const [highlighter, setHighlighter] = useState<Highlighter | null>(
    highlighterInstance
  );

  useEffect(() => {
    if (highlighterInstance) {
      setHighlighter(highlighterInstance);
      return;
    }
    let cancelled = false;
    getHighlighter().then((h) => {
      if (!cancelled) {
        setHighlighter(h);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return highlighter;
}

/**
 * Hook that highlights code using Shiki and returns an HTML string.
 * Returns empty string while the highlighter is loading.
 */
export function useShikiHtml(code: string, language: string): string {
  const highlighter = useShikiHighlighter();
  const { resolvedTheme } = useTheme();
  const [html, setHtml] = useState<string>("");

  useEffect(() => {
    if (!highlighter || !code) {
      setHtml("");
      return;
    }
    let cancelled = false;
    ensureLanguage(highlighter, language).then((lang) => {
      if (cancelled) return;
      const result = highlighter.codeToHtml(code, {
        lang,
        theme: resolvedTheme === "dark" ? DARK_THEME : LIGHT_THEME,
      });
      setHtml(result);
    });
    return () => {
      cancelled = true;
    };
  }, [highlighter, code, language, resolvedTheme]);

  return html;
}
