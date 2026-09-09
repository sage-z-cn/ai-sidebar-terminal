
export interface DroppedBlobFile {
  name: string;
  data: string;
}

export type TerminalBackendType = "native";

export type WebviewMessage =
  | { type: "terminalInput"; data: string }
  | { type: "terminalResize"; cols: number; rows: number }
  | { type: "listTerminals" }
  | {
      type: "openFile";
      path: string;
      line?: number;
      endLine?: number;
      column?: number;
    }
  | { type: "openUrl"; url: string }
  | { type: "ready"; cols: number; rows: number }
  | {
      type: "filesDropped";
      files: string[];
      shiftKey: boolean;
      dropCell?: { col: number; row: number };
      blobFiles?: DroppedBlobFile[];
    }
  | { type: "setClipboard"; text: string }
  | { type: "triggerPaste" }
  | { type: "imagePasted"; data: string }
  | {
      type: "launchAiTool";
      sessionId: string;
      tool: string;
      savePreference: boolean;
    }
  | { type: "requestRestart" }
  | { type: "requestAiToolSelector" }
  | { type: "toggleEditorAttachment" }
  | { type: "openSettings" }
  | { type: "openKeyboardShortcuts" };

export type AiTool = string;

export interface AiToolConfig {
  name: string;
  label: string;
  path: string;
  args: string[];
  aliases?: string[];
  operator?: string;
  enabled?: boolean;
}

export const DEFAULT_AI_TOOLS: readonly AiToolConfig[] = [
  {
    name: "opencode",
    label: "OpenCode",
    path: "",
    args: ["-c"],
    aliases: [],
    operator: "opencode",
  },
  {
    name: "claude",
    label: "Claude Code",
    path: "",
    args: [],
    aliases: ["claude"],
    operator: "claude",
  },
  {
    name: "codex",
    label: "Codex",
    path: "",
    args: [],
    aliases: [],
    operator: "codex",
  },
  {
    name: "gemini",
    label: "Gemini CLI",
    path: "",
    args: [],
    aliases: [],
    operator: "gemini",
  },
  {
    name: "qwen",
    label: "Qwen Code",
    path: "",
    args: [],
    aliases: [],
  },
  {
    name: "kimi",
    label: "Kimi Code",
    path: "",
    args: [],
    aliases: ["kimi-code"],
    operator: "kimi",
  },
  {
    name: "mimo",
    label: "Mimo Code",
    path: "",
    args: [],
    aliases: ["mimo-code"],
    operator: "mimo",
  },
] as const;

export function resolveAiToolConfigs(
  userTools: readonly unknown[],
): AiToolConfig[] {
  if (!Array.isArray(userTools) || userTools.length === 0) {
    return [...DEFAULT_AI_TOOLS];
  }

  const parsed = userTools
    .filter(
      (t): t is Record<string, unknown> =>
        t !== null &&
        typeof t === "object" &&
        typeof (t as Record<string, unknown>).name === "string" &&
        typeof (t as Record<string, unknown>).label === "string",
    )
    .map((t) => ({
      name: String(t.name),
      label: String(t.label),
      path: typeof t.path === "string" ? t.path : "",
      args: Array.isArray(t.args) ? t.args.map(String) : [],
      aliases: Array.isArray(t.aliases) ? t.aliases.map(String) : undefined,
      operator: typeof t.operator === "string" ? t.operator : undefined,
      enabled: typeof t.enabled === "boolean" ? t.enabled : undefined,
    }));

  const userByName = new Map(parsed.map((t) => [t.name, t]));
  const userSeen = new Set<string>();

  const merged: AiToolConfig[] = [];

  for (const defaultTool of DEFAULT_AI_TOOLS) {
    const userOverride = userByName.get(defaultTool.name);
    userSeen.add(defaultTool.name);

    if (userOverride) {
      merged.push({
        ...defaultTool,
        ...userOverride,
        aliases: userOverride.aliases ?? defaultTool.aliases,
        operator: userOverride.operator ?? defaultTool.operator,
        path: userOverride.path || defaultTool.path,
        args:
          userOverride.args.length > 0 ? userOverride.args : defaultTool.args,
      });
    } else {
      merged.push({ ...defaultTool });
    }
  }

  for (const tool of parsed) {
    if (!userSeen.has(tool.name)) {
      merged.push(tool);
    }
  }

  return merged.filter((t) => t.enabled !== false);
}

