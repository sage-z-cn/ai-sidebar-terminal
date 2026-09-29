import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  OPENCODE_BUILTIN_THEMES,
  OPENCODE_CLI_SETTINGS_CATALOG,
  type OpenCodeCliSettingOption,
} from "./aiTools/openCodeCliSettingsCatalog";
import {
  discoverOpenCodeThemesFromDisk,
  mergeThemeCatalogs,
} from "./aiTools/openCodeThemeDiscovery";
import { resolveOpenCodeCliConfigPath } from "./openCodeConfigPath";
import { OutputChannelService } from "./OutputChannelService";

export interface OpenCodeCliSettingsPayload {
  /** Effective values keyed by dotted path (defaults filled in). */
  values: Record<string, unknown>;
  /** Keys present in cli.json (true user overrides). */
  overrides: Record<string, boolean>;
  configPath: string;
  /** Theme options: builtin + discovered theme files. */
  themeOptions: OpenCodeCliSettingOption[];
  plugins: unknown[];
}

/**
 * Reads/writes OpenCode cli.json settings other than `keybinds`.
 * Writing a value equal to the default removes the key.
 */
export class OpenCodeCliSettingsService {
  public constructor(
    private readonly logger: Pick<
      OutputChannelService,
      "info" | "warn" | "error" | "debug"
    > = OutputChannelService.getInstance(),
  ) {}

  public resolveConfigPath(): string {
    return resolveOpenCodeCliConfigPath();
  }

  public async load(projectDir?: string): Promise<OpenCodeCliSettingsPayload> {
    const configPath = this.resolveConfigPath();
    const doc = this.readDoc(configPath);
    const values: Record<string, unknown> = {};
    const overrides: Record<string, boolean> = {};

    for (const item of OPENCODE_CLI_SETTINGS_CATALOG) {
      const has = hasPath(doc, item.id);
      const raw = has ? getPath(doc, item.id) : undefined;
      values[item.id] = has && raw !== undefined ? raw : item.def;
      if (has && raw !== undefined && !sameValue(raw, item.def)) {
        overrides[item.id] = true;
      }
    }

    const pluginsRaw = doc.plugins;
    const plugins = Array.isArray(pluginsRaw) ? pluginsRaw : [];

    return {
      values,
      overrides,
      configPath,
      themeOptions: this.buildThemeOptions(
        typeof values["theme.name"] === "string"
          ? (values["theme.name"] as string)
          : "",
        projectDir,
      ),
      plugins,
    };
  }

  /** Write one dotted path. Value equal to default deletes the key. */
  public async save(id: string, value: unknown): Promise<void> {
    await this.mutateDoc((doc) => {
      setPath(doc, id, value);
    });
  }

  /** Delete one dotted path override. */
  public async reset(id: string): Promise<void> {
    await this.mutateDoc((doc) => {
      deletePath(doc, id);
    });
  }

  private buildThemeOptions(
    current: string,
    projectDir?: string,
  ): OpenCodeCliSettingOption[] {
    // Runtime discovery (theme/assets + themes/*.json) tracks OpenCode updates
    // when those folders exist; the hardcoded catalog fills gaps otherwise.
    const discovered = discoverOpenCodeThemesFromDisk(projectDir);
    return mergeThemeCatalogs(discovered, OPENCODE_BUILTIN_THEMES, current);
  }

  private readDoc(configPath: string): Record<string, unknown> {
    try {
      if (!fs.existsSync(configPath)) {
        return {};
      }
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch (error) {
      this.logger.warn(
        `[OpenCodeCliSettingsService] Failed to read ${configPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {};
    }
  }

  private async mutateDoc(
    mutate: (doc: Record<string, unknown>) => void,
  ): Promise<void> {
    const configPath = this.resolveConfigPath();
    let doc: Record<string, unknown> = {};
    if (fs.existsSync(configPath)) {
      try {
        const raw = fs.readFileSync(configPath, "utf8");
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          doc = parsed as Record<string, unknown>;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `[OpenCodeCliSettingsService] Refusing to rewrite unreadable config ${configPath}: ${message}`,
        );
        throw new Error(`Config file is not valid JSON: ${configPath}`);
      }
    }

    mutate(doc);

    try {
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(configPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[OpenCodeCliSettingsService] Failed to write ${configPath}: ${message}`,
      );
      throw new Error(message);
    }
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) < 1e-9;
  }
  return false;
}

function pathParts(id: string): string[] {
  return id.split(".").filter(Boolean);
}

function hasPath(doc: Record<string, unknown>, id: string): boolean {
  let cur: unknown = doc;
  for (const part of pathParts(id)) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return false;
    if (!(part in (cur as Record<string, unknown>))) return false;
    cur = (cur as Record<string, unknown>)[part];
  }
  return true;
}

function getPath(doc: Record<string, unknown>, id: string): unknown {
  let cur: unknown = doc;
  for (const part of pathParts(id)) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function setPath(doc: Record<string, unknown>, id: string, value: unknown): void {
  const parts = pathParts(id);
  if (!parts.length) return;
  let cur = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const next = cur[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cur[key] = {};
    }
    cur = cur[key] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  if (value === undefined) {
    delete cur[last];
    return;
  }
  cur[last] = value;
}

function deletePath(doc: Record<string, unknown>, id: string): void {
  const parts = pathParts(id);
  if (!parts.length) return;
  let cur: Record<string, unknown> | undefined = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const next = cur?.[parts[i]];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      return;
    }
    cur = next as Record<string, unknown>;
  }
  if (cur) {
    delete cur[parts[parts.length - 1]];
    // prune empty parent objects (e.g. theme: {})
    if (parts.length > 1) {
      pruneEmpty(doc, parts.slice(0, -1));
    }
  }
}

function pruneEmpty(
  doc: Record<string, unknown>,
  parts: readonly string[],
): void {
  if (!parts.length) return;
  let cur: Record<string, unknown> | undefined = doc;
  const stack: Array<{ obj: Record<string, unknown>; key: string }> = [];
  for (const part of parts) {
    const next = cur?.[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) return;
    stack.push({ obj: cur, key: part });
    cur = next as Record<string, unknown>;
  }
  if (cur && Object.keys(cur).length === 0 && stack.length) {
    const last = stack[stack.length - 1];
    delete last.obj[last.key];
  }
}
