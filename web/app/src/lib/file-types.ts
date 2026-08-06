/**
 * Extensions that can be displayed as plaintext with syntax highlighting.
 * These files will be rendered in the TextView component.
 */
const PLAINTEXT_EXTENSIONS = new Set([
  // Text
  "txt",
  "text",
  "log",
  // Code
  "py",
  "js",
  "ts",
  "jsx",
  "tsx",
  "go",
  "rs",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
  "cs",
  "rb",
  "php",
  "swift",
  "kt",
  "scala",
  "r",
  "lua",
  "pl",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  // Config
  "yaml",
  "yml",
  "json",
  "toml",
  "ini",
  "cfg",
  "conf",
  "env",
  "properties",
  "xml",
  "plist",
  // Data
  "csv",
  "tsv",
  // Markup/Docs
  "md",
  "markdown",
  "rst",
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  // Other
  "sql",
  "graphql",
  "dockerfile",
  "gitignore",
  "editorconfig",
]);

/**
 * Raster/vector images that can be shown inline with an <img> tag.
 *
 * Matters for migrated runs: a matplotlib figure arrives as a plain raster
 * artifact, and without this it fell through to the binary branch and rendered
 * as "Preview not available - Download File" despite being a perfectly
 * displayable image.
 *
 * SVG is included deliberately — an <img> does not execute scripts inside an
 * SVG, so this stays safe for untrusted migrated content (unlike inlining it).
 */
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "avif",
  "ico",
]);

/** Markup that is worth rendering as a page rather than as source text. */
const HTML_EXTENSIONS = new Set(["html", "htm"]);

/**
 * Check if a file type should be rendered as plaintext.
 */
export function isPlaintextFile(fileType: string): boolean {
  return PLAINTEXT_EXTENSIONS.has(fileType.toLowerCase());
}

/**
 * Check if a file type can be displayed inline as an image.
 */
export function isImageFile(fileType: string): boolean {
  return IMAGE_EXTENSIONS.has(fileType.toLowerCase().replace(/^\./, ""));
}

/**
 * Check if a file type should be rendered as HTML rather than as source.
 *
 * These are still plaintext (so their source is fetched and remains available
 * via the source toggle), but a migrated wandb HTML artifact is meant to be
 * *seen*, not read as markup.
 */
export function isHtmlFile(fileType: string): boolean {
  return HTML_EXTENSIONS.has(fileType.toLowerCase().replace(/^\./, ""));
}

/**
 * Can this file type be rendered inside a chart-sized widget?
 *
 * The single source of truth for two decisions that MUST agree:
 *
 *   1. `metrics-display.tsx` decides which FILE/TEXT/ARTIFACT logs get a widget
 *      on the all-runs Charts tab at all.
 *   2. `multi-group/file.tsx` decides whether that widget renders the file or
 *      falls back to a "View in Files" link.
 *
 * When these disagreed, (1) was the stricter of the two and silently removed
 * the log before (2) ever mounted — which made the Plotly / matplotlib figure
 * and 3D point-cloud viewers unreachable from the all-runs page even though
 * they were fully implemented.
 *
 * `json` is included because a Plotly figure, a matplotlib figure (wandb
 * converts these to Plotly at log time) and a `wandb.Object3D` point cloud all
 * arrive as plain `.json` under a UUID filename — only the *content* can say
 * which, so the type check has to let them through and let the viewer sniff.
 * A raw `.table.json` artifact blob also gets through here and degrades to the
 * link fallback, which is the correct outcome for something unreadable at
 * widget size.
 */
export function isRenderableInWidget(fileType: string): boolean {
  return (
    isImageFile(fileType) ||
    isHtmlFile(fileType) ||
    fileType.toLowerCase().replace(/^\./, "") === "json"
  );
}

/**
 * Log types whose widget renders a FILE rather than a plot.
 *
 * Shared so the all-runs Charts view and the individual-run All Metrics view
 * cannot disagree about what "a file log" even is.
 */
export const FILE_LOG_TYPES: ReadonlySet<string> = new Set([
  "FILE",
  "TEXT",
  "ARTIFACT",
]);

/**
 * wandb's per-source-run artifact dumps, e.g. `run-1yg0m03c-bar_table:v0`.
 *
 * Deliberately narrow. This rule hides a log outright with no UI affordance to
 * reveal it, and it runs against every project — not just migrated ones — so it
 * must not plausibly match a name a user chose. A wandb run id is exactly 8
 * characters of [a-z0-9], so requiring that shape (rather than the `.+` this
 * started as) keeps the rule targeted at the thing it was written for.
 *
 * Exported for the tests that pin the shape; production code should call
 * `isWandbArtifactLogName` so there is exactly one matcher.
 */
export const WANDB_ARTIFACT_RE = /^run-[a-z0-9]{8}-.+:v\d+$/;

/**
 * Is this log one of wandb's own per-run artifact dumps?
 *
 * These are plumbing, not content: a migrated project carries one per source
 * run (65 of them in `mega-unsupported`, all raw JSON), and each one that
 * reaches a metrics view is a widget whose entire payload is a download link —
 * or, on the individual-run page, a fully fetched and syntax-highlighted JSON
 * document. They stay reachable on the run's Files tab.
 *
 * The single source of truth for BOTH metrics views. When only the all-runs
 * view applied it, one `.json` dump per source run rendered on the run's own
 * page — the exact drift this shared definition exists to prevent.
 */
export function isWandbArtifactLogName(logName: string): boolean {
  return WANDB_ARTIFACT_RE.test(logName);
}

