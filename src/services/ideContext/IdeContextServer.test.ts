import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import { WebSocket } from "ws";
import { IdeContextServer } from "./IdeContextServer";
import { AUTH_HEADER, Method, PROTOCOL_VERSION } from "./protocol";

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ide-server-"));
}

/** Resolves on the next WS message as a parsed JSON-RPC object. */
function nextMessage(ws: WebSocket, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for WS message")),
      timeoutMs,
    );
    ws.once("message", (raw) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(raw.toString()));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function waitForOpen(ws: WebSocket, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WS open timeout")), timeoutMs);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe("IdeContextServer", () => {
  let dir: string;
  let server: IdeContextServer;

  beforeEach(() => {
    dir = tmpDir();
    server = new IdeContextServer(makeLogger(), {
      lockFileDirectory: dir,
      serverName: "test-server",
      serverVersion: "9.9.9",
    });
  });

  afterEach(async () => {
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("start", () => {
    it("starts a WS server and writes a lock file when no active lock exists", async () => {
      const result = await server.start(["/workspace/test"]);

      expect(result.started).toBe(true);
      expect(result.port).toBeGreaterThan(0);

      const lockFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".lock"));
      expect(lockFiles).toContain(`${result.port}.lock`);

      const written = JSON.parse(
        fs.readFileSync(path.join(dir, `${result.port}.lock`), "utf-8"),
      );
      expect(written.transport).toBe("ws");
      expect(written.workspaceFolders).toContain("/workspace/test");
      expect(typeof written.authToken).toBe("string");
      expect(written.authToken.length).toBeGreaterThan(0);
    });

    it("is idempotent when already running", async () => {
      const first = await server.start(["/workspace"]);
      const second = await server.start(["/workspace"]);

      expect(second.started).toBe(true);
      expect(second.port).toBe(first.port);
      expect(second.reason).toContain("already running");
    });

    it("defers when another extension is already serving the workspace", async () => {
      // Stand up a fake "Claude Code" TCP listener + lock file.
      const fakeServer = net.createServer();
      await new Promise<void>((r) => fakeServer.listen(0, "127.0.0.1", r));
      const fakePort = (fakeServer.address() as net.AddressInfo).port;

      fs.writeFileSync(
        path.join(dir, `${fakePort}.lock`),
        JSON.stringify({
          port: fakePort,
          authToken: "competitor-token",
          transport: "ws",
          workspaceFolders: ["/workspace/contested"],
        }),
      );

      const result = await server.start(["/workspace/contested"]);

      expect(result.started).toBe(false);
      expect(result.reason).toContain("deferred");

      // Our own lock file must NOT have been written.
      const locks = fs.readdirSync(dir).filter((f) => f.endsWith(".lock"));
      expect(locks).toEqual([`${fakePort}.lock`]);

      fakeServer.close();
    });
  });

  describe("stop", () => {
    it("removes the lock file on stop", async () => {
      const { port } = await server.start(["/workspace"]);
      expect(fs.existsSync(path.join(dir, `${port}.lock`))).toBe(true);

      await server.stop();

      expect(fs.existsSync(path.join(dir, `${port}.lock`))).toBe(false);
      expect(server.isRunning()).toBe(false);
    });

    it("is safe to call when never started", async () => {
      await expect(server.stop()).resolves.toBeUndefined();
    });
  });

  describe("JSON-RPC protocol", () => {
    async function connectAndHandshake(): Promise<{
      ws: WebSocket;
      authToken: string;
      port: number;
    }> {
      const result = await server.start(["/workspace/proto"]);
      const port = result.port!;
      const lockRaw = fs.readFileSync(path.join(dir, `${port}.lock`), "utf-8");
      const authToken = JSON.parse(lockRaw).authToken as string;

      const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
        headers: { [AUTH_HEADER]: authToken },
      });
      await waitForOpen(ws);

      // Send initialize, expect a result back.
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: Method.Initialize,
          params: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "opencode-test", version: "0.0.0" },
          },
        }),
      );

      const initReply = await nextMessage(ws);
      expect(initReply.id).toBe(1);
      expect(initReply.result.serverInfo.name).toBe("test-server");
      expect(initReply.result.protocolVersion).toBe(PROTOCOL_VERSION);

      // Send the initialized notification to mark the client as ready.
      ws.send(
        JSON.stringify({ jsonrpc: "2.0", method: Method.Initialized }),
      );
      // Give the server a tick to register the client.
      await new Promise((r) => setTimeout(r, 50));

      return { ws, authToken, port };
    }

    it("rejects connections that lack the auth header", async () => {
      const { port } = await server.start(["/workspace/auth"]);

      await expect(
        new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(`ws://127.0.0.1:${port}`);
          ws.once("open", () => resolve());
          ws.once("error", () => reject(new Error("should have been rejected")));
        }),
      ).rejects.toThrow();
    });

    it("pushes selection_changed to ready clients", async () => {
      const { ws } = await connectAndHandshake();

      server.notifySelectionChanged({
        filePath: "/src/file.ts",
        source: "websocket",
        ranges: [
          {
            text: "export const x = 1",
            selection: {
              start: { line: 10, character: 1 },
              end: { line: 10, character: 18 },
            },
          },
        ],
      });

      const msg = await nextMessage(ws);
      expect(msg.method).toBe(Method.SelectionChanged);
      expect(msg.params.filePath).toBe("/src/file.ts");
      expect(msg.params.source).toBe("websocket");
      expect(msg.params.ranges[0].selection.start.line).toBe(10);
    });

    it("pushes at_mentioned to ready clients", async () => {
      const { ws } = await connectAndHandshake();

      server.notifyAtMentioned({
        filePath: "/src/mention.ts",
        lineStart: 5,
        lineEnd: 8,
      });

      const msg = await nextMessage(ws);
      expect(msg.method).toBe(Method.AtMentioned);
      expect(msg.params.filePath).toBe("/src/mention.ts");
      expect(msg.params.lineStart).toBe(5);
      expect(msg.params.lineEnd).toBe(8);
    });

    it("does not push events before the client completes handshake", async () => {
      const result = await server.start(["/workspace/no-handshake"]);
      const port = result.port!;
      const lockRaw = fs.readFileSync(path.join(dir, `${port}.lock`), "utf-8");
      const authToken = JSON.parse(lockRaw).authToken as string;

      const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
        headers: { [AUTH_HEADER]: authToken },
      });
      await waitForOpen(ws);

      // Push without sending initialize/initialized.
      server.notifySelectionChanged({
        filePath: "/x",
        source: "websocket",
        ranges: [
          {
            text: "",
            selection: {
              start: { line: 1, character: 1 },
              end: { line: 1, character: 1 },
            },
          },
        ],
      });

      // The client should NOT receive the message.
      await expect(nextMessage(ws, 400)).rejects.toThrow();
    });
  });
});
