import type { WireMessage } from "@/lib/chat-transport";

/** Upper bound on the preamble so page context never crowds out the question. */
export const MAX_CONTEXT_CHARS = 2_000;
/** Runs listed by name; the rest are summarized as "…and N more". */
export const MAX_CONTEXT_RUNS = 20;
/** Mirrors MAX_MESSAGE_CHARS in web/server/lib/chat/messages.ts. */
const MAX_MESSAGE_CHARS = 8_000;
const MAX_FIELD_CHARS = 80;

const OPEN_TAG = "<pluto_page_context>";
const CLOSE_TAG = "</pluto_page_context>";

export interface CopilotRunRef {
  /** SQID used in URLs and by the run selection handlers. */
  id: string;
  name: string;
  /** Human id such as "TNC-448", when the project has a run prefix. */
  displayId?: string | null;
  status?: string;
  /** Chart color, when the page assigns one. */
  color?: string;
}

export interface CopilotRunPicker {
  /** Runs the user can add from the chip (typically the loaded table page). */
  candidates: CopilotRunRef[];
  onToggle: (runId: string, selected: boolean) => void;
  limit: number;
}

/** What the current page tells the copilot about what is on screen. */
export interface CopilotPageContext {
  page: "project" | "run";
  projectName: string;
  /** Human label for the active view, e.g. "All metrics" or "Logs". */
  view?: string;
  /** Selected runs on a project page; the single run on a run page. */
  runs?: CopilotRunRef[];
  runPicker?: CopilotRunPicker;
}

export type ContextChipKey = "project" | "runs" | "view";

export interface ContextChip {
  key: ContextChipKey;
  label: string;
  removable: boolean;
}

export function runLabel(run: CopilotRunRef): string {
  return run.displayId || run.id;
}

export function contextChips(ctx: CopilotPageContext): ContextChip[] {
  const chips: ContextChip[] = [
    { key: "project", label: ctx.projectName, removable: false },
  ];
  if (ctx.runs) {
    const count = ctx.runs.length;
    chips.push({
      key: "runs",
      label:
        ctx.page === "run" && count === 1
          ? runLabel(ctx.runs[0])
          : `${count} ${count === 1 ? "run" : "runs"}`,
      removable: true,
    });
  }
  if (ctx.view) {
    chips.push({ key: "view", label: ctx.view, removable: true });
  }
  return chips;
}

/**
 * Renders the page context as a tagged block the model reads before the
 * user's question. Project and run names are user-controlled, so each
 * is flattened to one line and stripped of angle brackets — a run named
 * "</pluto_page_context>" cannot close the block early.
 */
export function formatPageContext(
  ctx: CopilotPageContext | null,
  excluded: ReadonlySet<ContextChipKey>,
): string | null {
  if (!ctx) return null;

  const head = [
    OPEN_TAG,
    "The user is asking from the Pluto web app. This is what they have on screen; use it to resolve references like “these runs” or “this chart”.",
    `Project: ${clean(ctx.projectName)}`,
  ];
  if (ctx.view && !excluded.has("view")) {
    head.push(`View: ${clean(ctx.view)}`);
  }

  const runs = ctx.runs && !excluded.has("runs") ? ctx.runs : undefined;
  const build = (listed: number): string => {
    const lines = [...head];
    if (runs && ctx.page === "run" && runs.length === 1) {
      lines.push(`Viewing run: ${describeRun(runs[0])}`);
    } else if (runs && runs.length === 0) {
      lines.push("Selected runs: none");
    } else if (runs) {
      lines.push(`Selected runs (${runs.length}):`);
      for (const run of runs.slice(0, listed)) {
        lines.push(`- ${describeRun(run)}`);
      }
      if (runs.length > listed) {
        lines.push(`…and ${runs.length - listed} more`);
      }
    }
    lines.push(CLOSE_TAG);
    return lines.join("\n");
  };

  let listed = Math.min(runs?.length ?? 0, MAX_CONTEXT_RUNS);
  let text = build(listed);
  while (text.length > MAX_CONTEXT_CHARS && listed > 0) {
    listed -= 1;
    text = build(listed);
  }
  return text.length > MAX_CONTEXT_CHARS ? null : text;
}

/**
 * Prefixes the newest user turn with the context preamble. Only that turn
 * gets it: earlier turns were sent with whatever was on screen then, and
 * re-sending stale context would contradict the current view. A regenerate
 * (newest turn is the assistant's) is left untouched. If the preamble would
 * push the message past the server's per-message limit it is dropped — the
 * question matters more than the context.
 */
export function prependContextToLatestUserMessage(
  messages: WireMessage[],
  preamble: string | null,
): WireMessage[] {
  const last = messages[messages.length - 1];
  if (!preamble || !last || last.role !== "user") return messages;

  const text = last.parts.map((part) => part.text).join("");
  const combined = `${preamble}\n\n${text}`;
  if (combined.length > MAX_MESSAGE_CHARS) return messages;

  return [
    ...messages.slice(0, -1),
    { ...last, parts: [{ type: "text", text: combined }] },
  ];
}

export function suggestedPrompts(
  ctx: CopilotPageContext | null,
  fallbackProject?: string,
): string[] {
  const runs = ctx?.runs ?? [];
  if (ctx?.page === "run" && runs.length === 1) {
    const label = runLabel(runs[0]);
    return [
      `Summarize ${label}`,
      "Did anything look unhealthy in this run?",
      "How does this run compare to the project's recent runs?",
    ];
  }
  if (ctx && runs.length > 1) {
    return [
      `Compare the ${runs.length} selected runs`,
      "Which selected run looks best, and why?",
      "What config differences explain the gaps between these runs?",
    ];
  }
  if (ctx && runs.length === 1) {
    return [
      `Summarize ${runLabel(runs[0])}`,
      "Did anything look unhealthy in this run?",
    ];
  }
  const project = ctx?.projectName ?? fallbackProject;
  if (!project) return [];
  return [
    `What are the most recent runs in ${project}?`,
    `Which runs in ${project} failed recently, and why?`,
  ];
}

function describeRun(run: CopilotRunRef): string {
  const status = run.status ? ` [${clean(run.status)}]` : "";
  return `${clean(runLabel(run))} ${clean(run.name)}${status}`;
}

function clean(value: string): string {
  const flat = value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  return flat.length > MAX_FIELD_CHARS
    ? `${flat.slice(0, MAX_FIELD_CHARS - 1)}…`
    : flat;
}
