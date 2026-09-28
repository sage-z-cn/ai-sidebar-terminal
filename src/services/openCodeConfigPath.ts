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
  const home = os.homedir();
  const configDir = process.env.OPENCODE_CONFIG_DIR;
  const out: string[] = [];
  if (configDir) {
    out.push(path.join(configDir, "cli.json"));
  }
  out.push(path.join(home, ".config", "opencode", "cli.json"));
  out.push(path.join(home, "AppData", "Roaming", "opencode", "cli.json"));
  out.push(path.join(home, "AppData", "Local", "opencode", "cli.json"));
  return out;
}
