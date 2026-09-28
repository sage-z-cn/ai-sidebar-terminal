import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenCodeSettingsService } from "./OpenCodeSettingsService";

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe("OpenCodeSettingsService", () => {
  let dir: string;
  let configPath: string;
  let service: OpenCodeSettingsService;
  let prevConfigDir: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-settings-"));
    configPath = path.join(dir, "cli.json");
    prevConfigDir = process.env.OPENCODE_CONFIG_DIR;
    process.env.OPENCODE_CONFIG_DIR = dir;
    service = new OpenCodeSettingsService(logger);
  });

  afterEach(() => {
    if (prevConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR;
    } else {
      process.env.OPENCODE_CONFIG_DIR = prevConfigDir;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns defaults when file is missing", async () => {
    const payload = await service.load();
    expect(payload.configPath).toBe(configPath);
    expect(payload.values["session.thinking"]).toBe("show");
    expect(payload.overrides["session.thinking"]).toBeUndefined();
    expect(payload.themeOptions.some((t) => t.value === "nord")).toBe(true);
    expect(payload.plugins).toEqual([]);
  });

  it("loads nested overrides and flags them", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        theme: { name: "nord", mode: "dark" },
        session: { thinking: "hide" },
        animations: false,
      }),
      "utf8",
    );
    const payload = await service.load();
    expect(payload.values["theme.name"]).toBe("nord");
    expect(payload.values["theme.mode"]).toBe("dark");
    expect(payload.values["session.thinking"]).toBe("hide");
    expect(payload.values.animations).toBe(false);
    expect(payload.overrides["theme.name"]).toBe(true);
    expect(payload.overrides["session.thinking"]).toBe(true);
    expect(payload.overrides.animations).toBe(true);
    expect(payload.overrides["cursor.style"]).toBeUndefined();
  });

  it("includes the current unknown theme in options", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({ theme: { name: "my-odd-theme" } }),
      "utf8",
    );
    const payload = await service.load();
    expect(payload.themeOptions.some((t) => t.value === "my-odd-theme")).toBe(
      true,
    );
  });

  it("discovers custom themes from the themes directory", async () => {
    const themesDir = path.join(dir, "themes");
    fs.mkdirSync(themesDir, { recursive: true });
    fs.writeFileSync(path.join(themesDir, "my-theme.json"), "{}", "utf8");
    const payload = await service.load();
    expect(payload.themeOptions.some((t) => t.value === "my-theme")).toBe(true);
  });

  it("preserves unrelated keys when saving", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        $schema: "https://opencode.ai/v2/cli.json",
        keybinds: { "session.new": "alt+n" },
        theme: { name: "nord" },
      }),
      "utf8",
    );
    await service.save("session.thinking", "hide");
    const doc = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(doc.$schema).toBe("https://opencode.ai/v2/cli.json");
    expect((doc.keybinds as Record<string, string>)["session.new"]).toBe(
      "alt+n",
    );
    expect((doc.theme as { name: string }).name).toBe("nord");
    expect((doc.session as { thinking: string }).thinking).toBe("hide");
  });

  it("aborts save on unreadable JSON without wiping the file", async () => {
    const original = "{not json";
    fs.writeFileSync(configPath, original, "utf8");
    await expect(service.save("session.thinking", "hide")).rejects.toThrow(
      /not valid JSON/,
    );
    expect(fs.readFileSync(configPath, "utf8")).toBe(original);
  });

  it("reset removes nested keys and prunes empty parents", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({ theme: { name: "nord" }, animations: true }),
      "utf8",
    );
    await service.reset("theme.name");
    const doc = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(doc.theme).toBeUndefined();
    expect(doc.animations).toBe(true);
  });

  it("discovers project themes via explicit projectDir", async () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), "oc-settings-proj-"));
    try {
      const themesDir = path.join(proj, ".opencode", "themes");
      fs.mkdirSync(themesDir, { recursive: true });
      fs.writeFileSync(path.join(themesDir, "proj-theme.json"), "{}", "utf8");
      const payload = await service.load(proj);
      expect(
        payload.themeOptions.some((t) => t.value === "proj-theme"),
      ).toBe(true);
      const plain = await service.load();
      expect(plain.themeOptions.some((t) => t.value === "proj-theme")).toBe(
        false,
      );
    } finally {
      fs.rmSync(proj, { recursive: true, force: true });
    }
  });

  it("does not scan process.cwd() for themes", async () => {
    const prevCwd = process.cwd();
    const cwdThemes = path.join(dir, ".opencode", "themes");
    fs.mkdirSync(cwdThemes, { recursive: true });
    fs.writeFileSync(path.join(cwdThemes, "cwd-theme.json"), "{}", "utf8");
    process.chdir(dir);
    try {
      const payload = await service.load();
      expect(
        payload.themeOptions.some((t) => t.value === "cwd-theme"),
      ).toBe(false);
    } finally {
      process.chdir(prevCwd);
    }
    const restored = await service.load();
    expect(restored.themeOptions.some((t) => t.value === "cwd-theme")).toBe(
      false,
    );
  });
});
