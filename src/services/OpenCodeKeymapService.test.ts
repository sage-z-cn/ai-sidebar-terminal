import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenCodeKeymapService } from "./OpenCodeKeymapService";

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe("OpenCodeKeymapService", () => {
  let dir: string;
  let configPath: string;
  let service: OpenCodeKeymapService;
  let prevConfigDir: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-keymap-"));
    configPath = path.join(dir, "cli.json");
    prevConfigDir = process.env.OPENCODE_CONFIG_DIR;
    process.env.OPENCODE_CONFIG_DIR = dir;
    service = new OpenCodeKeymapService(logger);
  });

  afterEach(() => {
    if (prevConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR;
    } else {
      process.env.OPENCODE_CONFIG_DIR = prevConfigDir;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty overrides when file is missing", async () => {
    const payload = await service.load();
    expect(payload.overrides).toEqual({});
    expect(payload.items.length).toBeGreaterThan(100);
    expect(payload.configPath).toBe(configPath);
  });

  it("survives invalid JSON", async () => {
    fs.writeFileSync(configPath, "{not json", "utf8");
    const payload = await service.load();
    expect(payload.overrides).toEqual({});
  });

  it("aborts save instead of wiping an unreadable config", async () => {
    const original = '{ "$schema": "x", "theme": "dark", // comment\n }';
    fs.writeFileSync(configPath, original, "utf8");
    await expect(service.save("session.new", ["alt+n"])).rejects.toThrow(
      /not valid JSON/,
    );
    expect(fs.readFileSync(configPath, "utf8")).toBe(original);
  });

  it("loads array and object keybind values", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        keybinds: {
          "session.new": [{ key: "ctrl+k" }, "ctrl+j"],
          "app.exit": { key: "ctrl+shift+p" },
          "app.debug": { when: "dialogs == 0" },
        },
      }),
      "utf8",
    );
    const payload = await service.load();
    expect(payload.overrides["session.new"]).toBe("ctrl+k,ctrl+j");
    expect(payload.overrides["app.exit"]).toBe("ctrl+shift+p");
    expect(payload.overrides["app.debug"]).toBe("none");
  });

  it("reads string overrides and preserves other fields on save", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        $schema: "https://opencode.ai/v2/cli.json",
        theme: { name: "opencode" },
        keybinds: { "session.new": "alt+n", "app.exit": "none" },
      }),
      "utf8",
    );
    const payload = await service.load();
    expect(payload.overrides["session.new"]).toBe("alt+n");
    expect(payload.overrides["app.exit"]).toBe("none");

    await service.save("session.new", ["F1"]);
    const written = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      theme?: unknown;
      keybinds?: Record<string, string>;
    };
    expect(written.theme).toEqual({ name: "opencode" });
    expect(written.keybinds?.["session.new"]).toBe("F1");
    expect(written.keybinds?.["app.exit"]).toBe("none");
  });

  it("writes none for empty chords and deletes key when equal to default", async () => {
    await service.save("command.palette.show", []);
    let doc = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      keybinds: Record<string, string>;
    };
    expect(doc.keybinds["command.palette.show"]).toBe("none");

    await service.save("command.palette.show", ["ctrl+p"]);
    doc = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      keybinds: Record<string, string>;
    };
    expect(doc.keybinds["command.palette.show"]).toBeUndefined();
  });

  it("reset removes override", async () => {
    await service.save("session.new", ["alt+n"]);
    await service.reset("session.new");
    const doc = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      keybinds: Record<string, string>;
    };
    expect(doc.keybinds["session.new"]).toBeUndefined();
  });

  it("rejects unknown ids", async () => {
    await expect(service.save("nope.nope", ["a"])).rejects.toThrow(/Unknown/);
  });
});
