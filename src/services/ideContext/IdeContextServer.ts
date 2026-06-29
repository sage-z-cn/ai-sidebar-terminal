import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { WebSocketServer, type WebSocket } from "ws";
import type { ILogger } from "../ILogger";
import {
  detectActiveLock,
  defaultLockFileDirectory,
} from "./LockFileDetector";
import {
  AUTH_HEADER,
  type EditorLockFile,
  type EditorMentionPayload,
  type EditorSelectionPayload,
  type InitializeResult,
  type JsonRpcMessage,
  Method,
  PROTOCOL_VERSION,
} from "./protocol";

export interface IdeContextServerOptions {
  /** Directory for `*.lock` files. Defaults to `~/.claude/ide`. */
  lockFileDirectory?: string;
  /** Server identity reported back to the TUI during `initialize`. */
  serverName?: string;
  serverVersion?: string;
}

export interface StartResult {
  /**
   * `true` when this instance owns the WS server.
   * `false` when another extension (e.g. Claude Code) is already serving the
   * context WS for this workspace — callers should skip pushing events.
   */
  started: boolean;
  /** Port we are listening on when `started === true`. */
  port?: number;
  /** Human-readable reason for the outcome, for logging. */
  reason: string;
}

/**
 * Host-side implementation of the editor <-> OpenCode TUI context protocol.
 *
 * Implements "plan C": detect whether Claude Code's VS Code extension (or any
 * other producer following the same `~/.claude/ide/<port>.lock` convention)
 * is already serving the context WS for the active workspace. If so, this
 * server stays silent to avoid competing for the TUI's single connection.
 * Otherwise it starts its own WS server, writes a lock file, and forwards
 * editor selection / @mention events.
 *
 * Lifecycle: construct once per extension activation; call `start()` before
 * spawning OpenCode and `stop()` when the session ends.
 */
export class IdeContextServer {
  private wss?: WebSocketServer;
  private lockFile?: string;
  private port?: number;
  /** Clients that completed the JSON-RPC handshake (`notifications/initialized`). */
  private readonly readyClients = new Set<WebSocket>();
  private readonly serverName: string;
  private readonly serverVersion: string;
  private readonly lockFileDirectory: string;

  constructor(
    private readonly logger: ILogger,
    options: IdeContextServerOptions = {},
  ) {
    this.serverName = options.serverName ?? "ai-sidebar-terminal";
    this.serverVersion = options.serverVersion ?? "0.0.0";
    this.lockFileDirectory =
      options.lockFileDirectory ?? defaultLockFileDirectory();
  }

  /** True when this instance owns a running WS server. */
  public isRunning(): boolean {
    return this.wss !== undefined;
  }

  /**
   * Ensures a context WS is available for the given workspace.
   *
   * - If another producer is already serving this workspace (Claude Code
   *   extension detected via `~/.claude/ide/*.lock`), returns
   *   `{ started: false }` so the caller can skip event forwarding.
   * - Otherwise starts a WS server bound to 127.0.0.1 on a random port,
   *   writes a lock file, and returns the port.
   *
   * Idempotent: if already running, returns the current port.
   */
  public async start(workspaceFolders: string[]): Promise<StartResult> {
    if (this.wss) {
      return {
        started: true,
        port: this.port,
        reason: "already running",
      };
    }

    const primary = workspaceFolders[0] ?? process.cwd();
    const detection = await detectActiveLock(primary, {
      directory: this.lockFileDirectory,
    });
    if (detection.active) {
      this.logger.info(
        `[IdeContextServer] Another editor extension is serving context on port ${detection.lock.port} (${detection.owner}). Skipping self-start.`,
      );
      return {
        started: false,
        reason: `deferred to ${detection.owner} on port ${detection.lock.port}`,
      };
    }

    if (detection.hadStaleEntries) {
      this.logger.debug(
        "[IdeContextServer] Stale lock entries found; ignoring.",
      );
    }

    const authToken = crypto.randomUUID();
    const port = await this.startWebSocketServer(authToken);
    this.port = port;
    this.lockFile = this.writeLockFile(port, authToken, workspaceFolders);

    this.logger.info(
      `[IdeContextServer] Started on ws://127.0.0.1:${port} (lock: ${path.basename(this.lockFile)})`,
    );
    return {
      started: true,
      port,
      reason: "started own WS server",
    };
  }

