import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import {
  detectActiveLock,
  probePort,
  readLockFiles,
  workspaceMatchScore,
} from "./LockFileDetector";
import type { EditorLockFile } from "./protocol";

function writeLock(dir: string, port: number, over: Partial<EditorLockFile> = {}) {
  const entry: EditorLockFile = {
    port,
    authToken: `token-${port}`,
    transport: "ws",
    workspaceFolders: [],
    ...over,
  };
  fs.writeFileSync(path.join(dir, `${port}.lock`), JSON.stringify(entry));
}

function tmpLockDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ide-lock-"));
}

describe("LockFileDetector", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpLockDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("readLockFiles", () => {
    it("returns empty array when directory does not exist", () => {
      expect(readLockFiles("/nonexistent/path/xyz")).toEqual([]);
    });

    it("parses well-formed lock files", () => {
      writeLock(dir, 30001, {
        workspaceFolders: ["/home/user/project"],
      });
      writeLock(dir, 30002, {
        authToken: "abc-123",
        workspaceFolders: ["/other"],
      });

      const locks = readLockFiles(dir);
      expect(locks).toHaveLength(2);
      expect(locks.map((l) => l.port).sort()).toEqual([30001, 30002]);
      expect(locks[0].transport).toBe("ws");
    });

    it("skips files with missing authToken", () => {
      fs.writeFileSync(
        path.join(dir, "30003.lock"),
        JSON.stringify({ port: 30003, transport: "ws" }),
      );
      expect(readLockFiles(dir)).toEqual([]);
    });

    it("skips non-ws transport", () => {
      fs.writeFileSync(
        path.join(dir, "30004.lock"),
        JSON.stringify({
          port: 30004,
          authToken: "x",
          transport: "sse",
          workspaceFolders: [],
        }),
      );
      expect(readLockFiles(dir)).toEqual([]);
    });

    it("skips malformed JSON", () => {
      fs.writeFileSync(path.join(dir, "30005.lock"), "{not json");
      expect(readLockFiles(dir)).toEqual([]);
    });

    it("ignores non-.lock files", () => {
      fs.writeFileSync(path.join(dir, "README"), "nope");
      writeLock(dir, 30006);
      expect(readLockFiles(dir)).toHaveLength(1);
    });
  });

  describe("workspaceMatchScore", () => {
    const lock = (folders: string[]): EditorLockFile => ({
      port: 1,
      authToken: "t",
      transport: "ws",
      workspaceFolders: folders,
    });

    it("scores 0 when no folder contains the target", () => {
      expect(workspaceMatchScore(lock(["/a/b"]), "/x/y")).toBe(0);
    });

    it("scores the parent folder length on match", () => {
      const parent = path.resolve("/a/b");
      const score = workspaceMatchScore(lock(["/a/b"]), "/a/b/c/d");
      expect(score).toBe(path.resolve(parent).length);
    });

    it("picks the longest matching parent when multiple folders match", () => {
      const short = path.resolve("/a");
      const long = path.resolve("/a/b");
      const score = workspaceMatchScore(lock(["/a", "/a/b"]), "/a/b/c");
      expect(score).toBe(path.resolve(long).length);
      expect(score).toBeGreaterThan(path.resolve(short).length);
    });

    it("matches when target equals a workspace folder exactly", () => {
      const target = path.resolve("/workspace");
      const score = workspaceMatchScore(lock([target]), target);
      expect(score).toBe(target.length);
    });
  });

  describe("probePort", () => {
    it("resolves true when a server is listening", async () => {
      const server = net.createServer();
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const port = (server.address() as net.AddressInfo).port;

      await expect(probePort(port, 500)).resolves.toBe(true);

      server.close();
    });

    it("resolves false when nothing is listening", async () => {
      // Pick an almost-certainly-free port by binding then closing.
      const server = net.createServer();
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const port = (server.address() as net.AddressInfo).port;
      await new Promise<void>((r) => server.close(() => r()));

      await expect(probePort(port, 300)).resolves.toBe(false);
    });
  });

  describe("detectActiveLock", () => {
    it("returns inactive when directory is empty", async () => {
      const result = await detectActiveLock("/anywhere", { directory: dir });
      expect(result.active).toBe(false);
    });

    it("returns inactive when a matching lock's port is dead", async () => {
      writeLock(dir, 31000, {
        workspaceFolders: ["/home/user/project"],
      });

      const result = await detectActiveLock("/home/user/project", {
        directory: dir,
        probeTimeoutMs: 200,
      });

      expect(result.active).toBe(false);
      if (!result.active) {
        expect(result.hadStaleEntries).toBe(true);
      }
    });

    it("returns active when a matching lock's port is reachable", async () => {
      // Start a real listener.
      const server = net.createServer();
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const port = (server.address() as net.AddressInfo).port;

      writeLock(dir, port, {
        workspaceFolders: ["/home/user/project"],
      });

      const result = await detectActiveLock("/home/user/project", {
        directory: dir,
        probeTimeoutMs: 500,
      });

      expect(result.active).toBe(true);
      if (result.active) {
        expect(result.lock.port).toBe(port);
      }

      server.close();
    });

    it("does not match locks whose workspaceFolders exclude the target", async () => {
      const server = net.createServer();
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const port = (server.address() as net.AddressInfo).port;

      writeLock(dir, port, {
        workspaceFolders: ["/completely/different"],
      });

      const result = await detectActiveLock("/home/user/project", {
        directory: dir,
        probeTimeoutMs: 200,
      });

      // The lock is alive but does not match this workspace — not reported.
      expect(result.active).toBe(false);

      server.close();
    });
  });
});
