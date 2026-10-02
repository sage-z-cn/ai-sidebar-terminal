import {
  execFile,
  spawn,
  type ChildProcess,
  type ExecFileOptions,
  type SpawnOptions,
} from "node:child_process";
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
const fullVersionCache = new Map<string, string>();
const protocolCache = new Map<string, OpenCodeApiProtocol>();

export type OpenCodeCliDiagnosticLevel = "info" | "warn";
export type OpenCodeCliDiagnosticLogger = (
  level: OpenCodeCliDiagnosticLevel,
  message: string,
) => void;

let diagnosticLogger: OpenCodeCliDiagnosticLogger | undefined;

/**
 * Injects the extension-host logger for probe diagnostics.
 * Unset (default) keeps the module silent; tests reset the hook through
 * `resetOpenCodeCliCompatCaches`.
 */
export function setOpenCodeCliCompatDiagnostics(
  logger: OpenCodeCliDiagnosticLogger | undefined,
): void {
  diagnosticLogger = logger;
}

function logDiagnostic(
  level: OpenCodeCliDiagnosticLevel,
  message: string,
): void {
  diagnosticLogger?.(level, message);
}

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
 * Scans line by line: prefers an `opencode vX.Y` line, then a bare `X.Y`
 * line, so banner noise from shims (e.g. `⠩ v20.20.2`) cannot win.
 */
export function parseOpenCodeMajorVersion(versionOutput: string): number | undefined {
  const lines = versionOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const toMajor = (raw: string): number | undefined => {
    const major = Number(raw);
    return Number.isFinite(major) && major > 0 ? major : undefined;
  };

  for (const line of lines) {
    const match = line.match(/^opencode[/\s]+v?(\d+)\.\d+/i);
    if (match) {
      return toMajor(match[1]);
    }
  }
  for (const line of lines) {
    const match = line.match(/^v?(\d+)(?:\.\d+)+$/);
    if (match) {
      return toMajor(match[1]);
    }
  }
  return undefined;
}

export function protocolForMajorVersion(
  major: number | undefined,
): OpenCodeApiProtocol {
  return major !== undefined && major >= 2 ? "v2" : "v1";
}

/**
 * Extracts the full CLI version string from `--version` output.
 * Scans with the same precedence as `parseOpenCodeMajorVersion` so shim
 * banner noise cannot win; non-version output (e.g. dev builds printing
 * "local") is returned verbatim.
 */
export function parseOpenCodeFullVersion(
  versionOutput: string,
): string | undefined {
  const lines = versionOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const match = line.match(
      /^opencode[/\s]+v?(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)(?=[\s(]|$)/i,
    );
    if (match) {
      return match[1];
    }
  }
  for (const line of lines) {
    const match = line.match(
      /^(?:v)?(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)$/,
    );
    if (match) {
      return match[1];
    }
  }
  return lines[0];
}

let windowsShellRetry = process.platform === "win32";

/** Restores the platform-default Windows shell-retry behavior (tests). */
function resetWindowsShellRetry(): void {
  windowsShellRetry = process.platform === "win32";
}

interface ExecOutcome {
  error?: Error;
  stdout: string;
}

function execOnce(
  file: string,
  args: string[],
  timeoutMs: number,
  extraOpts: ExecFileOptions = {},
): Promise<ExecOutcome> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, ...extraOpts }, (error, stdout) => {
      resolve({
        error: error ?? undefined,
        stdout: stdout ? stdout.toString() : "",
      });
    });
  });
}

function runCli(file: string, args: string[], timeoutMs = 4000): Promise<string> {
  return runCliWithRetry(file, args, timeoutMs).then((outcome) =>
    outcome.error ? "" : outcome.stdout,
  );
}

function logExecFailure(file: string, error: Error): void {
  const code = (error as NodeJS.ErrnoException).code ?? "(none)";
  logDiagnostic(
    "warn",
    `[OpenCodeCliCompat] exec failed: file=${JSON.stringify(file)} code=${code} msg=${error.message}`,
  );
}

