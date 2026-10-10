import * as path from "node:path";

/**
 * Pure install-method detection for the OpenCode self-update flow,
 * mirroring opencode's own upgrade detection. Process execution is
 * injected through `RunFn` so tests never spawn package managers.
 */

export type RunFn = (
  file: string,
  args: string[],
  timeoutMs?: number,
) => Promise<string>;

export type OpenCodeInstallMethodId =
  | "curl"
  | "npm"
  | "pnpm"
  | "bun"
  | "yarn"
  | "brew";

export interface DetectedInstallMethod {
  method: string;
  /** True when the resolved npm install lives under an nvm-managed tree. */
  nvmManaged: boolean;
}

interface PathClassification {
  method: OpenCodeInstallMethodId;
  nvmManaged: boolean;
}

/**
 * Parses the `--method` choices line from `opencode upgrade --help` output,
 * e.g. `(choices: curl, npm, pnpm, bun, yarn, vp, brew)`.
 * Returns undefined when no choices line can be found.
 */
export function parseUpgradeMethodChoices(
  helpOutput: string,
): string[] | undefined {
  const lines = helpOutput.split(/\r?\n/);
  const parseLine = (line: string): string[] | undefined => {
    const match = line.match(/\(choices:\s*([^)]+)\)/);
    if (!match) {
      return undefined;
    }
    const choices = match[1]
      .split(",")
      .map((choice) => choice.trim())
      .filter(Boolean);
    return choices.length ? choices : undefined;
  };

  for (const line of lines) {
    if (line.includes("--method")) {
      const parsed = parseLine(line);
      if (parsed) {
        return parsed;
      }
    }
  }
  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed) {
      return parsed;
    }
  }
  return undefined;
}

/**
 * Matches a path fragment against both separator styles so Windows
 * backslash paths and POSIX paths hit the same rule on any host.
 */
function pathContains(binPath: string, ...segments: string[]): boolean {
  const posix = segments.join("/");
  const native = path.join(...segments);
  return binPath.includes(posix) || binPath.includes(native);
}

/**
 * Classifies an install method from the binary path alone, mirroring
 * opencode's own path heuristics. Returns undefined when inconclusive;
 * callers then fall back to package-manager probes.
 */
export function classifyPath(
  binPath: string,
  platform: NodeJS.Platform,
): OpenCodeInstallMethodId | undefined {
  return classifyPathDetails(binPath, platform)?.method;
}

function classifyPathDetails(
  binPath: string,
  platform: NodeJS.Platform,
): PathClassification | undefined {
  const isWindows = platform === "win32";

  if (
    pathContains(binPath, ".opencode", "bin") ||
    pathContains(binPath, ".local", "bin")
  ) {
    return { method: "curl", nvmManaged: false };
  }

  if (
    !isWindows &&
    (binPath.includes("/opt/homebrew/") ||
      binPath.includes("/usr/local/Cellar/") ||
      binPath.includes("/home/linuxbrew/.linuxbrew/"))
  ) {
    return { method: "brew", nvmManaged: false };
  }

  if (binPath.includes(".nvm")) {
    return { method: "npm", nvmManaged: true };
  }

  if (
    isWindows
      ? pathContains(binPath, "AppData", "Local", "pnpm")
      : pathContains(binPath, "Library", "pnpm") ||
        pathContains(binPath, ".local", "share", "pnpm")
  ) {
    return { method: "pnpm", nvmManaged: false };
  }

  if (pathContains(binPath, ".bun", "bin")) {
    return { method: "bun", nvmManaged: false };
  }

  if (
    pathContains(binPath, ".yarn", "bin") ||
    (isWindows && pathContains(binPath, "Yarn", "bin"))
  ) {
    return { method: "yarn", nvmManaged: false };
  }

  if (isWindows && pathContains(binPath, "AppData", "Roaming", "npm")) {
    return { method: "npm", nvmManaged: false };
  }

  // Unix npm globals (e.g. /usr/local/bin) are not distinguishable by
  // path; callers resolve them through package-manager probes.
  return undefined;
}

interface PackageManagerProbe {
  method: string;
  file: string;
  args: string[];
  /** Output substring that marks the package as installed. */
  needle: string;
}

/**
 * Probe order mirrors opencode's upgrade detection. The JS package
 * managers match only the v2 scoped package `@opencode/cli` — the update
 * feature is v2-only and the legacy v1 `opencode-ai` line is gated out.
 */
const PACKAGE_MANAGER_PROBES: readonly PackageManagerProbe[] = [
  {
    method: "npm",
    file: "npm",
    args: ["list", "-g", "--depth=0"],
    needle: "@opencode/cli",
  },
  {
    method: "yarn",
    file: "yarn",
    args: ["global", "list"],
    needle: "@opencode/cli",
  },
  {
    method: "pnpm",
    file: "pnpm",
    args: ["list", "-g", "--depth=0"],
    needle: "@opencode/cli",
  },
  {
    method: "bun",
    file: "bun",
    args: ["pm", "ls", "-g"],
    needle: "@opencode/cli",
  },
  {
    method: "brew",
    file: "brew",
    args: ["list", "--formula", "opencode"],
    needle: "opencode",
  },
  {
    method: "scoop",
    file: "scoop",
    args: ["list", "opencode"],
    needle: "opencode",
  },
  {
    method: "choco",
    file: "choco",
    args: ["list", "--limit-output", "opencode"],
    needle: "opencode",
  },
];

/**
 * Detects how opencode was installed. Path heuristics win; otherwise each
 * package manager is probed in opencode's own order. Probe errors count as
 * no-match; the final fallback is "unknown".
 */
export async function detectInstallMethod(
  binPath: string,
  platform: NodeJS.Platform,
  run: RunFn,
): Promise<DetectedInstallMethod> {
  const classified = classifyPathDetails(binPath, platform);
  if (classified) {
    return classified;
  }

  for (const probe of PACKAGE_MANAGER_PROBES) {
    let output: string;
    try {
      output = await run(probe.file, probe.args);
    } catch {
      // Package manager absent or failed: no match, try the next one.
      continue;
    }
    if (output.includes(probe.needle)) {
      return { method: probe.method, nvmManaged: false };
    }
  }
  return { method: "unknown", nvmManaged: false };
}

/**
 * Detects nvm-windows (`nvm version` printing 2.x or newer, which supports
 * the reshim flow the update steps rely on). Any failure returns false.
 */
export async function detectNvmWindows(run: RunFn): Promise<boolean> {
  let output: string;
  try {
    output = await run("nvm", ["version"]);
  } catch {
    return false;
  }
  const token = output.trim().split(/\s+/)[0] ?? "";
  const match = /^v?(\d+)/.exec(token);
  return match ? Number(match[1]) >= 2 : false;
}

/**
 * Picks the default upgrade method: the persisted last-used method when
 * still offered, then the detected method, then npm (opencode always
 * offers it), then the first choice as a safety net.
 */
export function getDefaultMethod(
  choices: string[],
  lastUsed: string | undefined,
  detected: string | undefined,
): string {
  if (lastUsed && choices.includes(lastUsed)) {
    return lastUsed;
  }
  if (detected && choices.includes(detected)) {
    return detected;
  }
  return choices.includes("npm") ? "npm" : (choices[0] ?? "npm");
}
