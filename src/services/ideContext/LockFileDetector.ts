import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import type { EditorLockFile } from "./protocol";

/**
 * Detects whether another editor extension (e.g. Claude Code's VS Code
 * extension) is already serving the editor-context WebSocket for a given
 * workspace.
 *
 * OpenCode TUI reads `~/.claude/ide/<port>.lock` files to discover WS
 * servers (see `editor.ts#resolveEditorLockFile`). When Claude Code's
 * extension is installed and running, it writes these lock files and
 * serves the WS protocol itself — we must NOT start our own server in
 * that case, or we'd compete for the same TUI connection.
 *
 * This module is pure Node.js (no `vscode` import) so it stays unit-testable.
 */

/** Default directory where Claude Code writes editor IDE lock files. */
export function defaultLockFileDirectory(): string {
  return path.join(os.homedir(), ".claude", "ide");
}

/**
 * Reads and parses every `*.lock` file in the given directory.
 * Files that cannot be parsed are silently skipped (matches OpenCode TUI's
 * own tolerance for malformed entries).
 */
export function readLockFiles(directory: string = defaultLockFileDirectory()): EditorLockFile[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(directory);
  } catch {
    return [];
  }

  const results: EditorLockFile[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".lock")) continue;
    const parsed = parseLockFile(path.join(directory, entry));
    if (parsed) results.push(parsed);
  }
  return results;
}

function parseLockFile(filePath: string): EditorLockFile | undefined {
  const port = parsePort(path.basename(filePath, ".lock"));
  if (!port) return undefined;

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (!parsed || typeof parsed !== "object") return undefined;
  const record = parsed as Record<string, unknown>;

  // OpenCode TUI rejects entries whose transport is set and != "ws".
  if (record.transport !== undefined && record.transport !== "ws") return undefined;

  const authToken = typeof record.authToken === "string" ? record.authToken : undefined;
  if (!authToken) return undefined;

  const workspaceFolders = Array.isArray(record.workspaceFolders)
    ? record.workspaceFolders.filter((v): v is string => typeof v === "string")
    : [];

  return { port, authToken, transport: "ws", workspaceFolders };
}

function parsePort(value: string): number | undefined {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) return undefined;
  return n;
}

/**
 * Scores how well a lock file's `workspaceFolders` cover the target directory.
 * Returns the length of the longest matching parent, or 0 if no match.
 * (Mirrors `pathContainsLength` in OpenCode's `editor.ts`.)
 */
export function workspaceMatchScore(lock: EditorLockFile, targetDir: string): number {
  const target = path.resolve(targetDir);
  return lock.workspaceFolders.reduce((best, folder) => {
    const parent = path.resolve(folder);
    const rel = path.relative(parent, target);
    const matches = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    return matches ? Math.max(best, parent.length) : best;
  }, 0);
}

/**
 * Probes whether a TCP port on localhost is currently accepting connections.
 * Used to detect stale lock files (process crashed without cleanup).
 *
 * Resolves to `true` if the connection succeeded, `false` on refusal or
 * timeout. Never rejects — callers can `await` without try/catch.
 */
export function probePort(port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
    socket.connect(port, "127.0.0.1");
  });
}

export interface ActiveLockDetection {
  /** An active lock exists — caller should NOT start its own WS server. */
  active: true;
  lock: EditorLockFile;
  /** Stable identifier of the owning extension, for logging only. */
  owner: string;
}

/** No active lock — caller may start its own WS server. */
export interface NoActiveLock {
  active: false;
  /** Lock files were present but stale (port unreachable). */
  hadStaleEntries: boolean;
}

export type LockDetectionResult = ActiveLockDetection | NoActiveLock;

/**
 * Finds the best active lock file for the given workspace, if any.
 *
 * "Active" means: lock file exists, workspaceFolders overlap the target,
 * AND the TCP port is currently accepting connections.
 *
 * When multiple locks match, prefers the one with the longest workspace
 * folder match (same heuristic as OpenCode TUI).
 */
export async function detectActiveLock(
  workspaceDir: string,
  options: { directory?: string; probeTimeoutMs?: number } = {},
): Promise<LockDetectionResult> {
  const directory = options.directory ?? defaultLockFileDirectory();
  const timeoutMs = options.probeTimeoutMs ?? 300;

  const locks = readLockFiles(directory);
  if (locks.length === 0) return { active: false, hadStaleEntries: false };

  const ranked = locks
    .map((lock) => ({ lock, score: workspaceMatchScore(lock, workspaceDir) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) {
    return { active: false, hadStaleEntries: hasReachablePort(locks, timeoutMs) };
  }

  // Probe ranked candidates in order; first reachable wins.
  let hadStaleEntries = false;
  for (const { lock } of ranked) {
    const alive = await probePort(lock.port, timeoutMs);
    if (alive) {
      return {
        active: true,
        lock,
        owner: inferOwner(lock),
      };
    }
    hadStaleEntries = true;
  }

  return { active: false, hadStaleEntries };
}

function hasReachablePort(locks: EditorLockFile[], timeoutMs: number): boolean {
  // Synchronous best-effort: we only need a rough signal for logging. The
  // expensive async probe runs in detectActiveLock's main path.
  return locks.some((lock) => lock.port > 0);
}

function inferOwner(lock: EditorLockFile): string {
  // Heuristic: Claude Code's lock files always carry an authToken. We can't
  // reliably distinguish producers, so just report the directory convention.
  return lock.authToken ? "claude-code" : "unknown";
}