/** Characters that force double-quoting inside a cmd.exe command line. */
const CMD_QUOTE_PATTERN = /[\s&()^%|<>"!=;,]/;

/**
 * Builds the command string for the cmd.exe shim-retry path: file and
 * args containing whitespace or a cmd metacharacter are double-quoted
 * with inner quotes doubled; plain tokens pass through untouched.
 */
export function toCmdShellCommand(file: string, args: string[]): string {
  const quote = (part: string): string =>
    CMD_QUOTE_PATTERN.test(part)
      ? `"${part.replace(/"/g, '""')}"`
      : part;
  return [quote(file), ...args.map(quote)].join(" ");
}

/**
 * Runs a CLI command. On Windows, bare names such as `opencode` installed via
 * npm resolve to `.cmd`/`.ps1` shims that `execFile` cannot execute directly
 * (ENOENT/EINVAL), so a failed direct attempt is retried through `cmd.exe`,
 * which applies full PATHEXT resolution.
 */
async function runCliWithRetry(
  file: string,
  args: string[],
  timeoutMs: number,
): Promise<ExecOutcome> {
  const direct = await execOnce(file, args, timeoutMs);
  if (direct.error) {
    logExecFailure(file, direct.error);
  }
  if (!direct.error || !windowsShellRetry) {
    return direct;
  }

  const command = toCmdShellCommand(file, args);
  const viaShell = await execOnce(
    "cmd.exe",
    ["/d", "/s", "/c", `"${command}"`],
    timeoutMs,
    { windowsVerbatimArguments: true },
  );
  if (viaShell.error) {
    logExecFailure(file, viaShell.error);
  }
  return viaShell;
}

/**
 * Runs a CLI command through the Windows shim-retry path and rejects on
 * failure. Shared by update-flow probes so they never duplicate exec logic.
 */
export function runOpenCodeCliCommand(
  file: string,
  args: string[],
  timeoutMs = 4000,
): Promise<string> {
  return runCliWithRetry(file, args, timeoutMs).then((outcome) => {
    if (outcome.error) {
      throw outcome.error;
    }
    return outcome.stdout;
  });
}

/** Stream kind reported through `OpenCodeCliStreamOptions.onLine`. */
export type OpenCodeCliStream = "stdout" | "stderr";

export interface OpenCodeCliStreamOptions {
  timeoutMs?: number;
  /** Aborting kills the child and rejects the promise with the abort error. */
  signal?: AbortSignal;
  /** Receives each output line as it arrives (carry buffer splits chunks). */
  onLine?: (line: string, stream: OpenCodeCliStream) => void;
}

interface StreamOutcome {
  error?: Error;
  stdout: string;
  stderr: string;
}

function splitLines(
  carry: string,
  chunk: string,
): { lines: string[]; carry: string } {
  const parts = (carry + chunk).split(/\r?\n/);
  const rest = parts.pop() ?? "";
  return { lines: parts, carry: rest };
}

function spawnOnce(
  file: string,
  args: string[],
  options: SpawnOptions,
  onLine: ((line: string, stream: OpenCodeCliStream) => void) | undefined,
): Promise<StreamOutcome> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let outCarry = "";
    let errCarry = "";
    let settled = false;

    let child: ChildProcess;
    try {
      child = spawn(file, args, { windowsHide: true, ...options });
    } catch (error) {
      resolve({
        error: error instanceof Error ? error : new Error(String(error)),
        stdout,
        stderr,
      });
      return;
    }

    const finish = (error: Error | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      // stdout/stderr already hold the raw chunks; flush only the pending
      // line fragments through onLine.
      if (outCarry) {
        onLine?.(outCarry, "stdout");
      }
      if (errCarry) {
        onLine?.(errCarry, "stderr");
      }
      resolve({ error, stdout, stderr });
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      const split = splitLines(outCarry, chunk);
      outCarry = split.carry;
      for (const line of split.lines) {
        onLine?.(line, "stdout");
      }
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      const split = splitLines(errCarry, chunk);
      errCarry = split.carry;
      for (const line of split.lines) {
        onLine?.(line, "stderr");
      }
    });
    child.on("error", (error: Error) => finish(error));
    child.on("close", (code: number | null) => {
      finish(
        code === 0
          ? undefined
          : new Error(`${file} exited with code ${code ?? "(unknown)"}`),
      );
    });
  });
}