  /**
   * Stops the WS server and removes the lock file. Safe to call when not
   * running or when deferred to another extension.
   *
   * Force-closes any connected clients first so `wss.close()` doesn't hang
   * waiting for lingering sockets (which happens when a TUI reconnects or a
   * test forgets to close its client).
   */
  public async stop(): Promise<void> {
    this.readyClients.clear();

    if (this.wss) {
      // Forcibly terminate every open socket so the server can shut down
      // promptly regardless of client state.
      for (const client of this.wss.clients) {
        try {
          client.terminate();
        } catch {
          // ignore — socket may already be destroyed
        }
      }

      await new Promise<void>((resolve) => {
        this.wss?.close((err) => {
          if (err) {
            this.logger.warn(
              `[IdeContextServer] Error closing WS server: ${err.message}`,
            );
          }
          resolve();
        });
      });
      this.wss = undefined;
    }

    if (this.lockFile) {
      try {
        fs.unlinkSync(this.lockFile);
      } catch (err) {
        this.logger.debug(
          `[IdeContextServer] Could not remove lock file ${this.lockFile}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      this.lockFile = undefined;
    }
    this.port = undefined;
  }

  /**
   * Pushes the current editor selection to every connected TUI.
   * No-op when not running or no clients have completed the handshake.
   */
  public notifySelectionChanged(payload: EditorSelectionPayload): void {
    this.broadcast(Method.SelectionChanged, payload);
  }

  /** Pushes an @file mention event to every connected TUI. */
  public notifyAtMentioned(payload: EditorMentionPayload): void {
    this.broadcast(Method.AtMentioned, payload);
  }

  // --------------------------------------------------------------------- //

  private startWebSocketServer(authToken: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        host: "127.0.0.1",
        port: 0,
        // Reject any client that doesn't present our auth token. This mirrors
        // Claude Code's `x-claude-code-ide-authorization` convention so the
        // OpenCode TUI's stock `editor.ts` works without modification.
        verifyClient: (
          info: {
            origin: string;
            secure: boolean;
            req: http.IncomingMessage;
          },
        ): boolean => {
          const header = info.req.headers[AUTH_HEADER];
          if (Array.isArray(header)) return header.includes(authToken);
          return header === authToken;
        },
      });

      wss.once("listening", () => {
        const address = wss.address();
        const port =
          typeof address === "object" && address ? address.port : 0;
        if (!port) {
          reject(new Error("WS server bound but port unknown"));
          return;
        }
        this.wss = wss;
        this.attachHandlers(wss);
        resolve(port);
      });

      wss.once("error", (err) => {
        reject(err);
      });
    });
  }

  private attachHandlers(wss: WebSocketServer): void {
    wss.on("connection", (ws, req) => {
      const remote =
        typeof req.socket.remoteAddress === "string"
          ? req.socket.remoteAddress
          : "unknown";
      this.logger.debug(
        `[IdeContextServer] Client connected from ${remote}`,
      );

      ws.on("message", (raw) => {
        const message = parseJsonRpc(raw);
        if (!message) return;

        if (message.method === Method.Initialize && message.id !== undefined) {
          const result: InitializeResult = {
            protocolVersion: PROTOCOL_VERSION,
            serverInfo: {
              name: this.serverName,
              version: this.serverVersion,
            },
            capabilities: {},
          };
          this.send(ws, { jsonrpc: "2.0", id: message.id, result });
          return;
        }

        if (message.method === Method.Initialized) {
          this.readyClients.add(ws);
          this.logger.info(
            "[IdeContextServer] TUI handshake complete; ready to push context",
          );
          return;
        }
      });

      ws.on("close", () => {
        this.readyClients.delete(ws);
        this.logger.debug("[IdeContextServer] Client disconnected");
      });

      ws.on("error", (err) => {
        this.logger.debug(
          `[IdeContextServer] Client socket error: ${err.message}`,
        );
        this.readyClients.delete(ws);
      });
    });
  }

  private writeLockFile(
    port: number,
    authToken: string,
    workspaceFolders: string[],
  ): string {
    try {
      fs.mkdirSync(this.lockFileDirectory, { recursive: true });
    } catch (err) {
      this.logger.warn(
        `[IdeContextServer] Could not create lock dir ${this.lockFileDirectory}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const entry: EditorLockFile = {
      port,
      authToken,
      transport: "ws",
      workspaceFolders,
    };
    const filePath = path.join(this.lockFileDirectory, `${port}.lock`);
    try {
      fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), "utf-8");
    } catch (err) {
      this.logger.warn(
        `[IdeContextServer] Could not write lock file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return filePath;
  }

  private broadcast(method: string, params: unknown): void {
    if (!this.wss) return;
    if (this.readyClients.size === 0) return;

    const serialized = JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
    });

    for (const client of this.readyClients) {
      if (client.readyState === client.OPEN) {
        client.send(serialized);
      }
    }
  }

  private send(ws: WebSocket, message: JsonRpcMessage): void {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(message));
  }
}

function parseJsonRpc(raw: unknown): JsonRpcMessage | undefined {
  let text: string;
  if (typeof raw === "string") {
    text = raw;
  } else if (Buffer.isBuffer(raw)) {
    text = raw.toString("utf-8");
  } else if (Array.isArray(raw)) {
    // ws delivers fragmented messages as Buffer[] (RawData).
    text = Buffer.concat(raw.filter(Buffer.isBuffer)).toString("utf-8");
  } else if (raw instanceof ArrayBuffer) {
    text = new TextDecoder().decode(raw);
  } else if (raw instanceof Uint8Array) {
    text = new TextDecoder().decode(raw);
  } else {
    return undefined;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const msg = parsed as JsonRpcMessage;
    if (msg.jsonrpc !== "2.0") return undefined;
    return msg;
  } catch {
    return undefined;
  }
}

// Re-exported so callers can build payloads without importing protocol.ts
export type {
  EditorMentionPayload,
  EditorSelectionPayload,
  Position,
  SelectionRange,
} from "./protocol";