export function getToolLaunchCommand(tool: AiToolConfig): string {
  const exe = tool.path || tool.name;
  const args = tool.args.length > 0 ? ` ${tool.args.join(" ")}` : "";
  return exe + args;
}

export function getToolDetectionPatterns(tool: AiToolConfig): string[] {
  const patterns = new Set<string>([tool.name, `${tool.name}.exe`]);
  if (tool.operator) {
    patterns.add(tool.operator);
    patterns.add(`${tool.operator}.exe`);
  }
  for (const alias of tool.aliases ?? []) {
    patterns.add(alias);
    patterns.add(`${alias}.exe`);
  }
  patterns.add(tool.label);
  if (tool.path) {
    const basename = tool.path
      .split("/")
      .pop()
      ?.split("\\")
      .pop()
      ?.replace(/\.exe$/i, "");
    if (basename && basename !== tool.name) {
      patterns.add(basename);
    }
  }
  return Array.from(patterns);
}

export function detectAiToolName(
  text: string | undefined,
  tools: readonly AiToolConfig[],
): string | undefined {
  const haystack = text?.toLowerCase();
  if (!haystack) {
    return undefined;
  }

  for (const tool of tools) {
    const patterns = getToolDetectionPatterns(tool).map((pattern) =>
      pattern.toLowerCase(),
    );
    if (patterns.some((pattern) => pattern && haystack.includes(pattern))) {
      return tool.name;
    }
  }

  return undefined;
}

export const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

export type FocusIndicatorMode = "off" | "bottomBorder" | "fullBorder";

export type HostMessage =
  | { type: "requestPaste" }
  | { type: "clipboardContent"; text: string }
  | { type: "terminalList"; terminals: Array<{ name: string; cwd: string }> }
  | { type: "terminalOutput"; data: string }
  | { type: "terminalExited" }
  | { type: "clearTerminal" }
  | { type: "focusTerminal" }
  | { type: "webviewVisible" }
  | {
      type: "platformInfo";
      platform: string;
      activeBackend?: TerminalBackendType;
    }
  | {
      type: "terminalConfig";
      fontSize: number;
      fontFamily: string;
      cursorBlink: boolean;
      cursorStyle: "block" | "underline" | "bar";
      scrollback: number;
      sendKeybindingsToShell?: boolean;
      isEditorTab?: boolean;
      focusIndicatorMode?: FocusIndicatorMode;
      focusIndicatorBorderWidth?: number;
    }
  | { type: "activeSession"; backend?: TerminalBackendType; aiToolLabel?: string; aiTools?: readonly { name: string; label: string }[] }
  | {
      type: "showAiToolSelector";
      sessionId: string;
      sessionName: string;
      defaultTool?: string;
      tools?: AiToolConfig[];
    }
export type LogLevel = "debug" | "info" | "warn" | "error";
export type DiagnosticSeverity = "error" | "warning" | "information" | "hint";

export interface ExtensionConfig {
  autoStart: boolean;
  command: string;
  fontSize: number;
  fontFamily: string;
  cursorBlink: boolean;
  cursorStyle: "block" | "underline" | "bar";
  scrollback: number;
  autoFocusOnSend: boolean;
  autoStartOnOpen: boolean;
  shellPath: string;
  shellArgs: string[];
  autoShareContext: boolean;
  httpTimeout: number;
  enableHttpApi: boolean;
  logLevel: LogLevel;
  contextDebounceMs: number;
  maxDiagnosticLength: number;
  enableAutoSpawn: boolean;
  codeActionSeverities: DiagnosticSeverity[];
}
