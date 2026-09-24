import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { KeymapItem } from "../types";
import {
  OPENCODE_KEYBIND_CATALOG,
  findKeymapItem,
} from "./aiTools/openCodeKeybindCatalog";
import { chordsOf, toPersistedValue } from "./openCodeKeymapState";
import { OutputChannelService } from "./OutputChannelService";

export interface KeymapPayload {
  items: readonly KeymapItem[];
  /** User overrides keyed by dotted command id (raw values from cli.json). */
  overrides: Record<string, string>;
  configPath: string;
}

/**
 * Reads/writes OpenCode v2 `~/.config/opencode/cli.json` → `keybinds`.
 * Only persists true overrides; empty chord lists write `"none"`;
 * values equal to defaults remove the key.
 */
export class OpenCodeKeymapService {
  public constructor(
    private readonly logger: Pick<
      OutputChannelService,
      "info" | "warn" | "error" | "debug"
    > = OutputChannelService.getInstance(),
  ) {}

  /** Resolve the cli.json path. OPENCODE_CONFIG_DIR wins even if the file is missing. */
  public resolveConfigPath(): string {
    const configDir = process.env.OPENCODE_CONFIG_DIR;
    if (configDir) {
      return path.join(configDir, "cli.json");
    }
    for (const file of this.candidatePaths()) {
      if (fs.existsSync(file)) {
        return file;
      }
    }
    return this.candidatePaths()[0];
  }

  private candidatePaths(): string[] {
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

  public async load(): Promise<KeymapPayload> {
    const configPath = this.resolveConfigPath();
    let overrides: Record<string, string> = {};
    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, "utf8");
        const parsed = JSON.parse(raw) as { keybinds?: unknown };
        if (parsed && typeof parsed === "object" && parsed.keybinds) {
          const binds = parsed.keybinds;
          if (typeof binds === "object" && !Array.isArray(binds)) {
            for (const [id, value] of Object.entries(
              binds as Record<string, unknown>,
            )) {
              if (typeof value === "string") {
                overrides[id] = value;
              } else if (value === false || value === null) {
                overrides[id] = "none";
              } else if (Array.isArray(value)) {
                const chords = chordsOf(value);
                overrides[id] = chords.length ? chords.join(",") : "none";
              } else if (typeof value === "object" && value !== null) {
                const chords = chordsOf(value);
                overrides[id] = chords.length ? chords.join(",") : "none";
              }
            }
          }
        }
      }
    } catch (error) {
      this.logger.warn(
        `[OpenCodeKeymapService] Failed to read ${configPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      overrides = {};
    }

    return {
      items: OPENCODE_KEYBIND_CATALOG,
      overrides,
      configPath,
    };
  }

  /**
   * Persist a full chord list for one command.
   * Empty list → `"none"`; same set as default → delete the key.
   */
  public async save(id: string, chords: string[]): Promise<void> {
    const item = findKeymapItem(id);
    if (!item) {
      throw new Error(`Unknown keybind id: ${id}`);
    }
    await this.mutateKeybinds((keybinds) => {
      const value = toPersistedValue(chords, item.def);
      if (value === undefined) {
        delete keybinds[id];
      } else {
        keybinds[id] = value;
      }
    });
  }

  /** Remove override so the command falls back to its default. */
  public async reset(id: string): Promise<void> {
    await this.mutateKeybinds((keybinds) => {
      delete keybinds[id];
    });
  }

  private async mutateKeybinds(
    mutate: (keybinds: Record<string, unknown>) => void,
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
        // Never rewrite a config we could not read: that would wipe
        // every other setting in the user's cli.json.
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `[OpenCodeKeymapService] Refusing to rewrite unreadable config ${configPath}: ${message}`,
        );
        throw new Error(`Config file is not valid JSON: ${configPath}`);
      }
    }

    const existing = doc.keybinds;
    const keybinds: Record<string, unknown> =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    mutate(keybinds);
    doc.keybinds = keybinds;

    try {
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(configPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[OpenCodeKeymapService] Failed to write ${configPath}: ${message}`,
      );
      throw new Error(message);
    }
  }
}
