/**
 * Discover OpenCode theme catalogs from disk at runtime.
 *
 * Built-in themes are embedded in the opencode binary (no HTTP list API),
 * so they come from the hardcoded fallback catalog. Custom themes are the
 * only reliable runtime source: `themes/*.json` in the user OpenCode config
 * directories and in `.opencode/themes` of the project directory explicitly
 * passed in by the caller.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { OpenCodeThemeSwatch } from "../../types";
import {
  builtinThemeSwatch,
  swatchFromThemeJson,
} from "./openCodeThemeSwatches";

export interface DiscoveredTheme {
  name: string;
  swatch: OpenCodeThemeSwatch;
  source: "user" | "project" | "unknown";
  path?: string;
}

function uniquePush(
  list: DiscoveredTheme[],
  seen: Map<string, DiscoveredTheme>,
  entry: DiscoveredTheme,
): void {
  const existing = seen.get(entry.name);
  seen.set(entry.name, entry);
  if (existing) {
    const idx = list.findIndex((t) => t.name === entry.name);
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
    return;
  }
  list.push(entry);
}

function readThemeFile(
  file: string,
  name: string,
  source: DiscoveredTheme["source"],
): DiscoveredTheme {
  let swatch: OpenCodeThemeSwatch = {};
  try {
    const raw = fs.readFileSync(file, "utf8");
    swatch = swatchFromThemeJson(JSON.parse(raw));
  } catch {
    swatch = builtinThemeSwatch(name);
  }
  return { name, swatch, source, path: file };
}

function scanThemeDir(
  dir: string,
  source: DiscoveredTheme["source"],
  list: DiscoveredTheme[],
  seen: Map<string, DiscoveredTheme>,
): void {
  let entries: string[];
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const name = entry.slice(0, -".json".length);
    if (!name) continue;
    uniquePush(list, seen, readThemeFile(path.join(dir, entry), name, source));
  }
}

function userThemeDirs(): string[] {
  const dirs: string[] = [];
  const configDir = process.env.OPENCODE_CONFIG_DIR;
  if (configDir) {
    dirs.push(path.join(configDir, "themes"));
  }
  const home = os.homedir();
  dirs.push(path.join(home, ".config", "opencode", "themes"));
  dirs.push(path.join(home, "AppData", "Roaming", "opencode", "themes"));
  dirs.push(path.join(home, "AppData", "Local", "opencode", "themes"));
  return dirs;
}

/**
 * Discover custom themes on disk. Always includes "" (default) and "system".
 * Order: "", "system", then names sorted.
 * `projectDir`, when provided, is scanned for `.opencode/themes/*.json`.
 */
export function discoverOpenCodeThemesFromDisk(
  projectDir?: string,
): DiscoveredTheme[] {
  const list: DiscoveredTheme[] = [];
  const seen = new Map<string, DiscoveredTheme>();

  for (const dir of userThemeDirs()) {
    scanThemeDir(dir, "user", list, seen);
  }
  if (projectDir) {
    scanThemeDir(
      path.join(projectDir, ".opencode", "themes"),
      "project",
      list,
      seen,
    );
  }

  uniquePush(list, seen, {
    name: "",
    swatch: builtinThemeSwatch(""),
    source: "unknown",
  });
  uniquePush(list, seen, {
    name: "system",
    swatch: builtinThemeSwatch("system"),
    source: "unknown",
  });

  list.sort((a, b) => {
    if (a.name === "") return -1;
    if (b.name === "") return 1;
    if (a.name === "system") return -1;
    if (b.name === "system") return 1;
    return a.name.localeCompare(b.name);
  });
  return list;
}

/**
 * Merge discovered custom themes with the hardcoded builtin catalog.
 * Disk entries win for the same name (user overrides); hardcoded entries
 * cover built-ins that only exist inside the opencode binary.
 */
export function mergeThemeCatalogs(
  discovered: readonly DiscoveredTheme[],
  hardcodedNames: readonly { value: string; label: string }[],
  current: string,
): Array<{ value: string; label: string; swatch: OpenCodeThemeSwatch }> {
  const out: Array<{ value: string; label: string; swatch: OpenCodeThemeSwatch }> =
    [];
  const seen = new Set<string>();
  const byName = new Map(discovered.map((d) => [d.name, d]));

  const orderedNames: string[] = ["", "system"];
  for (const opt of hardcodedNames) {
    if (!orderedNames.includes(opt.value)) orderedNames.push(opt.value);
  }
  for (const d of discovered) {
    if (!orderedNames.includes(d.name)) orderedNames.push(d.name);
  }
  if (current && !orderedNames.includes(current)) orderedNames.push(current);

  for (const name of orderedNames) {
    if (seen.has(name)) continue;
    seen.add(name);
    const disk = byName.get(name);
    const hard = hardcodedNames.find((h) => h.value === name);
    if (disk && disk.source !== "unknown") {
      out.push({
        value: name,
        label: disk.name === "" ? (hard?.label ?? "Default") : disk.name,
        swatch: disk.swatch,
      });
    } else if (hard) {
      out.push({
        value: name,
        label: hard.label,
        swatch: builtinThemeSwatch(name),
      });
    } else {
      out.push({
        value: name,
        label: name === "" ? "Default" : name,
        swatch: builtinThemeSwatch(name),
      });
    }
  }
  return out;
}
