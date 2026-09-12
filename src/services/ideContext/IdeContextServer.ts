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
  /**
   * Last `selection_changed` payload. Replayed to newly connected TUIs so the
   * prompt UI shows the current editor file without waiting for the next
   * selection event (OpenCode accepts this before handshake completes).
   */
  private lastSelection?: EditorSelectionPayload;
  /**
   * Optional live snapshot of the active editor. Used when a TUI connects
   * before any `selection_changed` event has fired (e.g. user already had a
   * file open when the extension activated).
   */
  private selectionSnapshotProvider?: () => EditorSelectionPayload | undefined;
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

  /** Number of TUI clients that finished the JSON-RPC handshake. */
  public getReadyClientCount(): number {
    return this.readyClients.size;
  }

  /** Number of TUI sockets currently connected (auth accepted). */
  public getConnectedClientCount(): number {
    return this.wss?.clients.size ?? 0;
  }

  /**
   * Registers a callback that returns the active editor selection. Called
   * when a client connects and no cached `lastSelection` exists yet.
   */
  public setSelectionSnapshotProvider(
    provider: () => EditorSelectionPayload | undefined,
  ): void {
    this.selectionSnapshotProvider = provider;
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
    this.logger.info(
      `[IdeContextServer] Probing lock dir ${this.lockFileDirectory} for workspace ${primary}`,
    );
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
      `[IdeContextServer] Started on ws://127.0.0.1:${port} (lock: ${path.basename(this.lockFile)}, folders: ${workspaceFolders.join(", ") || "(none)"})`,
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
    const hadClients = this.readyClients.size;
    const wasRunning = this.wss !== undefined;
    this.logger.info(
      `[IdeContextServer] Stopping (running=${wasRunning}, readyClients=${hadClients}, lock=${this.lockFile ? path.basename(this.lockFile) : "none"})`,
    );
    this.readyClients.clear();
    this.lastSelection = undefined;

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
   *
   * OpenCode's `context/editor.ts` handles `selection_changed` as soon as the
   * socket is open — it does NOT wait for `initialize` / `notifications/initialized`.
   * We therefore fan out to every open socket, not only handshake-complete ones,
   * so a TUI that connects but never finishes MCP init still shows editor context.
   */
  public notifySelectionChanged(payload: EditorSelectionPayload): void {
    this.lastSelection = payload;
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
          const provided = Array.isArray(header) ? header.join(",") : header;
          const ok = Array.isArray(header)
            ? header.includes(authToken)
            : header === authToken;
          if (!ok) {
            // Silent auth failures make TUI connect-timeout look like a
            // display bug; surface the mismatch in the Output channel.
            this.logger.warn(
              `[IdeContextServer] Rejected WS client: auth token mismatch (header present=${provided !== undefined && provided !== ""})`,
            );
          }
          return ok;
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
      this.logger.info(
        `[IdeContextServer] Client connected from ${remote}`,
      );

      // Prefer the latest event; fall back to a live editor snapshot so a
      // file that was already open at activation still reaches the TUI.
      this.ensureLastSelection();
      this.replaySelectionTo(ws, "on-connect");

      ws.on("message", (raw) => {
        const preview = describeRawMessage(raw);
        this.logger.info(`[IdeContextServer] WS message ${preview}`);

        const message = parseJsonRpc(raw);
        if (!message) {
          this.logger.warn(
            `[IdeContextServer] Failed to parse WS message ${preview}`,
          );
          return;
        }

        if (message.method === Method.Initialize && message.id !== undefined) {
          const result: InitializeResult = {
            protocolVersion: PROTOCOL_VERSION,
            serverInfo: {
              name: this.serverName,
              version: this.serverVersion,
            },
            capabilities: {},
          };
          this.logger.info(
            `[IdeContextServer] Received initialize (id=${message.id}); replying protocolVersion=${PROTOCOL_VERSION}`,
          );
          this.send(ws, { jsonrpc: "2.0", id: message.id, result });
          // OpenCode's message handler is fully wired by the time it sends
          // initialize — push the cached selection again in case the
          // on-connect replay raced with the client's open listener.
          this.replaySelectionTo(ws, "on-initialize");
          return;
        }

        if (message.method === Method.Initialized) {
          this.readyClients.add(ws);
          this.logger.info(
            `[IdeContextServer] TUI handshake complete; ready to push context (readyClients=${this.readyClients.size})`,
          );
          return;
        }

        this.logger.info(
          `[IdeContextServer] Ignored WS message method=${message.method ?? "(none)"}`,
        );
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
    // Only `selection_changed` is cached for connect-time replay; other
    // notifications (e.g. `at_mentioned`) are dropped when nobody is
    // connected.
    const cached = method === Method.SelectionChanged;

    if (!this.wss) {
      this.logger.debug(
        cached
          ? `[IdeContextServer] Cached ${method}: WS server not running yet (will replay when a client connects)`
          : `[IdeContextServer] Dropped ${method}: WS server not running (only selection_changed is cached)`,
      );
      return;
    }

    const openSockets = [...this.wss.clients].filter(
      (client) => client.readyState === client.OPEN,
    );
    if (openSockets.length === 0) {
      this.logger.debug(
        cached
          ? `[IdeContextServer] Cached ${method}: no open TUI sockets yet (total=${this.wss.clients.size}; will replay on connect)`
          : `[IdeContextServer] Dropped ${method}: no open TUI sockets (total=${this.wss.clients.size}; only selection_changed is replayed on connect)`,
      );
      return;
    }

    const serialized = JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
    });

    let sent = 0;
    for (const client of openSockets) {
      client.send(serialized);
      sent += 1;
    }

    this.logger.debug(
      `[IdeContextServer] Broadcast ${method} to ${sent}/${openSockets.length} open client(s), readyClients=${this.readyClients.size}, ${serialized.length} bytes`,
    );
  }

  /**
   * Fills `lastSelection` from the live editor snapshot when no event has
   * been cached yet.
   */
  private ensureLastSelection(): void {
    if (this.lastSelection || !this.selectionSnapshotProvider) return;
    const snapshot = this.selectionSnapshotProvider();
    if (!snapshot) return;
    this.lastSelection = snapshot;
    this.logger.info(
      `[IdeContextServer] Seeded lastSelection from live editor snapshot file=${snapshot.filePath}`,
    );
  }

  /**
   * Sends the cached `selection_changed` payload to a single socket.
   * OpenCode accepts this before MCP handshake completes.
   *
   * OpenCode's current TUI client attaches its WebSocket `message` listener
   * synchronously before `open` fires, so the immediate send should already
   * be received. The retry ladder is belt-and-suspenders for client
   * implementations that wire their listener later (e.g. inside their `open`
   * handler). `lastSelection` is read when each timer fires so a newer editor
   * event is never overwritten by a stale copy.
   */
  private replaySelectionTo(ws: WebSocket, reason: string): void {
    this.ensureLastSelection();
    // 0ms: best-effort immediate; later ticks cover late listener attach.
    for (const delayMs of [0, 80, 250, 800]) {
      setTimeout(() => {
        if (ws.readyState !== ws.OPEN) return;
        if (!this.lastSelection) return;
        const serialized = JSON.stringify({
          jsonrpc: "2.0",
          method: Method.SelectionChanged,
          params: this.lastSelection,
        });
        ws.send(serialized);
        this.logger.info(
          `[IdeContextServer] Replayed cached selection_changed (${reason} +${delayMs}ms) ${serialized.length} bytes file=${this.lastSelection.filePath}`,
        );
      }, delayMs);
    }
  }

  private send(ws: WebSocket, message: JsonRpcMessage): void {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(message));
  }
}

function describeRawMessage(raw: unknown): string {
  if (typeof raw === "string") {
    return `type=string len=${raw.length} body=${raw.slice(0, 180)}`;
  }
  if (Buffer.isBuffer(raw)) {
    const text = raw.toString("utf-8");
    return `type=buffer len=${raw.length} body=${text.slice(0, 180)}`;
  }
  if (Array.isArray(raw)) {
    return `type=buffer[] parts=${raw.length}`;
  }
  if (raw instanceof ArrayBuffer) {
    return `type=ArrayBuffer len=${raw.byteLength}`;
  }
  if (raw instanceof Uint8Array) {
    const text = new TextDecoder().decode(raw);
    return `type=Uint8Array len=${raw.byteLength} body=${text.slice(0, 180)}`;
  }
  return `type=${typeof raw}`;
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