/**
 * Runs a long-lived CLI command (e.g. `opencode upgrade`) with live output
 * streaming, timeout, and abort. Uses the same Windows shim retry as
 * `runCliWithRetry`; the retry is skipped once the child produced output so
 * a partially executed command is never re-run. Rejects on failure, with
 * all captured lines already delivered through `onLine`.
 */
export async function streamOpenCodeCliCommand(
  file: string,
  args: string[],
  options: OpenCodeCliStreamOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 4000;
  const spawnOptions: SpawnOptions = { timeout: timeoutMs };
  if (options.signal) {
    spawnOptions.signal = options.signal;
  }

  const direct = await spawnOnce(
    file,
    args,
    spawnOptions,
    options.onLine,
  );
  if (direct.error) {
    logExecFailure(file, direct.error);
  }

  let outcome = direct;
  if (
    direct.error &&
    !direct.stdout &&
    !direct.stderr &&
    windowsShellRetry &&
    !options.signal?.aborted
  ) {
    const command = toCmdShellCommand(file, args);
    const viaShell = await spawnOnce(
      "cmd.exe",
      ["/d", "/s", "/c", `"${command}"`],
      { ...spawnOptions, windowsVerbatimArguments: true },
      options.onLine,
    );
    if (viaShell.error) {
      logExecFailure(file, viaShell.error);
    }
    outcome = viaShell;
  }

  if (outcome.error) {
    throw outcome.error;
  }
  return outcome.stdout;
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
  logDiagnostic(
    "info",
    `[OpenCodeCliCompat] version probe: binary=${JSON.stringify(binary)} major=${major ?? "(none)"} output=${JSON.stringify(output)}`,
  );
  if (major !== undefined) {
    versionCache.set(binary, major);
  }
  return major;
}

/**
 * Resolves the full OpenCode CLI version string from `<bin> --version`
 * (e.g. "1.18.33"; dev builds print "local"). Returns undefined when the
 * probe fails.
 */
export async function getOpenCodeVersion(
  commandOrBinary = "opencode",
): Promise<string | undefined> {
  const binary = extractCliBinary(commandOrBinary);
  const cached = fullVersionCache.get(binary);
  if (cached !== undefined) {
    return cached;
  }

  const output = await runCli(binary, ["--version"]);
  const version = parseOpenCodeFullVersion(output);
  logDiagnostic(
    "info",
    `[OpenCodeCliCompat] full version probe: binary=${JSON.stringify(binary)} version=${JSON.stringify(version ?? "(none)")} output=${JSON.stringify(output)}`,
  );
  if (version !== undefined) {
    fullVersionCache.set(binary, version);
  }
  return version;
}

/** Clears cached CLI version/protocol lookups (tests). */
export function resetOpenCodeCliCompatCaches(): void {
  versionCache.clear();
  fullVersionCache.clear();
  protocolCache.clear();
  resetWindowsShellRetry();
  diagnosticLogger = undefined;
}

/**
 * Clears only the version/protocol caches while keeping the diagnostics
 * sink and Windows shell-retry wiring intact. Production reset for the
 * self-update verify step, which must re-probe `--version` without
 * unwiring probe diagnostics.
 */
export function resetOpenCodeCliVersionCaches(): void {
  versionCache.clear();
  fullVersionCache.clear();
  protocolCache.clear();
}

/** Overrides the Windows shell-retry behavior (tests only). */
export function __setWindowsShellRetryForTests(enabled: boolean): void {
  windowsShellRetry = enabled;
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
  // Unknown version: omit the flag. A v2 TUI rejects `--port` outright
  // (fatal at startup), while a v1 TUI merely runs without the HTTP API
  // (degraded but usable). The version can stay unknown when the CLI is
  // only on the user's shell PATH (e.g. bun/npm global installs), which
  // the extension host process does not inherit.
  if (
    cliMajorVersion === undefined ||
    protocolForMajorVersion(cliMajorVersion) === "v2"
  ) {
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

  logDiagnostic(
    "info",
    `[OpenCodeCliCompat] v2 service probe: ${v2ServiceStatePaths()
      .map((file) => `${file}=${fs.existsSync(file) ? "exists" : "missing"}`)
      .join(" | ")}`,
  );

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
 * Resolves the HTTP API protocol for a CLI command via `--version`.
 * Unknown versions fall back to v1.
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
  const protocol = protocolForMajorVersion(major);
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
