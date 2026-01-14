/**
 * Extensions that can be displayed as plaintext with syntax highlighting.
 * These files will be rendered in the TextView component.
 */
export const PLAINTEXT_EXTENSIONS = new Set([
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
 * Check if a file type should be rendered as plaintext.
 */
export function isPlaintextFile(fileType: string): boolean {
  return PLAINTEXT_EXTENSIONS.has(fileType.toLowerCase());
}

/**
 * Map file extensions to Prism language identifiers for syntax highlighting.
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
    rst: "rest",
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
    dockerfile: "docker",
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
