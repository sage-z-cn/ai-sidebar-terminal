import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  buildOpenCodeHttpPortArg,
  buildOpenCodeV2AuthHeader,
  detectOpenCodeApiProtocol,
  detectOpenCodeMajorVersion,
  extractCliBinary,
  parseOpenCodeMajorVersion,
  protocolForMajorVersion,
  resetOpenCodeCliCompatCaches,
  resolveOpenCodeV2Service,
} from "./OpenCodeCliCompat";
import { execFile } from "node:child_process";
import * as fs from "node:fs";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    readFileSync: vi.fn(),
  };
});

const mockExecFile = vi.mocked(execFile);
const mockReadFileSync = vi.mocked(fs.readFileSync);

describe("OpenCodeCliCompat", () => {
  beforeEach(() => {
    resetOpenCodeCliCompatCaches();
    vi.clearAllMocks();
  });

  describe("extractCliBinary", () => {
    it("extracts bare and quoted binaries", () => {
      expect(extractCliBinary("opencode -c")).toBe("opencode");
      expect(extractCliBinary('"/opt/bin/opencode" --headless')).toBe(
        "/opt/bin/opencode",
      );
      expect(extractCliBinary("'/opt/bin/opencode' -c")).toBe(
        "/opt/bin/opencode",
      );
      expect(extractCliBinary("")).toBe("opencode");
    });
  });

  describe("parseOpenCodeMajorVersion", () => {
    it("parses common version strings", () => {
      expect(parseOpenCodeMajorVersion("opencode v2.0.6")).toBe(2);
      expect(parseOpenCodeMajorVersion("2.0.6")).toBe(2);
      expect(parseOpenCodeMajorVersion("opencode/1.18.0")).toBe(1);
      expect(parseOpenCodeMajorVersion("1.17.11")).toBe(1);
      expect(parseOpenCodeMajorVersion("not a version")).toBeUndefined();
    });
  });

  describe("buildOpenCodeHttpPortArg", () => {
    it("emits --port=N for v1 and omits it for v2", () => {
      expect(buildOpenCodeHttpPortArg(1, 59867)).toBe("--port=59867");
      expect(buildOpenCodeHttpPortArg(undefined, 59867)).toBe("--port=59867");
      expect(buildOpenCodeHttpPortArg(2, 59867)).toBeUndefined();
      expect(buildOpenCodeHttpPortArg(3, 59867)).toBeUndefined();
    });
  });

  describe("protocolForMajorVersion", () => {
    it("maps major versions to API protocols", () => {
      expect(protocolForMajorVersion(undefined)).toBe("v1");
      expect(protocolForMajorVersion(1)).toBe("v1");
      expect(protocolForMajorVersion(2)).toBe("v2");
    });
  });

  describe("detectOpenCodeMajorVersion", () => {
    type ExecCb = (error: Error | null, stdout: string) => void;
    const lastArgAsCb = (args: unknown[]): ExecCb =>
      args[args.length - 1] as ExecCb;

    it("parses and caches CLI version output", async () => {
      mockExecFile.mockImplementation((...args: unknown[]) => {
        lastArgAsCb(args)(null, "opencode v2.0.6\n");
        return {} as ReturnType<typeof execFile>;
      });

      await expect(detectOpenCodeMajorVersion("opencode")).resolves.toBe(2);
      await expect(detectOpenCodeMajorVersion("opencode")).resolves.toBe(2);
      expect(mockExecFile).toHaveBeenCalledTimes(1);
    });

    it("returns undefined when version command fails", async () => {
      mockExecFile.mockImplementation((...args: unknown[]) => {
        lastArgAsCb(args)(new Error("nope"), "");
        return {} as ReturnType<typeof execFile>;
      });

      await expect(detectOpenCodeMajorVersion("missing-bin")).resolves.toBeUndefined();
    });
  });

  describe("resolveOpenCodeV2Service", () => {
    it("reads url and password from local service state", async () => {
      mockReadFileSync.mockImplementation((file) => {
        const value = String(file);
        if (value.includes("state") && value.endsWith("service.json")) {
          return JSON.stringify({
            url: "http://127.0.0.1:49374",
            password: "secret",
            version: "2.0.6",
            pid: 42,
          });
        }
        throw new Error("ENOENT");
      });

      const service = await resolveOpenCodeV2Service();
      expect(service).toMatchObject({
        url: "http://127.0.0.1:49374",
        port: 49374,
        password: "secret",
        version: "2.0.6",
        pid: 42,
      });
    });

    it("falls back to `service status` when state files are missing", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      mockExecFile.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1] as (
          e: Error | null,
          out: string,
        ) => void;
        const cliArgs = args[1];
        if (Array.isArray(cliArgs) && cliArgs[0] === "service") {
          cb(null, "http://127.0.0.1:41234\n");
        } else {
          cb(new Error("nope"), "");
        }
        return {} as ReturnType<typeof execFile>;
      });

      const service = await resolveOpenCodeV2Service("opencode");
      expect(service).toMatchObject({
        url: "http://127.0.0.1:41234",
        port: 41234,
      });
    });
  });

  describe("detectOpenCodeApiProtocol", () => {
    type ExecCb = (error: Error | null, stdout: string) => void;
    const lastArgAsCb = (args: unknown[]): ExecCb =>
      args[args.length - 1] as ExecCb;

    it("returns v2 when major version is 2+", async () => {
      mockExecFile.mockImplementation((...args: unknown[]) => {
        lastArgAsCb(args)(null, "opencode v2.0.6");
        return {} as ReturnType<typeof execFile>;
      });

      await expect(detectOpenCodeApiProtocol("opencode")).resolves.toBe("v2");
    });

    it("returns v1 when major version is 1", async () => {
      mockExecFile.mockImplementation((...args: unknown[]) => {
        lastArgAsCb(args)(null, "1.18.0");
        return {} as ReturnType<typeof execFile>;
      });

      await expect(detectOpenCodeApiProtocol("opencode")).resolves.toBe("v1");
    });
  });

  describe("buildOpenCodeV2AuthHeader", () => {
    it("builds Basic auth for the opencode user", () => {
      const header = buildOpenCodeV2AuthHeader("secret");
      expect(header.startsWith("Basic ")).toBe(true);
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
      expect(decoded).toBe("opencode:secret");
    });
  });
});
