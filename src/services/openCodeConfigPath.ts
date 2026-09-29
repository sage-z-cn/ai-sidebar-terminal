import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Resolve the OpenCode cli.json path. OPENCODE_CONFIG_DIR wins even if the file is missing. */
export function resolveOpenCodeCliConfigPath(): string {
  const configDir = process.env.OPENCODE_CONFIG_DIR;
  if (configDir) {
    return path.join(configDir, "cli.json");
  }
  for (const file of openCodeCliConfigCandidates()) {
    if (fs.existsSync(file)) {
      return file;
    }
  }
  return openCodeCliConfigCandidates()[0];
}

export function openCodeCliConfigCandidates(): string[] {
  return openCodeConfigDirCandidates().map((dir) => path.join(dir, "cli.json"));
}

/** Config directories checked for OpenCode global files (cli.json / opencode.json / AGENTS.md). */
export function openCodeConfigDirCandidates(): string[] {
  const home = os.homedir();
  const configDir = process.env.OPENCODE_CONFIG_DIR;
  const out: string[] = [];
  if (configDir) {
    out.push(configDir);
  }
  out.push(path.join(home, ".config", "opencode"));
  out.push(path.join(home, "AppData", "Roaming", "opencode"));
  out.push(path.join(home, "AppData", "Local", "opencode"));
  return out;
}

/** Primary OpenCode config directory (env override or first existing candidate). */
export function resolveOpenCodeConfigDir(): string {
  const configDir = process.env.OPENCODE_CONFIG_DIR;
  if (configDir) {
    return configDir;
  }
  for (const dir of openCodeConfigDirCandidates()) {
    if (fs.existsSync(dir)) {
      return dir;
    }
  }
  return openCodeConfigDirCandidates()[0];
}

/**
 * Resolve the global AGENTS.md path (OpenCode global agent instructions).
 * OPENCODE_CONFIG_DIR wins even if the file is missing.
 * Returns an existing file when found; otherwise the preferred create/open path.
 */
export function resolveOpenCodeGlobalAgentsMdPath(): string {
  const configDir = process.env.OPENCODE_CONFIG_DIR;
  if (configDir) {
    return path.join(configDir, "AGENTS.md");
  }
  for (const dir of openCodeConfigDirCandidates()) {
    const file = path.join(dir, "AGENTS.md");
    if (fs.existsSync(file)) {
      return file;
    }
  }
  return path.join(resolveOpenCodeConfigDir(), "AGENTS.md");
}

/**
 * Resolve the global opencode.json / opencode.jsonc path.
 * OPENCODE_CONFIG_DIR wins even if the file is missing.
 * Prefers an existing file (json first, then jsonc); otherwise opencode.json
 * in the preferred config directory.
 */
export function resolveOpenCodeGlobalConfigPath(): string {
  const configDir = process.env.OPENCODE_CONFIG_DIR;
  if (configDir) {
    for (const name of ["opencode.json", "opencode.jsonc"]) {
      const file = path.join(configDir, name);
      if (fs.existsSync(file)) {
        return file;
      }
    }
    return path.join(configDir, "opencode.json");
  }
  for (const dir of openCodeConfigDirCandidates()) {
    for (const name of ["opencode.json", "opencode.jsonc"]) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) {
        return file;
      }
    }
  }
  return path.join(resolveOpenCodeConfigDir(), "opencode.json");
}

/**
 * Ensure a global OpenCode file exists and return its path.
 * Creates an empty starter (or `{}` for JSON config) when missing.
 */
export function ensureOpenCodeGlobalFile(
  target: "agentsMd" | "opencodeJson" | "cliJson",
): string {
  const filePath =
    target === "agentsMd"
      ? resolveOpenCodeGlobalAgentsMdPath()
      : target === "cliJson"
        ? resolveOpenCodeCliConfigPath()
        : resolveOpenCodeGlobalConfigPath();
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      target === "agentsMd" ? "" : "{}\n",
      "utf8",
    );
  }
  return filePath;
}
