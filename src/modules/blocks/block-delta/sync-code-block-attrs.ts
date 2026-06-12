export type SyncCodeBlockAttrs = {
  language: string;
  codeTheme: "auto" | "github-light" | "github-dark";
  fontSize: "inherit" | "12px" | "13px" | "14px" | "16px";
  indentMode: "space" | "tab";
  indentSize: 2 | 4 | 8;
  wordWrap: boolean;
  lineNumbers: boolean;
  autoIndent: boolean;
  title: string;
  statusBarCollapsed: boolean;
  codeCollapsed: boolean;
};

const DEFAULTS: SyncCodeBlockAttrs = {
  language: "text",
  codeTheme: "auto",
  fontSize: "inherit",
  indentMode: "space",
  indentSize: 2,
  wordWrap: false,
  lineNumbers: true,
  autoIndent: true,
  title: "",
  statusBarCollapsed: false,
  codeCollapsed: false,
};

function normalizeSyncCodeLanguage(lang?: string): string {
  const raw = (lang ?? "").trim().toLowerCase();
  if (!raw) return DEFAULTS.language;
  return COMMON_LANG_ALIASES[raw] ?? raw;
}

const COMMON_LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  md: "markdown",
  yml: "yaml",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  plain: "text",
  plaintext: "text",
  txt: "text",
};

export function normalizeSyncCodeBlockAttrs(
  attrs?: Record<string, unknown> | null,
): SyncCodeBlockAttrs {
  const raw = attrs ?? {};
  const language =
    typeof raw.language === "string" && raw.language.trim()
      ? normalizeSyncCodeLanguage(raw.language)
      : DEFAULTS.language;

  return {
    language,
    codeTheme:
      raw.codeTheme === "github-light" || raw.codeTheme === "github-dark" || raw.codeTheme === "auto"
        ? raw.codeTheme
        : DEFAULTS.codeTheme,
    fontSize:
      raw.fontSize === "12px" ||
      raw.fontSize === "13px" ||
      raw.fontSize === "14px" ||
      raw.fontSize === "16px" ||
      raw.fontSize === "inherit"
        ? raw.fontSize
        : DEFAULTS.fontSize,
    indentMode: raw.indentMode === "tab" || raw.indentMode === "space" ? raw.indentMode : DEFAULTS.indentMode,
    indentSize: raw.indentSize === 4 || raw.indentSize === 8 ? raw.indentSize : DEFAULTS.indentSize,
    wordWrap: typeof raw.wordWrap === "boolean" ? raw.wordWrap : DEFAULTS.wordWrap,
    lineNumbers: typeof raw.lineNumbers === "boolean" ? raw.lineNumbers : DEFAULTS.lineNumbers,
    autoIndent: typeof raw.autoIndent === "boolean" ? raw.autoIndent : DEFAULTS.autoIndent,
    title: typeof raw.title === "string" ? raw.title : DEFAULTS.title,
    statusBarCollapsed:
      typeof raw.statusBarCollapsed === "boolean"
        ? raw.statusBarCollapsed
        : DEFAULTS.statusBarCollapsed,
    codeCollapsed:
      typeof raw.codeCollapsed === "boolean" ? raw.codeCollapsed : DEFAULTS.codeCollapsed,
  };
}
