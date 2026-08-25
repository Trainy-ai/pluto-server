// CodeMirror implementation behind the CodeEditor lazy boundary.
// Do NOT import this module directly — go through code-editor.tsx so
// the CodeMirror bundle stays out of the main chunk.

import { useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { Prec, type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { useTheme } from "@/lib/hooks/use-theme";
import type { CodeEditorProps } from "./code-editor";

type CodeEditorImplProps = Omit<CodeEditorProps, "className">;

export function CodeEditorImpl({
  value,
  onChange,
  language,
  readOnly,
  onKeyRun,
}: CodeEditorImplProps) {
  const { resolvedTheme } = useTheme();

  // Read through a ref so a changing callback identity never rebuilds
  // the extension array (which would reconfigure the editor mid-typing).
  const onKeyRunRef = useRef(onKeyRun);
  onKeyRunRef.current = onKeyRun;

  const extensions = useMemo(() => {
    const list: Extension[] = [];
    if (language === "python") {
      list.push(python());
    }
    // Highest precedence so Mod-Enter beats the default insertNewline
    // binding — this is the editor dialog's "Run" hotkey.
    list.push(
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              if (!onKeyRunRef.current) {
                return false;
              }
              onKeyRunRef.current();
              return true;
            },
          },
        ]),
      ),
    );
    return list;
  }, [language]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme={resolvedTheme}
      readOnly={readOnly}
      height="100%"
      style={{ height: "100%", fontSize: "13px" }}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        autocompletion: false,
      }}
    />
  );
}