/**
 * The logs of one group that deserve a widget on the individual-run All
 * Metrics view — and, because an empty result means "nothing to show", the
 * predicate that decides whether the group is displayed at all.
 *
 * Two rules, in the same order the all-runs view applies them
 * (`metrics-display.tsx`):
 *
 *   1. NAME: wandb artifact dumps are dropped from every group, whatever else
 *      is in it. Identical to all-runs.
 *   2. TYPE: within a group made ENTIRELY of file logs, only files a widget
 *      can draw are kept.
 *
 * Rule 2 is deliberately narrower than all-runs, which prunes non-renderable
 * file logs from every group including mixed ones. A mixed group is a group the
 * user built (`train/loss` beside `train/samples.txt`), and the run page is
 * exactly where reading that text file is the point — it has rendered there
 * since long before any of this, so it keeps rendering. The all-runs view has
 * no such history: a file log only ever reached it through the renderable
 * check.
 *
 * `renderableFileLogNames` holds the log names whose files a widget can draw,
 * built from the run's `(logName, fileType)` pairs — `RunLogs` records a log's
 * TYPE, and rule 2 needs its files' EXTENSIONS.
 */
/**
 * Should this log be hidden outright as one of wandb's artifact dumps?
 *
 * The conjunction, not either half: the NAME rule only applies to a log that is
 * a FILE type in the first place, so that a user's own metric named like an
 * artifact is never swallowed by it.
 *
 * Exists because both metrics views need this exact test and each had typed it
 * out, which is how the rule drifted twice before — once missing from the run
 * page entirely, so every wandb `.json` dump rendered there as a fetched,
 * syntax-highlighted document. One spelling, three callers.
 */
export function isHiddenArtifactLog(logType: string, logName: string): boolean {
  return FILE_LOG_TYPES.has(logType) && isWandbArtifactLogName(logName);
}

export function keepVisibleFileLogs<
  T extends { logName: string; logType: string },
>(logs: T[], renderableFileLogNames: ReadonlySet<string>): T[] {
  const named = logs.filter(
    (log) => !isHiddenArtifactLog(log.logType, log.logName),
  );
  // `[].every()` is true, so an all-dumps group correctly falls through to the
  // renderable filter and comes back empty.
  if (!named.every((log) => FILE_LOG_TYPES.has(log.logType))) return named;
  return named.filter((log) => renderableFileLogNames.has(log.logName));
}

/**
 * The all-runs view's renderable rule, for ONE file log.
 *
 * Lives here beside `keepVisibleFileLogs` so both metrics views' rules are in
 * one file, even though they compose them differently (see that function).
 *
 * The three-way answer matters because the all-runs view cannot probe every
 * selected run — it asks a sample (`metrics-display.tsx` takes 3) and applies
 * the answer to the whole selection. So a log name falls into one of:
 *
 *   * **probed, renderable** — show it.
 *   * **probed, not renderable** — hide it. This is the wandb `.table.json`
 *     dump case the filter exists for.
 *   * **not probed at all** — NO EVIDENCE, so show it. A log that only run #4
 *     carries is absent from a 3-run sample, and treating "unseen" as
 *     "undrawable" silently hid a real Plotly figure from the comparison view
 *     with no way to get it back. Showing it is safe: `MultiGroupFile` sniffs
 *     the content itself and degrades to a "View in Files" link when it turns
 *     out to be a blob, so the worst case is one link card rather than a
 *     missing chart.
 */
export function isFileLogWidgetVisible(
  logType: string,
  logName: string,
  renderableFileLogNames: ReadonlySet<string>,
  probedFileLogNames: ReadonlySet<string>,
): boolean {
  if (!FILE_LOG_TYPES.has(logType)) return true;
  if (renderableFileLogNames.has(logName)) return true;
  return !probedFileLogNames.has(logName);
}

/**
 * Map file extensions to Shiki language identifiers for syntax highlighting.
 */
export function getLanguageForExtension(ext: string): string {
  const languageMap: Record<string, string> = {
    // JavaScript/TypeScript
    js: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    // Python
    py: "python",
    // Systems
    go: "go",
    rs: "rust",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    // JVM
    java: "java",
    kt: "kotlin",
    scala: "scala",
    // Config
    yaml: "yaml",
    yml: "yaml",
    json: "json",
    toml: "toml",
    xml: "xml",
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    sass: "sass",
    less: "less",
    ini: "ini",
    cfg: "ini",
    conf: "ini",
    properties: "properties",
    // Shell
    sh: "bash",
    bash: "bash",
    zsh: "zsh",
    fish: "fish",
    ps1: "powershell",
    // Data
    sql: "sql",
    csv: "csv",
    // Markup
    md: "markdown",
    markdown: "markdown",
    rst: "rst",
    // Ruby
    rb: "ruby",
    // PHP
    php: "php",
    // Swift
    swift: "swift",
    // C#
    cs: "csharp",
    // R
    r: "r",
    // Lua
    lua: "lua",
    // Perl
    pl: "perl",
    // GraphQL
    graphql: "graphql",
    // Other
    dockerfile: "dockerfile",
    gitignore: "gitignore",
  };
  return languageMap[ext.toLowerCase()] || "text";
}

/**
 * Format file size for display.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * A segmentation mask that belongs to another image, not a picture in its own
 * right. Its pixels encode class ids, so rendering it directly shows a
 * near-black tile — it is referenced from that image's `annotations` and drawn
 * as a recoloured overlay instead.
 *
 * Marked by `fileType` rather than a naming convention so the check is explicit
 * and does not depend on how the SDK happens to name files.
 */
export function isMaskFile(fileType: string | null | undefined): boolean {
  return (fileType ?? "").toLowerCase() === "mask";
}
