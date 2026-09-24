import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * OpenCode CLI compatibility helpers for v1 (TUI-hosted HTTP + `--port`) and
 * v2 (background service + Basic auth, TUI rejects `--port`).
 */

export type OpenCodeApiProtocol = "v1" | "v2";

export interface OpenCodeV2ServiceInfo {
  /** Full service base URL, e.g. http://127.0.0.1:49374 */
  url: string;
  port: number;
  /** Basic-auth password; username is always "opencode". */
  password?: string;
  version?: string;
  pid?: number;
}

const versionCache = new Map<string, number>();
const protocolCache = new Map<string, OpenCodeApiProtocol>();

/** Extracts the executable from a shell command string. */
export function extractCliBinary(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) {
    return "opencode";
  }

  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    const end = trimmed.indexOf(quote, 1);
    if (end > 0) {
      return trimmed.slice(1, end);
    }
  }

  return trimmed.split(/\s+/)[0] || trimmed;
}

/**
 * Parses a major version from CLI version output.
 * Accepts `opencode v2.0.6`, `2.0.6`, `opencode/1.18.0`, etc.
 */
export function parseOpenCodeMajorVersion(versionOutput: string): number | undefined {
  const match = versionOutput.match(/v?(\d+)\.\d+/);
  if (!match) {
    return undefined;
  }

  const major = Number(match[1]);
  return Number.isFinite(major) && major > 0 ? major : undefined;
}

export function protocolForMajorVersion(
  major: number | undefined,
): OpenCodeApiProtocol {
  return major !== undefined && major >= 2 ? "v2" : "v1";
}

function runCli(file: string, args: string[], timeoutMs = 4000): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs }, (error, stdout) => {
      if (error) {
        resolve("");
        return;
      }
      resolve(stdout.toString());
    });
  });
}

/**
 * Detects the OpenCode CLI major version from `<bin> --version`.
 * Returns undefined when detection fails; callers should fall back to v1.
 */
export async function detectOpenCodeMajorVersion(
  commandOrBinary: string,
): Promise<number | undefined> {
  const binary = extractCliBinary(commandOrBinary);
  const cached = versionCache.get(binary);
  if (cached !== undefined) {
    return cached;
  }

  const output = await runCli(binary, ["--version"]);
  const major = parseOpenCodeMajorVersion(output);
  if (major !== undefined) {
    versionCache.set(binary, major);
  }
  return major;
}

/** Clears cached CLI version/protocol lookups (tests). */
export function resetOpenCodeCliCompatCaches(): void {
  versionCache.clear();
  protocolCache.clear();
}

/**
 * Builds the HTTP port CLI arg for a tool launch command.
 * v1: `--port=N`. v2: undefined (TUI attaches to the background service and
 * rejects `--port`).
 */
export function buildOpenCodeHttpPortArg(
  cliMajorVersion: number | undefined,
  port: number,
): string | undefined {
  if (protocolForMajorVersion(cliMajorVersion) === "v2") {
    return undefined;
  }
  return `--port=${port}`;
}

function homePath(...parts: string[]): string {
  return path.join(os.homedir(), ...parts);
}

/** Candidate service.json locations used by OpenCode v2. */
export function v2ServiceStatePaths(): string[] {
  return [
    homePath(".local", "state", "opencode", "service.json"),
    homePath(".local", "share", "opencode", "service.json"),
    homePath("AppData", "Local", "opencode", "service.json"),
    homePath("AppData", "Roaming", "opencode", "service.json"),
  ];
}

/** Candidate service password locations used by OpenCode v2. */
export function v2ServicePasswordPaths(): string[] {
  return [
    homePath(".config", "opencode", "service.json"),
    homePath(".local", "state", "opencode", "service.json"),
    homePath("AppData", "Roaming", "opencode", "service.json"),
    homePath("AppData", "Local", "opencode", "service.json"),
  ];
}

function parsePortFromUrl(url: string): number | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.port) {
      const port = Number(parsed.port);
      return Number.isFinite(port) ? port : undefined;
    }
    return parsed.protocol === "https:" ? 443 : 80;
  } catch {
    const match = url.match(/:(\d{2,5})(?:\/|$)/);
    return match ? Number(match[1]) : undefined;
  }
}

function readJsonFile(file: string): Record<string, unknown> | undefined {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore unreadable/missing files
  }
  return undefined;
}

/**
 * Resolves the OpenCode v2 background-service endpoint (URL, port, password).
 * Reads local service state first, then falls back to `opencode service status`.
 */
export async function resolveOpenCodeV2Service(
  commandOrBinary = "opencode",
): Promise<OpenCodeV2ServiceInfo | undefined> {
  let url: string | undefined;
  let password: string | undefined;
  let version: string | undefined;
  let pid: number | undefined;

  for (const file of v2ServiceStatePaths()) {
    const data = readJsonFile(file);
    if (!data) {
      continue;
    }
    if (typeof data.url === "string" && data.url) {
      url = data.url;
    }
    if (typeof data.password === "string" && data.password) {
      password = data.password;
    }
    if (typeof data.version === "string") {
      version = data.version;
    }
    if (typeof data.pid === "number") {
      pid = data.pid;
    }
    if (url) {
      break;
    }
  }

  if (!password) {
    for (const file of v2ServicePasswordPaths()) {
      const data = readJsonFile(file);
      if (data && typeof data.password === "string" && data.password) {
        password = data.password;
        break;
      }
    }
  }

  if (!url) {
    const binary = extractCliBinary(commandOrBinary);
    const status = (await runCli(binary, ["service", "status"])).trim();
    const statusUrl = status.match(/https?:\/\/\S+/)?.[0];
    if (statusUrl) {
      url = statusUrl.replace(/[.,;]$/, "");
    }
  }

  if (!url) {
    return undefined;
  }

  const port = parsePortFromUrl(url);
  if (port === undefined) {
    return undefined;
  }

  return { url, port, password, version, pid };
}

/**
 * Resolves the HTTP API protocol for a CLI command.
 * Uses `--version` first; falls back to presence of a v2 background service.
 */
export async function detectOpenCodeApiProtocol(
  commandOrBinary = "opencode",
): Promise<OpenCodeApiProtocol> {
  const binary = extractCliBinary(commandOrBinary);
  const cached = protocolCache.get(binary);
  if (cached) {
    return cached;
  }

  const major = await detectOpenCodeMajorVersion(binary);
  let protocol = protocolForMajorVersion(major);

  if (major === undefined) {
    const service = await resolveOpenCodeV2Service(binary);
    if (service) {
      protocol = "v2";
    }
  }

  protocolCache.set(binary, protocol);
  return protocol;
}

/** HTTP Basic username used by OpenCode v2 service auth (`opencode pair`). */
export const OPENCODE_V2_AUTH_USERNAME = "opencode";

export function buildOpenCodeV2AuthHeader(password: string): string {
  const token = Buffer.from(
    `${OPENCODE_V2_AUTH_USERNAME}:${password}`,
    "utf8",
  ).toString("base64");
  return `Basic ${token}`;
}
