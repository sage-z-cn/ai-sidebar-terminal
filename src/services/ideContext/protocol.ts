/**
 * JSON-RPC 2.0 protocol types for the editor <-> OpenCode TUI WebSocket link.
 *
 * This is the SAME protocol Claude Code's VS Code extension exposes, which
 * OpenCode TUI consumes in `packages/opencode/src/cli/cmd/tui/context/editor.ts`:
 *
 *   1. TUI connects to ws://127.0.0.1:<port> discovered via a lock file at
 *      `~/.claude/ide/<port>.lock` containing { port, authToken, transport,
 *      workspaceFolders }.
 *   2. TUI sends `initialize` request; server replies with serverInfo.
 *   3. TUI sends `notifications/initialized`.
 *   4. Server pushes `selection_changed` whenever the active editor/selection
 *      changes, and `at_mentioned` when the user triggers an @file reference.
 *
 * Line/character offsets in `selection` are 1-based (matches OpenCode TUI's
 * `offsetToPosition` which does `line += 1`).
 */

export const PROTOCOL_VERSION = "2025-11-25";

/** Header the WS client must send to authenticate (Claude Code convention). */
export const AUTH_HEADER = "x-claude-code-ide-authorization";

export interface Position {
  /** 1-based line number */
  line: number;
  /** 1-based column number */
  character: number;
}

export interface SelectionRange {
  /** Selected text (may be empty string when the "selection" is a caret) */
  text: string;
  selection: {
    start: Position;
    end: Position;
  };
}

export interface EditorSelectionPayload {
  /** Absolute file path of the active editor document */
  filePath: string;
  /** Always "websocket" for the WS transport */
  source: "websocket";
  /** At least one range is required by the OpenCode schema */
  ranges: SelectionRange[];
}

export interface EditorMentionPayload {
  /** Absolute file path */
  filePath: string;
  /** 1-based start line */
  lineStart: number;
  /** 1-based end line */
  lineEnd: number;
}

export interface ServerInfo {
  name: string;
  version: string;
}

export interface InitializeResult {
  protocolVersion: string;
  serverInfo: ServerInfo;
  capabilities: Record<string, unknown>;
}

/** JSON-RPC 2.0 envelope shared by every message on the wire. */
export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}

/** Method names used on the wire. */
export const Method = {
  Initialize: "initialize",
  Initialized: "notifications/initialized",
  SelectionChanged: "selection_changed",
  AtMentioned: "at_mentioned",
} as const;

/**
 * Lock file shape written to `~/.claude/ide/<port>.lock`.
 * Filename (without `.lock`) is the port number as a decimal string.
 */
export interface EditorLockFile {
  port: number;
  authToken: string;
  transport: "ws";
  /** Workspace folder paths this server serves. */
  workspaceFolders: string[];
}
